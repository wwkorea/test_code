import { useState, useRef, useEffect, useCallback, CSSProperties } from "react";

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const PCB_W = 400;
const PCB_H = 300;
const PCB_BG = "#1a3a1a";
const TRACE_COLOR = "#c8a832";
const PAD_COLOR = "#d4af37";
const MASK_COLOR = "rgba(0,80,0,0.18)";

// ─── 타입 정의 ─────────────────────────────────────────────────────────────────

type ComponentType = "ic" | "resistor" | "cap" | "connector" | "led";
type AnomalyType =
  | "normal"
  | "open"
  | "bridge"
  | "misalign"
  | "missing"
  | "polarity"
  | "scratch"
  | "solder_cold";

interface BaseComponent {
  type: ComponentType;
  x: number;
  y: number;
  angle?: number;
  label: string;
  // 이상 플래그
  missing?: boolean;
  reversed?: boolean;
  coldSolder?: boolean;
}

interface ICComponent extends BaseComponent {
  type: "ic";
  w: number;
  h: number;
  pins: number;
}

interface ResistorComponent extends BaseComponent {
  type: "resistor";
}

interface CapComponent extends BaseComponent {
  type: "cap";
}

interface ConnectorComponent extends BaseComponent {
  type: "connector";
  pins: number;
}

interface LEDComponent extends BaseComponent {
  type: "led";
}

type PCBComponent =
  | ICComponent
  | ResistorComponent
  | CapComponent
  | ConnectorComponent
  | LEDComponent;

type Point = [number, number];

interface TraceCut {
  at: number;
  gap: number;
}

