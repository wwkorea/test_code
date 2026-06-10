// ════════════════════════════════════════════════════════════════════════════
//  PCB 이상탐지 데이터셋 생성기 — 구동 파일
//
//  파일 구성
//  ├ types.ts          공용 타입 + 패드 계산 헬퍼
//  ├ templateA.ts      복잡 (메인 학습용)
//  ├ templateB.ts      중간 (일반화 검증용)
//  ├ templateC.ts      단순 (Autoencoder 베이스라인용)
//  ├ templateD.ts      변형 배치 (구조 다양성용)
//  └ PCBDatasetGenerator.tsx  ← 이 파일 (렌더링/노이즈/UI)
//
//  기능
//  - 템플릿 4종 선택 미리보기
//  - 다중 결함 동시 선택 미리보기 (체크박스 조합)
//  - 배치 생성: 선택한 템플릿 × 결함 클래스, CSV 라벨 포함
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback, CSSProperties } from "react";
import {
  PCB_W, PCB_H, SPEC,
  Point, AnomalyType, PCBComponent, Trace, TraceCut, PCBTemplate,
  ICComponent, ResistorComponent, CapComponent, ConnectorComponent, LEDComponent,
} from "./types";
import templateA from "./templateA";
import templateB from "./templateB";
import templateC from "./templateC";
import templateD from "./templateD";

const TEMPLATES: PCBTemplate[] = [templateA, templateB, templateC, templateD];

const PCB_BG      = "#1a3a1a";
const TRACE_COLOR = "#c8a832";
const PAD_COLOR   = "#d4af37";
const MASK_COLOR  = "rgba(0,80,0,0.18)";

// ─── LCG 난수 (seed 재현성) ───────────────────────────────────────────────────