interface Trace {
  points: Point[];
  w: number;
  net: string;
  cut?: TraceCut;
  isBridge?: boolean;
  isScratch?: boolean;
  // 스크래치 전용 좌표
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface AnomalyInfo {
  type: AnomalyType;
  description: string;
}

interface AnomalyOption {
  value: AnomalyType;
  label: string;
  color: string;
  emoji: string;
}

interface ApplyNoiseResult {
  noisyComps: PCBComponent[];
  noisyTraces: Trace[];
  anomalyInfo: AnomalyInfo;
}

// ─── 기본 회로 데이터 ──────────────────────────────────────────────────────────

const BASE_COMPONENTS: PCBComponent[] = [
  { type: "ic",        x: 155, y: 105, w: 90, h: 90, label: "U1", pins: 8 },
  { type: "resistor",  x: 40,  y: 60,  angle: 0, label: "R1" },
  { type: "resistor",  x: 40,  y: 130, angle: 0, label: "R2" },
  { type: "resistor",  x: 40,  y: 200, angle: 0, label: "R3" },
  { type: "resistor",  x: 310, y: 60,  angle: 0, label: "R4" },
  { type: "resistor",  x: 310, y: 200, angle: 0, label: "R5" },
  { type: "cap",       x: 310, y: 130, label: "C1" },
  { type: "cap",       x: 60,  y: 250, label: "C2" },
  { type: "cap",       x: 310, y: 250, label: "C3" },
  { type: "connector", x: 20,  y: 20,  pins: 3, label: "J1" },
  { type: "connector", x: 330, y: 20,  pins: 2, label: "J2" },
  { type: "led",       x: 170, y: 240, label: "D1" },
  { type: "led",       x: 215, y: 240, label: "D2" },
];

const BASE_TRACES: Trace[] = [
  { points: [[20, 18],  [380, 18]],                            w: 2.5, net: "VCC"  },
  { points: [[20, 282], [380, 282]],                           w: 2.5, net: "GND"  },
  { points: [[76, 60],  [120, 60], [120, 120], [155, 120]],   w: 1.5, net: "NET1" },
  { points: [[76, 130], [155, 145]],                           w: 1.5, net: "NET2" },
  { points: [[76, 200], [100, 200], [100, 282]],               w: 1.5, net: "GND"  },
  { points: [[245, 120],[310, 120], [310, 60]],                w: 1.5, net: "NET3" },
  { points: [[245, 145],[310, 145]],                           w: 1.5, net: "NET4" },
  { points: [[245, 170],[280, 170], [280, 200], [310, 200]],   w: 1.5, net: "NET5" },
  { points: [[60, 268], [60, 282]],                            w: 1.2, net: "GND"  },
  { points: [[310, 268],[310, 282]],                           w: 1.2, net: "GND"  },
  { points: [[178, 258],[178, 282]],                           w: 1.2, net: "GND"  },
  { points: [[222, 258],[222, 282]],                           w: 1.2, net: "GND"  },
  { points: [[40, 18],  [40, 50]],                             w: 1.5, net: "VCC"  },
  { points: [[40, 18],  [310, 18], [310, 50]],                 w: 1.5, net: "VCC"  },
  { points: [[155, 105],[155, 18]],                            w: 1.2, net: "VCC"  },
  { points: [[20, 30],  [20, 50]],                             w: 1.5, net: "J1_1" },
  { points: [[30, 30],  [30, 50], [30, 60], [40, 60]],        w: 1.2, net: "J1_2" },
];

// ─── LCG 난수 생성기 (seed 기반 재현성 보장) ───────────────────────────────────

function rng(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── 노이즈 & 이상 적용 ────────────────────────────────────────────────────────

function applyNoise(
  components: PCBComponent[],
  traces: Trace[],
  anomaly: AnomalyType,
  seed: number
): ApplyNoiseResult {
  const rand = rng(seed);
  const n = (): number => (rand() - 0.5) * 2;

  // 기본 위치 노이즈 (항상 적용 → 학습 다양성)
  const noisyComps: PCBComponent[] = components.map((c) => ({
    ...c,
    x: c.x + n() * 1.5,
    y: c.y + n() * 1.5,
    angle: (c.angle ?? 0) + n() * 1.2,
  }));

  const noisyTraces: Trace[] = traces.map((t) => ({
    ...t,
    points: t.points.map(([x, y]): Point => [x + n() * 1.0, y + n() * 1.0]),
    w: t.w + n() * 0.15,
  }));

  let anomalyInfo: AnomalyInfo = { type: "normal", description: "정상" };

  switch (anomaly) {
    case "open": {
      const idx = Math.floor(rand() * noisyTraces.length);
      const t = noisyTraces[idx];
      if (t.points.length >= 2) {
        t.cut = { at: Math.floor(rand() * (t.points.length - 1)), gap: 6 + rand() * 10 };
      }
      anomalyInfo = { type: "open", description: "단선 (Open Circuit)" };
      break;
    }
    case "bridge": {
      noisyTraces.push({
        points: [
          [100 + rand() * 50, 100 + rand() * 60],
          [110 + rand() * 50, 105 + rand() * 60],
        ],
        w: 2 + rand() * 3,
        net: "BRIDGE",
        isBridge: true,
      });
      anomalyInfo = { type: "bridge", description: "솔더 브릿지 (Short)" };
      break;
    }
    case "misalign": {
      const idx = Math.floor(rand() * noisyComps.length);
      noisyComps[idx] = {
        ...noisyComps[idx],
        x: noisyComps[idx].x + (rand() - 0.5) * 20,
        y: noisyComps[idx].y + (rand() - 0.5) * 20,
        angle: (noisyComps[idx].angle ?? 0) + (rand() - 0.5) * 30,
      };
      anomalyInfo = { type: "misalign", description: "부품 오정렬 (Misalignment)" };
      break;
    }
    case "missing": {
      const idx = 1 + Math.floor(rand() * (noisyComps.length - 1));
      noisyComps[idx] = { ...noisyComps[idx], missing: true };
      anomalyInfo = { type: "missing", description: "부품 누락 (Missing Component)" };
      break;
    }
    case "polarity": {
      const targets = noisyComps.filter((c) => c.type === "led" || c.type === "cap");
      if (targets.length > 0) {
        targets[Math.floor(rand() * targets.length)].reversed = true;
      }
      anomalyInfo = { type: "polarity", description: "극성 반전 (Polarity Reversed)" };
      break;
    }
    case "scratch": {
      noisyTraces.push({
        isScratch: true,
        points: [],
        w: 1.5,
        net: "SCRATCH",
        x1: rand() * PCB_W,
        y1: rand() * PCB_H,
        x2: rand() * PCB_W,
        y2: rand() * PCB_H,
      });
      anomalyInfo = { type: "scratch", description: "기판 스크래치 (PCB Scratch)" };
      break;
    }
    case "solder_cold": {
      const idx = Math.floor(rand() * noisyComps.length);
      noisyComps[idx] = { ...noisyComps[idx], coldSolder: true };
      anomalyInfo = { type: "solder_cold", description: "냉납 (Cold Solder Joint)" };
      break;
    }
  }

  return { noisyComps, noisyTraces, anomalyInfo };
}

// ─── Canvas 렌더러 ─────────────────────────────────────────────────────────────

function drawPCB(
  ctx: CanvasRenderingContext2D,
  components: PCBComponent[],
  traces: Trace[],
  showGrid: boolean
): void {
  ctx.clearRect(0, 0, PCB_W, PCB_H);

  ctx.fillStyle = PCB_BG;
  ctx.fillRect(0, 0, PCB_W, PCB_H);

  ctx.fillStyle = MASK_COLOR;
  ctx.fillRect(0, 0, PCB_W, PCB_H);

  if (showGrid) {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < PCB_W; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PCB_H); ctx.stroke();
    }
    for (let y = 0; y < PCB_H; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PCB_W, y); ctx.stroke();
    }
  }

  ctx.strokeStyle = "#4a7a4a";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, PCB_W - 4, PCB_H - 4);

  const holes: Point[] = [
    [10, 10], [PCB_W - 10, 10], [10, PCB_H - 10], [PCB_W - 10, PCB_H - 10],
  ];
  holes.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.font = "bold 8px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillText("PCB-TRAIN-v1.0", 120, 295);

  // 트레이스
  traces.forEach((t) => {
    if (t.isScratch) {
      ctx.beginPath();
      ctx.moveTo(t.x1 ?? 0, t.y1 ?? 0);
      ctx.lineTo(t.x2 ?? 0, t.y2 ?? 0);
      ctx.strokeStyle = "rgba(200,200,200,0.6)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    if (t.isBridge) {
      ctx.beginPath();
      ctx.moveTo(t.points[0][0], t.points[0][1]);
      ctx.lineTo(t.points[1][0], t.points[1][1]);
      ctx.strokeStyle = "#e8c060";
      ctx.lineWidth = t.w;
      ctx.shadowColor = "#ffdd00";
      ctx.shadowBlur = 4;
      ctx.stroke();
      ctx.shadowBlur = 0;
      return;
    }

    if (t.cut) {
      ctx.save();
      const pts = t.points;
      // cut 이전 구간
      ctx.beginPath();
      for (let i = 0; i <= t.cut.at && i < pts.length; i++) {
        i === 0 ? ctx.moveTo(pts[i][0], pts[i][1]) : ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = TRACE_COLOR;
      ctx.lineWidth = t.w;
      ctx.stroke();
      // cut 이후 구간
      ctx.beginPath();
      for (let i = t.cut.at + 1; i < pts.length; i++) {
        i === t.cut.at + 1 ? ctx.moveTo(pts[i][0], pts[i][1]) : ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    t.points.forEach(([x, y], i) =>
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    );
    ctx.strokeStyle =
      t.net === "VCC" ? "#e8a030" : t.net === "GND" ? "#6060a0" : TRACE_COLOR;
    ctx.lineWidth = t.w;
    ctx.lineJoin = "round";
    ctx.stroke();

    if (t.points.length > 2) {
      t.points.slice(1, -1).forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, t.w * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = PAD_COLOR;
        ctx.fill();
      });
    }
  });

  // 컴포넌트
  components.forEach((c) => {
    if (c.missing) return;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(((c.angle ?? 0) * Math.PI) / 180);
    switch (c.type) {
      case "ic":        drawIC(ctx, c);        break;
      case "resistor":  drawResistor(ctx, c);  break;
      case "cap":       drawCap(ctx, c);       break;
      case "connector": drawConnector(ctx, c); break;
      case "led":       drawLED(ctx, c);       break;
    }
    ctx.restore();
  });
}

// ─── 컴포넌트 드로잉 함수들 ────────────────────────────────────────────────────

function drawIC(ctx: CanvasRenderingContext2D, c: ICComponent): void {
  const { w, h, label, pins, coldSolder } = c;
  const ox = -w / 2, oy = -h / 2;

  ctx.fillStyle = coldSolder ? "#2a2020" : "#222";
  ctx.fillRect(ox, oy, w, h);
  ctx.strokeStyle = coldSolder ? "#884444" : "#555";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox, oy, w, h);

  const pinCount = pins / 2;
  const pinSpacing = h / (pinCount + 1);
  for (let i = 0; i < pinCount; i++) {
    const py = oy + pinSpacing * (i + 1);
    ctx.fillStyle = coldSolder ? "rgba(180,140,60,0.5)" : PAD_COLOR;
    ctx.fillRect(ox - 10, py - 2.5, 10, 5);
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ox - 10, py - 2.5, 10, 5);
    ctx.fillStyle = coldSolder ? "rgba(180,140,60,0.5)" : PAD_COLOR;
    ctx.fillRect(w / 2, py - 2.5, 10, 5);
    ctx.strokeRect(w / 2, py - 2.5, 10, 5);
  }

  ctx.beginPath();
  ctx.arc(ox + 8, oy + 8, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#555";
  ctx.fill();

  ctx.font = "bold 9px monospace";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "center";
  ctx.fillText(label, 0, 3);
  ctx.font = "6px monospace";
  ctx.fillStyle = "#666";
  ctx.fillText("MCU", 0, 12);
  ctx.textAlign = "left";
}