function rng(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── 노이즈 & 다중 결함 적용 ──────────────────────────────────────────────────
//
//  anomalies: 적용할 결함 목록 (빈 배열 = 정상)
//  - 전역 시프트는 보드 전체가 함께 이동 → 패드-트레이스 연결 유지
//  - 결함은 순서대로 누적 적용 (예: 단선 + 극성반전 동시)

interface ApplyResult {
  comps: PCBComponent[];
  traces: Trace[];
  labels: string[];   // 적용된 결함 설명 (정상이면 ["정상"])
}

function applyNoiseAndDefects(
  template: PCBTemplate,
  anomalies: AnomalyType[],
  seed: number
): ApplyResult {
  const rand = rng(seed);
  const n = (): number => (rand() - 0.5) * 2;

  const gx = n() * 1.5;
  const gy = n() * 1.5;

  const comps: PCBComponent[] = template.components.map((c) => ({
    ...c,
    x: c.x + gx + n() * 0.4,
    y: c.y + gy + n() * 0.4,
    angle: (c.angle ?? 0) + n() * 0.6,
  }));

  const traces: Trace[] = template.traces.map((t) => ({
    ...t,
    points: t.points.map(([x, y]): Point => [x + gx + n() * 0.3, y + gy + n() * 0.3]),
    w: Math.max(0.8, t.w + n() * 0.1),
  }));

  const labels: string[] = [];

  for (const a of anomalies) {
    switch (a) {
      case "open": {
        // 단선: 결함 없는 트레이스 중 무작위 선택 (버스 2개 제외)
        const candidates = traces
          .map((t, i) => ({ t, i }))
          .filter(({ t, i }) => i >= 2 && !t.cut && !t.isBridge && !t.isScratch && t.points.length >= 2);
        if (candidates.length > 0) {
          const { t } = candidates[Math.floor(rand() * candidates.length)];
          t.cut = { at: Math.floor(rand() * (t.points.length - 1)), gap: 5 + rand() * 7 } as TraceCut;
        }
        labels.push("단선");
        break;
      }
      case "bridge": {
        // 브릿지: 무작위 트레이스 세그먼트 중간 지점에 짧은 납 덩어리 (템플릿 독립적)
        const sig = traces.filter((t) => !t.isBridge && !t.isScratch && t.points.length >= 2);
        const t = sig[2 + Math.floor(rand() * Math.max(1, sig.length - 2))] ?? sig[0];
        const si = Math.floor(rand() * (t.points.length - 1));
        const a0 = t.points[si], b0 = t.points[si + 1];
        const mx = (a0[0] + b0[0]) / 2, my = (a0[1] + b0[1]) / 2;
        const ang = rand() * Math.PI;
        const len = 7 + rand() * 8;
        traces.push({
          points: [
            [mx - Math.cos(ang) * len / 2, my - Math.sin(ang) * len / 2],
            [mx + Math.cos(ang) * len / 2, my + Math.sin(ang) * len / 2],
          ],
          w: 2.5 + rand() * 2,
          net: "BRIDGE",
          isBridge: true,
        });
        labels.push("브릿지");
        break;
      }
      case "misalign": {
        // 오정렬: 아직 정상인 부품 하나를 크게 이동 (패드/트레이스는 그대로)
        const candidates = comps
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => !c.missing);
        if (candidates.length > 0) {
          const { i } = candidates[Math.floor(rand() * candidates.length)];
          comps[i] = {
            ...comps[i],
            x: comps[i].x + (rand() - 0.5) * 18,
            y: comps[i].y + (rand() - 0.5) * 18,
            angle: (comps[i].angle ?? 0) + (rand() - 0.5) * 28,
          };
        }
        labels.push("오정렬");
        break;
      }
      case "missing": {
        const candidates = comps
          .map((c, i) => ({ c, i }))
          .filter(({ c, i }) => i > 0 && !c.missing); // IC(0번)는 제외
        if (candidates.length > 0) {
          const { i } = candidates[Math.floor(rand() * candidates.length)];
          comps[i] = { ...comps[i], missing: true };
        }
        labels.push("누락");
        break;
      }
      case "polarity": {
        const targets = comps.filter((c) => (c.type === "led" || c.type === "cap") && !c.missing && !c.reversed);
        if (targets.length > 0) {
          targets[Math.floor(rand() * targets.length)].reversed = true;
        }
        labels.push("극성반전");
        break;
      }
      case "scratch": {
        const cx = 40 + rand() * (PCB_W - 80);
        const cy = 40 + rand() * (PCB_H - 80);
        const len = 30 + rand() * 80;
        const ang = rand() * Math.PI;
        traces.push({
          isScratch: true, points: [], w: 1.5, net: "SCRATCH",
          x1: cx - Math.cos(ang) * len / 2, y1: cy - Math.sin(ang) * len / 2,
          x2: cx + Math.cos(ang) * len / 2, y2: cy + Math.sin(ang) * len / 2,
        });
        labels.push("스크래치");
        break;
      }
      case "solder_cold": {
        const candidates = comps
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => !c.missing && !c.coldSolder);
        if (candidates.length > 0) {
          const { i } = candidates[Math.floor(rand() * candidates.length)];
          comps[i] = { ...comps[i], coldSolder: true };
        }
        labels.push("냉납");
        break;
      }
    }
  }

  if (labels.length === 0) labels.push("정상");
  return { comps, traces, labels };
}

// ─── Canvas 렌더러 ─────────────────────────────────────────────────────────────