function drawResistor(ctx: CanvasRenderingContext2D, c: ResistorComponent): void {
  const len = 36, h = 14;
  const { reversed, coldSolder } = c;

  ctx.fillStyle = coldSolder ? "#3a2010" : "#c8a060";
  ctx.fillRect(-len / 2, -h / 2, len, h);
  ctx.strokeStyle = coldSolder ? "#804020" : "#888";
  ctx.lineWidth = 1;
  ctx.strokeRect(-len / 2, -h / 2, len, h);

  const bands = reversed ? ["#e00", "#888", "#e00"] : ["#c00", "#a00", "#888"];
  bands.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(-len / 2 + 6 + i * 7, -h / 2, 4, h);
  });

  ([-len / 2 - 6, len / 2] as number[]).forEach((px) => {
    ctx.fillStyle = coldSolder ? "rgba(180,140,60,0.5)" : PAD_COLOR;
    ctx.fillRect(px, -4, 6, 8);
  });

  ctx.font = "5px monospace";
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  ctx.fillText(c.label, 0, 2);
  ctx.textAlign = "left";
}

function drawCap(ctx: CanvasRenderingContext2D, c: CapComponent): void {
  const { reversed, coldSolder } = c;

  ctx.fillStyle = coldSolder ? "#1a2030" : "#2a4a8a";
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = coldSolder ? "#446688" : "#4a8aff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = "bold 8px monospace";
  ctx.fillStyle = reversed ? "#f00" : "#fff";
  ctx.textAlign = "center";
  ctx.fillText(reversed ? "−" : "+", 0, 3);
  ctx.textAlign = "left";

  ([[-15, -4], [9, -4]] as Point[]).forEach(([px, py]) => {
    ctx.fillStyle = coldSolder ? "rgba(180,140,60,0.5)" : PAD_COLOR;
    ctx.fillRect(px, py, 6, 8);
  });

  ctx.font = "5px monospace";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "center";
  ctx.fillText(c.label, 0, 20);
  ctx.textAlign = "left";
}