function drawPCB(
  ctx: CanvasRenderingContext2D,
  comps: PCBComponent[],
  traces: Trace[],
  showGrid: boolean,
  boardLabel: string
): void {
  ctx.clearRect(0, 0, PCB_W, PCB_H);
  ctx.fillStyle = PCB_BG;     ctx.fillRect(0, 0, PCB_W, PCB_H);
  ctx.fillStyle = MASK_COLOR; ctx.fillRect(0, 0, PCB_W, PCB_H);

  if (showGrid) {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < PCB_W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PCB_H); ctx.stroke(); }
    for (let y = 0; y < PCB_H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PCB_W, y); ctx.stroke(); }
  }

  ctx.strokeStyle = "#4a7a4a"; ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, PCB_W - 4, PCB_H - 4);

  ctx.font = "bold 7px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillText(boardLabel, 240, 297);

  // ── 트레이스 ──
  traces.forEach((t) => {
    if (t.isScratch) {
      ctx.beginPath();
      ctx.moveTo(t.x1 ?? 0, t.y1 ?? 0);
      ctx.lineTo(t.x2 ?? 0, t.y2 ?? 0);
      ctx.strokeStyle = "rgba(210,210,210,0.55)";
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
      ctx.lineCap = "round";
      ctx.shadowColor = "#ffdd00";
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineCap = "butt";
      return;
    }

    const color = t.net === "VCC" ? "#e8a030" : t.net === "GND" ? "#5a5aaa" : TRACE_COLOR;

    if (t.cut) {
      const pts = t.points;
      const a = pts[t.cut.at], b = pts[t.cut.at + 1];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const gapRatio = Math.min(0.8, t.cut.gap / Math.max(segLen, 1));
      const m1: Point = [a[0] + (b[0] - a[0]) * (0.5 - gapRatio / 2), a[1] + (b[1] - a[1]) * (0.5 - gapRatio / 2)];
      const m2: Point = [a[0] + (b[0] - a[0]) * (0.5 + gapRatio / 2), a[1] + (b[1] - a[1]) * (0.5 + gapRatio / 2)];
      ctx.strokeStyle = color; ctx.lineWidth = t.w; ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i <= t.cut.at; i++)
        i === 0 ? ctx.moveTo(pts[i][0], pts[i][1]) : ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.lineTo(m1[0], m1[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(m2[0], m2[1]);
      for (let i = t.cut.at + 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    } else {
      ctx.beginPath();
      t.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.strokeStyle = color; ctx.lineWidth = t.w; ctx.lineJoin = "round";
      ctx.stroke();
    }

    // 굴절점 비아
    if (t.points.length > 2) {
      t.points.slice(1, -1).forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, t.w * 1.1, 0, Math.PI * 2);
        ctx.fillStyle = PAD_COLOR;
        ctx.fill();
      });
    }

    // 종단 패드 (패턴 끝은 반드시 패드로 종료)
    [t.points[0], t.points[t.points.length - 1]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2.2, t.w * 1.4), 0, Math.PI * 2);
      ctx.fillStyle = PAD_COLOR;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
  });

  // ── 부품 ──
  comps.forEach((c) => {
    if (c.missing) return;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(((c.angle ?? 0) * Math.PI) / 180);
    switch (c.type) {
      case "ic":        drawIC(ctx, c as ICComponent);              break;
      case "resistor":  drawResistor(ctx, c as ResistorComponent);  break;
      case "cap":       drawCap(ctx, c as CapComponent);            break;
      case "connector": drawConnector(ctx, c as ConnectorComponent);break;
      case "led":       drawLED(ctx, c as LEDComponent);            break;
    }
    ctx.restore();
  });
}

// ─── 부품 드로잉 (패드 오프셋 = types.ts의 SPEC와 동일) ───────────────────────

function padRect(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, coldSolder?: boolean): void {
  ctx.fillStyle = coldSolder ? "rgba(150,110,50,0.55)" : PAD_COLOR;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.strokeStyle = coldSolder ? "#806030" : "#555";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
}