function drawConnector(ctx: CanvasRenderingContext2D, c: ConnectorComponent): void {
  const { pins, label, coldSolder } = c;
  const w = pins * 12, h = 16;

  ctx.fillStyle = coldSolder ? "#1a1010" : "#111";
  ctx.fillRect(-2, -2, w + 4, h + 4);
  ctx.strokeStyle = coldSolder ? "#664444" : "#555";
  ctx.lineWidth = 1;
  ctx.strokeRect(-2, -2, w + 4, h + 4);

  for (let i = 0; i < pins; i++) {
    ctx.fillStyle = coldSolder ? "rgba(180,140,60,0.5)" : PAD_COLOR;
    ctx.fillRect(i * 12, 0, 10, 10);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(i * 12, 0, 10, 10);
  }

  ctx.font = "5px monospace";
  ctx.fillStyle = "#888";
  ctx.fillText(label, 0, h + 8);
}

function drawLED(ctx: CanvasRenderingContext2D, c: LEDComponent): void {
  const { reversed, coldSolder } = c;

  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fillStyle = coldSolder ? "#1a1a00" : reversed ? "#cc0000" : "#00cc44";
  ctx.fill();
  ctx.strokeStyle = coldSolder ? "#555" : "#fff";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!coldSolder) {
    ctx.beginPath();
    ctx.arc(-1, -1, 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fill();
  }

  ctx.font = "5px monospace";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "center";
  ctx.fillText(c.label, 0, 16);
  ctx.textAlign = "left";
}

// ─── 상수 & 헬퍼 ──────────────────────────────────────────────────────────────

const ANOMALY_TYPES: AnomalyOption[] = [
  { value: "normal",      label: "정상",         color: "#4caf50", emoji: "✅" },
  { value: "open",        label: "단선",          color: "#f44336", emoji: "🔴" },
  { value: "bridge",      label: "솔더 브릿지",   color: "#ff9800", emoji: "🟠" },
  { value: "misalign",    label: "부품 오정렬",   color: "#9c27b0", emoji: "🟣" },
  { value: "missing",     label: "부품 누락",     color: "#607d8b", emoji: "⬜" },
  { value: "polarity",    label: "극성 반전",     color: "#e91e63", emoji: "🔁" },
  { value: "scratch",     label: "기판 스크래치", color: "#795548", emoji: "〰️" },
  { value: "solder_cold", label: "냉납",          color: "#3f51b5", emoji: "🔵" },
];