function drawIC(ctx: CanvasRenderingContext2D, c: ICComponent): void {
  const { w, h, label, pins, coldSolder } = c;
  const ox = -w / 2, oy = -h / 2;
  const padDX = w / 2 + SPEC.IC_PAD_REACH / 2;
  const perSide = pins / 2;

  for (let i = 0; i < perSide; i++) {
    const py = -h / 2 + (h / (perSide + 1)) * (i + 1);
    padRect(ctx, -padDX, py, SPEC.IC_PAD_REACH, 5, coldSolder);
    padRect(ctx,  padDX, py, SPEC.IC_PAD_REACH, 5, coldSolder);
  }

  ctx.fillStyle = coldSolder ? "#2a2020" : "#222";
  ctx.fillRect(ox, oy, w, h);
  ctx.strokeStyle = coldSolder ? "#884444" : "#555";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox, oy, w, h);

  for (let i = 0; i < perSide; i++) {
    const py = -h / 2 + (h / (perSide + 1)) * (i + 1);
    ctx.fillStyle = "#999";
    ctx.fillRect(ox - 4, py - 1.5, 4, 3);
    ctx.fillRect(w / 2, py - 1.5, 4, 3);
  }

  ctx.beginPath();
  ctx.arc(ox + 8, oy + 8, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#555";
  ctx.fill();

  ctx.font = "bold 8px monospace"; ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
  ctx.fillText(label, 0, 2);
  ctx.font = "5px monospace"; ctx.fillStyle = "#666";
  ctx.fillText("MCU", 0, 10);
  ctx.textAlign = "left";
}

function drawResistor(ctx: CanvasRenderingContext2D, c: ResistorComponent): void {
  const { reversed, coldSolder } = c;
  const dx = SPEC.RES_DX;
  const bodyLen = 22, bodyH = 11;

  padRect(ctx, -dx, 0, 7, 6, coldSolder);
  padRect(ctx,  dx, 0, 7, 6, coldSolder);

  ctx.strokeStyle = "#999"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-dx, 0); ctx.lineTo(-bodyLen / 2, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bodyLen / 2, 0); ctx.lineTo(dx, 0); ctx.stroke();

  ctx.fillStyle = coldSolder ? "#3a2010" : "#c8a060";
  ctx.fillRect(-bodyLen / 2, -bodyH / 2, bodyLen, bodyH);
  ctx.strokeStyle = coldSolder ? "#804020" : "#888"; ctx.lineWidth = 1;
  ctx.strokeRect(-bodyLen / 2, -bodyH / 2, bodyLen, bodyH);

  const bands = reversed ? ["#e00", "#888", "#e00"] : ["#c00", "#a00", "#888"];
  bands.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(-bodyLen / 2 + 4 + i * 5, -bodyH / 2, 3, bodyH);
  });

  ctx.font = "5px monospace"; ctx.fillStyle = "#ddd"; ctx.textAlign = "center";
  ctx.fillText(c.label, 0, -bodyH / 2 - 2);
  ctx.textAlign = "left";
}

function drawCap(ctx: CanvasRenderingContext2D, c: CapComponent): void {
  const { reversed, coldSolder } = c;
  const dx = SPEC.CAP_DX;

  padRect(ctx, -dx, 0, 7, 6, coldSolder);
  padRect(ctx,  dx, 0, 7, 6, coldSolder);

  ctx.strokeStyle = "#999"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-dx, 0); ctx.lineTo(-8, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(dx, 0); ctx.stroke();

  ctx.fillStyle = coldSolder ? "#1a2030" : "#2a4a8a";
  ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = coldSolder ? "#446688" : "#4a8aff"; ctx.lineWidth = 1.5; ctx.stroke();

  // 극성: 정상 = +가 오른쪽 / 반전 = +가 왼쪽 + 경고
  ctx.font = "bold 7px monospace"; ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  if (reversed) {
    ctx.fillText("+", -4, 3);
    ctx.fillStyle = "#f00";
    ctx.fillText("!", 4, 3);
  } else {
    ctx.fillText("+", 4, 3);
  }
  ctx.textAlign = "left";

  ctx.font = "5px monospace"; ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
  ctx.fillText(c.label, 0, 17);
  ctx.textAlign = "left";
}

function drawConnector(ctx: CanvasRenderingContext2D, c: ConnectorComponent): void {
  const { pins, label, coldSolder } = c;
  const pitch = SPEC.CONN_PITCH, ps = SPEC.CONN_PAD;
  const w = pins * pitch, h = 14;

  ctx.fillStyle = coldSolder ? "#1a1010" : "#111";
  ctx.fillRect(-2, -2, w + 4, h + 4);
  ctx.strokeStyle = coldSolder ? "#664444" : "#555"; ctx.lineWidth = 1;
  ctx.strokeRect(-2, -2, w + 4, h + 4);

  // 핀 i 패드 중심 = (i*pitch + 4, 4)  ← types.ts의 connPad와 동일
  for (let i = 0; i < pins; i++) {
    padRect(ctx, i * pitch + 4, 4, ps, ps, coldSolder);
  }

  ctx.font = "5px monospace"; ctx.fillStyle = "#888";
  ctx.fillText(label, 0, h + 8);
}

function drawLED(ctx: CanvasRenderingContext2D, c: LEDComponent): void {
  const { reversed, coldSolder } = c;
  const dx = SPEC.LED_DX;

  padRect(ctx, -dx, 0, 6, 6, coldSolder);
  padRect(ctx,  dx, 0, 6, 6, coldSolder);

  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = coldSolder ? "#1a1a00" : reversed ? "#cc2222" : "#00cc44";
  ctx.fill();
  ctx.strokeStyle = coldSolder ? "#555" : "#fff"; ctx.lineWidth = 1; ctx.stroke();

  // 캐소드 플랫 마커: 정상 = 오른쪽 / 반전 = 왼쪽
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2;
  const mx = reversed ? -4 : 4;
  ctx.beginPath(); ctx.moveTo(mx, -4); ctx.lineTo(mx, 4); ctx.stroke();

  if (!coldSolder) {
    ctx.beginPath();
    ctx.arc(-1, -1, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fill();
  }

  ctx.font = "5px monospace"; ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
  ctx.fillText(c.label, 0, 14);
  ctx.textAlign = "left";
}

// ─── UI 상수 ───────────────────────────────────────────────────────────────────

interface AnomalyOption { value: AnomalyType; label: string; color: string; emoji: string; }

const ANOMALY_TYPES: AnomalyOption[] = [
  { value: "open",        label: "단선",           color: "#f44336", emoji: "🔴" },
  { value: "bridge",      label: "솔더 브릿지",    color: "#ff9800", emoji: "🟠" },
  { value: "misalign",    label: "부품 오정렬",    color: "#9c27b0", emoji: "🟣" },
  { value: "missing",     label: "부품 누락",      color: "#607d8b", emoji: "⬜" },
  { value: "polarity",    label: "극성 반전",      color: "#e91e63", emoji: "🔁" },
  { value: "scratch",     label: "기판 스크래치",  color: "#795548", emoji: "〰️" },
  { value: "solder_cold", label: "냉납",           color: "#3f51b5", emoji: "🔵" },
];

function btnStyle(bg: string, width: CSSProperties["width"] = "auto"): CSSProperties {
  return {
    background: bg, color: "#fff", border: "none", borderRadius: 6,
    padding: "7px 14px", cursor: "pointer", fontSize: 12,
    fontFamily: "monospace", width,
  };
}

const panelStyle: CSSProperties = {
  background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16,
};

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function PCBDatasetGenerator(): JSX.Element {
  const previewRef = useRef<HTMLCanvasElement>(null);

  // 미리보기 상태
  const [templateId, setTemplateId]       = useState<string>(TEMPLATES[0].id);
  const [previewDefects, setPreviewDefects] = useState<Record<AnomalyType, boolean>>(
    Object.fromEntries(ANOMALY_TYPES.map((a) => [a.value, false])) as Record<AnomalyType, boolean>
  );
  const [seed, setSeed]                   = useState<number>(42);
  const [showGrid, setShowGrid]           = useState<boolean>(false);

  // 배치 상태
  const [batchTemplates, setBatchTemplates] = useState<Record<string, boolean>>(
    Object.fromEntries(TEMPLATES.map((t) => [t.id, true]))
  );
  const [batchDefects, setBatchDefects]   = useState<Record<AnomalyType, boolean>>(
    Object.fromEntries(ANOMALY_TYPES.map((a) => [a.value, true])) as Record<AnomalyType, boolean>
  );
  const [includeNormal, setIncludeNormal] = useState<boolean>(true);
  const [batchCount, setBatchCount]       = useState<number>(80);
  const [batchProgress, setBatchProgress] = useState<number | null>(null);
  const [log, setLog]                     = useState<string[]>([]);

  const currentTemplate = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const activePreviewDefects: AnomalyType[] =
    ANOMALY_TYPES.filter((a) => previewDefects[a.value]).map((a) => a.value);

  // ── 미리보기 렌더 ──
  const render = useCallback((): void => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { comps, traces } = applyNoiseAndDefects(currentTemplate, activePreviewDefects, seed);
    drawPCB(ctx, comps, traces, showGrid, `PCB-${currentTemplate.id} v4`);
    // activePreviewDefects는 previewDefects에서 파생되므로 의존성은 previewDefects로 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTemplate, previewDefects, seed, showGrid]);

  useEffect(() => { render(); }, [render]);

  const randomize = (): void => setSeed(Math.floor(Math.random() * 999999));

  const togglePreviewDefect = (val: AnomalyType): void =>
    setPreviewDefects((prev) => ({ ...prev, [val]: !prev[val] }));

  const clearPreviewDefects = (): void =>
    setPreviewDefects(
      Object.fromEntries(ANOMALY_TYPES.map((a) => [a.value, false])) as Record<AnomalyType, boolean>
    );

  const downloadSingle = (): void => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const defectStr = activePreviewDefects.length > 0 ? activePreviewDefects.join("+") : "normal";
    const link = document.createElement("a");
    link.download = `pcb_${currentTemplate.id}_${defectStr}_seed${seed}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  // ── 배치 생성 ──
  const generateBatch = async (): Promise<void> => {
    const activeTemplates = TEMPLATES.filter((t) => batchTemplates[t.id]);
    const activeDefects = ANOMALY_TYPES.filter((a) => batchDefects[a.value]).map((a) => a.value);
    // 클래스 = (정상 포함 시) normal + 선택된 결함 각각 단일
    const classes: AnomalyType[][] = [];
    if (includeNormal) classes.push([]);
    activeDefects.forEach((d) => classes.push([d]));
    if (activeTemplates.length === 0 || classes.length === 0) return;

    setBatchProgress(0);
    const newLog: string[] = [];
    const totalImages = batchCount;
    const perCell = Math.max(1, Math.ceil(totalImages / (activeTemplates.length * classes.length)));
    let total = 0;
    const grandTotal = activeTemplates.length * classes.length * perCell;
    let csv = "filename,template,anomaly_types,anomaly_labels,seed\n";

    const off = document.createElement("canvas");
    off.width = PCB_W;
    off.height = PCB_H;
    const offCtx = off.getContext("2d");
    if (!offCtx) return;

    for (const tpl of activeTemplates) {
      for (const cls of classes) {
        for (let i = 0; i < perCell; i++) {
          const s = Math.floor(Math.random() * 999999);
          const { comps, traces, labels } = applyNoiseAndDefects(tpl, cls, s);
          drawPCB(offCtx, comps, traces, false, `PCB-${tpl.id} v4`);

          const clsStr = cls.length > 0 ? cls.join("+") : "normal";
          const fname = `pcb_${tpl.id}_${clsStr}_${String(i).padStart(4, "0")}_s${s}.png`;
          csv += `${fname},${tpl.id},${clsStr},"${labels.join("+")}",${s}\n`;

          // 브라우저 자동 다운로드 제한: 처음 5장만
          if (total < 5) {
            const link = document.createElement("a");
            link.download = fname;
            link.href = off.toDataURL("image/png");
            link.click();
            await new Promise<void>((r) => setTimeout(r, 80));
          }

          total++;
          setBatchProgress(Math.round((total / grandTotal) * 100));
          newLog.push(`${fname}`);
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
    }

    const csvLink = document.createElement("a");
    csvLink.download = "pcb_labels.csv";
    csvLink.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    csvLink.click();

    setLog(newLog.slice(-30));
    setBatchProgress(null);
  };

  const activeBatchTplCount = TEMPLATES.filter((t) => batchTemplates[t.id]).length;
  const activeBatchClsCount =
    (includeNormal ? 1 : 0) + ANOMALY_TYPES.filter((a) => batchDefects[a.value]).length;

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "monospace", padding: 20 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* 헤더 */}
        <div style={{ marginBottom: 20, borderBottom: "1px solid #30363d", paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: "#58a6ff" }}>🔬 PCB 이상탐지 데이터셋 생성기 v4</h1>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8b949e" }}>
            300×300 · 템플릿 {TEMPLATES.length}종 · 다중 결함 조합 · 패드-트레이스 정합
          </p>
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>

          {/* ── 좌: 미리보기 ── */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "#58a6ff" }}>미리보기</span>
                <span style={{
                  background: "#23863633", color: "#4caf50",
                  border: "1px solid #4caf50", borderRadius: 4,
                  padding: "2px 8px", fontSize: 11,
                }}>
                  {activePreviewDefects.length === 0
                    ? "✅ 정상"
                    : `⚠ 결함 ${activePreviewDefects.length}종`}
                </span>
              </div>

              {/* 템플릿 선택 탭 */}
              <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTemplateId(t.id)}
                    style={{
                      flex: 1,
                      background: templateId === t.id ? "#1f6feb" : "transparent",
                      border: `1px solid ${templateId === t.id ? "#1f6feb" : "#30363d"}`,
                      color: templateId === t.id ? "#fff" : "#8b949e",
                      borderRadius: 6, padding: "5px 0", cursor: "pointer", fontSize: 11,
                      fontFamily: "monospace",
                    }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 10 }}>
                {currentTemplate.description}
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
                  style={{
                    width: 80, background: "#0d1117", border: "1px solid #30363d",
                    color: "#e6edf3", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace",
                  }}
                />
              </div>
            </div>
          </div>

          {/* ── 우: 컨트롤 ── */}
          <div style={{ flex: 1, minWidth: 280 }}>

            {/* 미리보기 결함 (다중 선택) */}
            <div style={{ ...panelStyle, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "#58a6ff" }}>결함 조합 (다중 선택)</span>
                <button
                  onClick={clearPreviewDefects}
                  style={{ ...btnStyle("transparent"), border: "1px solid #30363d", color: "#8b949e", padding: "3px 10px", fontSize: 10 }}
                >
                  초기화
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {ANOMALY_TYPES.map((a) => (
                  <label
                    key={a.value}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, fontSize: 12,
                      cursor: "pointer",
                      background: previewDefects[a.value] ? a.color + "22" : "transparent",
                      border: `1px solid ${previewDefects[a.value] ? a.color : "#30363d"}`,
                      color: previewDefects[a.value] ? a.color : "#8b949e",
                      borderRadius: 6, padding: "6px 10px", transition: "all 0.15s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={previewDefects[a.value]}
                      onChange={() => togglePreviewDefect(a.value)}
                      style={{ accentColor: a.color }}
                    />
                    {a.emoji} {a.label}
                  </label>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: "#555" }}>
                ※ 아무것도 선택하지 않으면 정상 회로가 표시됩니다. 같은 시드에서 결함만 추가/제거하면 변화를 비교할 수 있습니다.
              </div>
            </div>

            {/* 배치 생성 */}
            <div style={panelStyle}>
              <div style={{ fontSize: 13, color: "#58a6ff", marginBottom: 12 }}>📦 배치 생성</div>

              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>포함할 템플릿:</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {TEMPLATES.map((t) => (
                  <label
                    key={t.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer",
                      color: batchTemplates[t.id] ? "#58a6ff" : "#555",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={batchTemplates[t.id]}
                      onChange={() => setBatchTemplates((p) => ({ ...p, [t.id]: !p[t.id] }))}
                    />
                    {t.name}
                  </label>
                ))}
              </div>

              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>포함할 클래스:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                <label style={{
                  display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                  cursor: "pointer", color: includeNormal ? "#4caf50" : "#555",
                }}>
                  <input type="checkbox" checked={includeNormal} onChange={() => setIncludeNormal((v) => !v)} />
                  ✅ 정상
                </label>
                {ANOMALY_TYPES.map((a) => (
                  <label
                    key={a.value}
                    style={{
                      display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                      cursor: "pointer", color: batchDefects[a.value] ? a.color : "#555",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={batchDefects[a.value]}
                      onChange={() => setBatchDefects((p) => ({ ...p, [a.value]: !p[a.value] }))}
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
                  min={8} max={2000} step={8}
                  style={{
                    width: 70, background: "#0d1117", border: "1px solid #30363d",
                    color: "#e6edf3", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace",
                  }}
                />
                <span style={{ fontSize: 10, color: "#555" }}>
                  (~{activeBatchTplCount * activeBatchClsCount > 0
                    ? Math.ceil(batchCount / (activeBatchTplCount * activeBatchClsCount))
                    : 0}장 / 템플릿×클래스)
                </span>
              </div>

              <button
                onClick={generateBatch}
                disabled={batchProgress !== null}
                style={btnStyle(batchProgress !== null ? "#333" : "#388bfd", "100%")}
              >
                {batchProgress !== null ? `생성 중... ${batchProgress}%` : "🚀 배치 생성 + CSV 다운로드"}
              </button>

              {batchProgress !== null && (
                <div style={{ marginTop: 8, background: "#0d1117", borderRadius: 4, height: 6 }}>
                  <div style={{
                    width: `${batchProgress}%`, height: "100%",
                    background: "#388bfd", borderRadius: 4, transition: "width 0.2s",
                  }} />
                </div>
              )}

              <div style={{ marginTop: 8, fontSize: 10, color: "#555" }}>
                ※ 브라우저 제한으로 처음 5장만 자동 저장됩니다. 대량 생성은 같은 렌더링 로직을 Node.js(canvas 패키지)로 포팅하는 것을 권장합니다.
              </div>
            </div>
          </div>
        </div>

        {/* 로그 */}
        {log.length > 0 && (
          <div style={{ ...panelStyle, marginTop: 16 }}>
            <div style={{ fontSize: 12, color: "#58a6ff", marginBottom: 8 }}>생성 로그 (최근 30개)</div>
            <div style={{ maxHeight: 120, overflow: "auto", fontSize: 10, color: "#8b949e" }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        )}

        {/* 가이드 */}
        <div style={{ ...panelStyle, marginTop: 16, fontSize: 11, color: "#8b949e" }}>
          <div style={{ color: "#58a6ff", marginBottom: 8, fontSize: 12 }}>💡 학습 활용 가이드</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ color: "#e6edf3", marginBottom: 4 }}>단계별 진행</div>
              <div>• 1단계: 템플릿 C 단독 + Autoencoder</div>
              <div>• 2단계: A/B/D 추가, 일반화 검증</div>
              <div>• 3단계: U-Net + 마스크 export 확장</div>
            </div>
            <div>
              <div style={{ color: "#e6edf3", marginBottom: 4 }}>학습 팁</div>
              <div>• 회전은 에포크 중 RandomRotation 적용</div>
              <div>• 정상:이상 = 7:3 비율 시작</div>
              <div>• 템플릿×클래스당 최소 100장 권장</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