function btnStyle(bg: string, width: CSSProperties["width"] = "auto"): CSSProperties {
  return {
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "7px 14px",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "monospace",
    width,
  };
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function PCBDatasetGenerator(): JSX.Element {
  const previewRef = useRef<HTMLCanvasElement>(null);

  const [anomaly, setAnomaly]                 = useState<AnomalyType>("normal");
  const [seed, setSeed]                       = useState<number>(42);
  const [showGrid, setShowGrid]               = useState<boolean>(false);
  const [batchCount, setBatchCount]           = useState<number>(50);
  const [batchProgress, setBatchProgress]     = useState<number | null>(null);
  const [log, setLog]                         = useState<string[]>([]);
  const [selectedAnomalies, setSelectedAnomalies] = useState<Record<AnomalyType, boolean>>(
    Object.fromEntries(ANOMALY_TYPES.map((a) => [a.value, true])) as Record<AnomalyType, boolean>
  );

  const render = useCallback(
    (targetCanvas: HTMLCanvasElement, anomalyType: AnomalyType, s: number): void => {
      const ctx = targetCanvas.getContext("2d");
      if (!ctx) return;
      const { noisyComps, noisyTraces } = applyNoise(BASE_COMPONENTS, BASE_TRACES, anomalyType, s);
      drawPCB(ctx, noisyComps, noisyTraces, showGrid);
    },
    [showGrid]
  );

  useEffect(() => {
    if (previewRef.current) render(previewRef.current, anomaly, seed);
  }, [anomaly, seed, showGrid, render]);

  const randomize = (): void => setSeed(Math.floor(Math.random() * 999999));

  const downloadSingle = (): void => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `pcb_${anomaly}_seed${seed}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const generateBatch = async (): Promise<void> => {
    const activeAnomalies = ANOMALY_TYPES.filter((a) => selectedAnomalies[a.value]);
    if (activeAnomalies.length === 0) return;

    setBatchProgress(0);
    const newLog: string[] = [];
    const perClass = Math.ceil(batchCount / activeAnomalies.length);
    let total = 0;
    let csv = "filename,anomaly_type,anomaly_label,seed\n";

    const offscreen = document.createElement("canvas");
    offscreen.width  = PCB_W;
    offscreen.height = PCB_H;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    for (const aType of activeAnomalies) {
      for (let i = 0; i < perClass; i++) {
        const s = Math.floor(Math.random() * 999999);
        const { noisyComps, noisyTraces, anomalyInfo } = applyNoise(
          BASE_COMPONENTS, BASE_TRACES, aType.value, s
        );
        drawPCB(offCtx, noisyComps, noisyTraces, false);

        const fname = `pcb_${aType.value}_${String(i).padStart(4, "0")}_s${s}.png`;
        csv += `${fname},${aType.value},${anomalyInfo.description},${s}\n`;

        if (total < 5) {
          const link = document.createElement("a");
          link.download = fname;
          link.href = offscreen.toDataURL("image/png");
          link.click();
          await new Promise<void>((r) => setTimeout(r, 80));
        }

        total++;
        setBatchProgress(Math.round((total / (activeAnomalies.length * perClass)) * 100));
        newLog.push(`${fname} → ${aType.label}`);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    const csvBlob = new Blob([csv], { type: "text/csv" });
    const csvLink = document.createElement("a");
    csvLink.download = "pcb_labels.csv";
    csvLink.href = URL.createObjectURL(csvBlob);
    csvLink.click();

    setLog(newLog.slice(-30));
    setBatchProgress(null);
  };

  const toggleAnomaly = (val: AnomalyType): void =>
    setSelectedAnomalies((prev) => ({ ...prev, [val]: !prev[val] }));

  const currentAnomaly = ANOMALY_TYPES.find((a) => a.value === anomaly);
  const activeCount = ANOMALY_TYPES.filter((a) => selectedAnomalies[a.value]).length;

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "monospace", padding: "20px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* 헤더 */}
        <div style={{ marginBottom: 20, borderBottom: "1px solid #30363d", paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: "#58a6ff" }}>🔬 PCB 이상탐지 데이터셋 생성기</h1>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8b949e" }}>
            Anomaly Detection Training Data Generator — Canvas Direct Rendering
          </p>
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>

          {/* 미리보기 패널 */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "#58a6ff" }}>미리보기</span>
                <span style={{
                  background: (currentAnomaly?.color ?? "#fff") + "33",
                  color: currentAnomaly?.color,
                  border: `1px solid ${currentAnomaly?.color ?? "#fff"}`,
                  borderRadius: 4, padding: "2px 8px", fontSize: 11,
                }}>
                  {currentAnomaly?.emoji} {currentAnomaly?.label}
                </span>
              </div>

              <canvas
                ref={previewRef}
                width={PCB_W}
                height={PCB_H}
                style={{ display: "block", border: "1px solid #30363d", borderRadius: 4 }}
              />

              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={randomize} style={btnStyle("#238636")}>🎲 랜덤 시드</button>
                <button onClick={downloadSingle} style={btnStyle("#1f6feb")}>⬇ PNG 저장</button>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer" }}>
                  <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                  그리드
                </label>
              </div>

              <div style={{ marginTop: 10, fontSize: 11, color: "#8b949e" }}>
                Seed:{" "}
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  style={{ width: 80, background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace" }}
                />
              </div>
            </div>
          </div>

          {/* 컨트롤 패널 */}
          <div style={{ flex: 1, minWidth: 280 }}>

            {/* 이상 유형 선택 */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#58a6ff", marginBottom: 12 }}>이상 유형 선택 (미리보기)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ANOMALY_TYPES.map((a) => (
                  <button
                    key={a.value}
                    onClick={() => setAnomaly(a.value)}
                    style={{
                      background: anomaly === a.value ? a.color + "22" : "transparent",
                      border: `1px solid ${anomaly === a.value ? a.color : "#30363d"}`,
                      color: anomaly === a.value ? a.color : "#8b949e",
                      borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                      textAlign: "left", fontSize: 12, transition: "all 0.15s",
                    }}
                  >
                    {a.emoji} {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 배치 생성 */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#58a6ff", marginBottom: 12 }}>📦 배치 생성</div>

              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>포함할 클래스:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {ANOMALY_TYPES.map((a) => (
                  <label
                    key={a.value}
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: selectedAnomalies[a.value] ? a.color : "#555" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAnomalies[a.value]}
                      onChange={() => toggleAnomaly(a.value)}
                    />
                    {a.emoji} {a.label}
                  </label>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "#8b949e" }}>총 이미지 수:</label>
                <input
                  type="number"
                  value={batchCount}
                  onChange={(e) => setBatchCount(Number(e.target.value))}
                  min={8} max={500} step={8}
                  style={{ width: 70, background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace" }}
                />
                <span style={{ fontSize: 10, color: "#555" }}>
                  (클래스당 ~{activeCount > 0 ? Math.ceil(batchCount / activeCount) : 0}장)
                </span>
              </div>

              <button
                onClick={generateBatch}
                disabled={batchProgress !== null}
                style={btnStyle(batchProgress !== null ? "#333" : "#388bfd", "100%")}
              >
                {batchProgress !== null
                  ? `생성 중... ${batchProgress}%`
                  : "🚀 배치 생성 + CSV 라벨 다운로드"}
              </button>

              {batchProgress !== null && (
                <div style={{ marginTop: 8, background: "#0d1117", borderRadius: 4, height: 6 }}>
                  <div style={{ width: `${batchProgress}%`, height: "100%", background: "#388bfd", borderRadius: 4, transition: "width 0.2s" }} />
                </div>
              )}

              <div style={{ marginTop: 8, fontSize: 10, color: "#555" }}>
                ※ 브라우저 보안 정책으로 처음 5장만 자동 저장됩니다. 대량 생성은 Node.js 포팅을 권장합니다.
              </div>
            </div>
          </div>
        </div>

        {/* 로그 */}
        {log.length > 0 && (
          <div style={{ marginTop: 16, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#58a6ff", marginBottom: 8 }}>생성 로그 (최근 30개)</div>
            <div style={{ maxHeight: 120, overflow: "auto", fontSize: 10, color: "#8b949e" }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        )}

        {/* 사용 가이드 */}
        <div style={{ marginTop: 16, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, fontSize: 11, color: "#8b949e" }}>
          <div style={{ color: "#58a6ff", marginBottom: 8, fontSize: 12 }}>💡 학습 활용 가이드</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ color: "#e6edf3", marginBottom: 4 }}>권장 모델 구조</div>
              <div>• CNN 기반 분류 (ResNet18 경량)</div>
              <div>• Autoencoder (재구성 오차 방식)</div>
              <div>• CBAM Attention 이상 위치 탐지</div>
            </div>
            <div>
              <div style={{ color: "#e6edf3", marginBottom: 4 }}>데이터 설정 팁</div>
              <div>• 클래스당 최소 200장 권장</div>
              <div>• 정상:이상 = 7:3 비율 시작</div>
              <div>• 노이즈 → 데이터 증강 효과</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
