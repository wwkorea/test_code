import { useState, useRef, useEffect, useCallback, CSSProperties } from "react";

// ════════════════════════════════════════════════════════════════════════════
//  PCB 이상탐지 학습 데이터 생성기 (300×300, TSX)
//
//  설계 원칙
//  1. 패드 좌표가 단일 소스(Single Source of Truth):
//     - PADS 객체에 모든 패드의 절대 좌표를 정의
//     - 트레이스 끝점 = 패드 좌표 (공중에 뜬 배선 없음)
//     - 부품 드로잉 함수도 같은 오프셋으로 패드를 그림
//  2. 모든 트레이스는 패드에서 시작해 패드에서 끝남 (실제 PCB와 동일)
//  3. seed 기반 LCG 난수로 재현 가능한 노이즈/이상 생성
// ════════════════════════════════════════════════════════════════════════════

// ─── 캔버스 상수 ───────────────────────────────────────────────────────────────

const PCB_W = 300;
const PCB_H = 300;
const PCB_BG      = "#1a3a1a";
const TRACE_COLOR = "#c8a832";
const PAD_COLOR   = "#d4af37";
const MASK_COLOR  = "rgba(0,80,0,0.18)";

// ─── 타입 정의 ─────────────────────────────────────────────────────────────────

type ComponentType = "ic" | "resistor" | "cap" | "connector" | "led";
type AnomalyType =
  | "normal" | "open" | "bridge" | "misalign"
  | "missing" | "polarity" | "scratch" | "solder_cold";
type Point = [number, number];

interface BaseComponent {
  type: ComponentType;
  x: number;          // 부품 중심 x
  y: number;          // 부품 중심 y
  angle?: number;     // 회전 (도)
  label: string;
  missing?: boolean;
  reversed?: boolean;
  coldSolder?: boolean;
}
interface ICComponent        extends BaseComponent { type: "ic";        w: number; h: number; pins: number; }
interface ResistorComponent  extends BaseComponent { type: "resistor"; }
interface CapComponent       extends BaseComponent { type: "cap"; }
interface ConnectorComponent extends BaseComponent { type: "connector"; pins: number; }
interface LEDComponent       extends BaseComponent { type: "led"; }
type PCBComponent =
  | ICComponent | ResistorComponent | CapComponent
  | ConnectorComponent | LEDComponent;

interface TraceCut { at: number; gap: number; }
interface Trace {
  points: Point[];     // 첫 점과 마지막 점은 반드시 패드 좌표
  w: number;
  net: string;
  cut?: TraceCut;
  isBridge?: boolean;
  isScratch?: boolean;
  x1?: number; y1?: number; x2?: number; y2?: number; // 스크래치 전용
}
interface AnomalyInfo   { type: AnomalyType; description: string; }
interface AnomalyOption { value: AnomalyType; label: string; color: string; emoji: string; }
interface ApplyNoiseResult {
  noisyComps: PCBComponent[];
  noisyTraces: Trace[];
  anomalyInfo: AnomalyInfo;
}

// ─── 패드 오프셋 규격 (부품 중심 기준 로컬 좌표) ──────────────────────────────
//
//  드로잉 함수와 패드 좌표 계산이 똑같이 이 값을 참조한다.

const SPEC = {
  RES:  { padDX: 16 },             // 저항: 패드중심 = 중심 ± 16
  CAP:  { padDX: 13 },             // 커패시터: 음극 -13, 양극 +13
  LED:  { padDX: 9 },              // LED: 애노드 -9, 캐소드 +9
  IC:   { w: 70, h: 70, pins: 8, padReach: 8 }, // 패드중심 = 본체边 ± (padReach/2 + 본체절반)
  CONN: { pitch: 10, padSize: 8 }, // 커넥터 핀 간격
} as const;

// IC 패드 중심의 본체 중심 기준 x 오프셋
const IC_PAD_DX = SPEC.IC.w / 2 + SPEC.IC.padReach / 2; // 35 + 4 = 39
// IC 핀 y 오프셋 (4핀/측, 간격 = h/(4+1) = 14)
const IC_PIN_DY = (pin: number): number => -SPEC.IC.h / 2 + (SPEC.IC.h / 5) * (pin + 1);

// ─── 부품 중심 좌표 ────────────────────────────────────────────────────────────

const C = {
  U1: { x: 150, y: 140 },
  R1: { x: 42,  y: 75  },
  R2: { x: 42,  y: 140 },
  R3: { x: 42,  y: 205 },
  R4: { x: 258, y: 75  },
  R5: { x: 258, y: 205 },
  C1: { x: 258, y: 140 },
  C2: { x: 60,  y: 258 },
  C3: { x: 240, y: 258 },
  J1: { x: 22,  y: 18  },  // 3핀, 좌상
  J2: { x: 248, y: 18  },  // 2핀, 우상
  D1: { x: 130, y: 258 },
  D2: { x: 170, y: 258 },
} as const;

// ─── 패드 절대 좌표 (트레이스가 참조하는 유일한 연결점) ───────────────────────

const PADS = {
  // 저항: L = 왼쪽 패드, R = 오른쪽 패드
  R1L: [C.R1.x - SPEC.RES.padDX, C.R1.y] as Point,
  R1R: [C.R1.x + SPEC.RES.padDX, C.R1.y] as Point,
  R2L: [C.R2.x - SPEC.RES.padDX, C.R2.y] as Point,
  R2R: [C.R2.x + SPEC.RES.padDX, C.R2.y] as Point,
  R3L: [C.R3.x - SPEC.RES.padDX, C.R3.y] as Point,
  R3R: [C.R3.x + SPEC.RES.padDX, C.R3.y] as Point,
  R4L: [C.R4.x - SPEC.RES.padDX, C.R4.y] as Point,
  R4R: [C.R4.x + SPEC.RES.padDX, C.R4.y] as Point,
  R5L: [C.R5.x - SPEC.RES.padDX, C.R5.y] as Point,
  R5R: [C.R5.x + SPEC.RES.padDX, C.R5.y] as Point,
  // 커패시터: N = 음극(-), P = 양극(+)
  C1N: [C.C1.x - SPEC.CAP.padDX, C.C1.y] as Point,
  C1P: [C.C1.x + SPEC.CAP.padDX, C.C1.y] as Point,
  C2N: [C.C2.x - SPEC.CAP.padDX, C.C2.y] as Point,
  C2P: [C.C2.x + SPEC.CAP.padDX, C.C2.y] as Point,
  C3N: [C.C3.x - SPEC.CAP.padDX, C.C3.y] as Point,
  C3P: [C.C3.x + SPEC.CAP.padDX, C.C3.y] as Point,
  // IC U1: L0~L3 = 왼쪽 핀(위→아래), R0~R3 = 오른쪽 핀(위→아래)
  U1L0: [C.U1.x - IC_PAD_DX, C.U1.y + IC_PIN_DY(0)] as Point,
  U1L1: [C.U1.x - IC_PAD_DX, C.U1.y + IC_PIN_DY(1)] as Point,
  U1L2: [C.U1.x - IC_PAD_DX, C.U1.y + IC_PIN_DY(2)] as Point,
  U1L3: [C.U1.x - IC_PAD_DX, C.U1.y + IC_PIN_DY(3)] as Point,
  U1R0: [C.U1.x + IC_PAD_DX, C.U1.y + IC_PIN_DY(0)] as Point,
  U1R1: [C.U1.x + IC_PAD_DX, C.U1.y + IC_PIN_DY(1)] as Point,
  U1R2: [C.U1.x + IC_PAD_DX, C.U1.y + IC_PIN_DY(2)] as Point,
  U1R3: [C.U1.x + IC_PAD_DX, C.U1.y + IC_PIN_DY(3)] as Point,
  // 커넥터: 핀 i 패드중심 (부품 좌상단 기준 배치이므로 중심 보정)
  J1P0: [C.J1.x + 0 * SPEC.CONN.pitch + 4, C.J1.y + 4] as Point,
  J1P1: [C.J1.x + 1 * SPEC.CONN.pitch + 4, C.J1.y + 4] as Point,
  J1P2: [C.J1.x + 2 * SPEC.CONN.pitch + 4, C.J1.y + 4] as Point,
  J2P0: [C.J2.x + 0 * SPEC.CONN.pitch + 4, C.J2.y + 4] as Point,
  J2P1: [C.J2.x + 1 * SPEC.CONN.pitch + 4, C.J2.y + 4] as Point,
  // LED: A = 애노드(+), K = 캐소드(-)
  D1A: [C.D1.x - SPEC.LED.padDX, C.D1.y] as Point,
  D1K: [C.D1.x + SPEC.LED.padDX, C.D1.y] as Point,
  D2A: [C.D2.x - SPEC.LED.padDX, C.D2.y] as Point,
  D2K: [C.D2.x + SPEC.LED.padDX, C.D2.y] as Point,
} as const;

// ─── 부품 배열 ─────────────────────────────────────────────────────────────────

const BASE_COMPONENTS: PCBComponent[] = [
  { type: "ic",        ...C.U1, w: SPEC.IC.w, h: SPEC.IC.h, pins: SPEC.IC.pins, label: "U1" },
  { type: "resistor",  ...C.R1, angle: 0, label: "R1" },
  { type: "resistor",  ...C.R2, angle: 0, label: "R2" },
  { type: "resistor",  ...C.R3, angle: 0, label: "R3" },
  { type: "resistor",  ...C.R4, angle: 0, label: "R4" },
  { type: "resistor",  ...C.R5, angle: 0, label: "R5" },
  { type: "cap",       ...C.C1, label: "C1" },
  { type: "cap",       ...C.C2, label: "C2" },
  { type: "cap",       ...C.C3, label: "C3" },
  { type: "connector", ...C.J1, pins: 3, label: "J1" },
  { type: "connector", ...C.J2, pins: 2, label: "J2" },
  { type: "led",       ...C.D1, label: "D1" },
  { type: "led",       ...C.D2, label: "D2" },
];

// ─── 트레이스 정의 (모든 끝점 = PADS 좌표) ────────────────────────────────────
//
//  네트 구성
//  VCC : J1P0 → 버스 / J2P0 → 버스 / R1R, R4R → 버스 / U1L0(VCC핀) / C2P, C1N(디커플링)
//  GND : R3L, C2N, C3N, D1K, D2K, U1R3(GND핀) → 버스
//  신호: J1P1→R2R, J1P2→R3R, R1L→U1L1, R2L→U1L2, R3R(공유), U1R0→R4L→J2P1,
//        U1R1→C1P, U1R2→R5R, R5L→C3P, D1A/D2A→U1R2 분기

const VCC_Y = 10;   // VCC 버스 y
const GND_Y = 290;  // GND 버스 y

const BASE_TRACES: Trace[] = [
  // ══ 전원 버스 ══
  { points: [[12, VCC_Y], [288, VCC_Y]], w: 2.2, net: "VCC" },
  { points: [[12, GND_Y], [288, GND_Y]], w: 2.2, net: "GND" },

  // ── VCC 공급 (수직 드롭, 패드 → 버스) ──
  { points: [PADS.J1P0, [PADS.J1P0[0], VCC_Y]], w: 1.4, net: "VCC" },
  { points: [PADS.J2P0, [PADS.J2P0[0], VCC_Y]], w: 1.4, net: "VCC" },
  { points: [PADS.R1R, [PADS.R1R[0] + 8, PADS.R1R[1]], [PADS.R1R[0] + 8, VCC_Y]], w: 1.3, net: "VCC" },
  { points: [PADS.R4R, [PADS.R4R[0] + 8, PADS.R4R[1]], [PADS.R4R[0] + 8, VCC_Y]], w: 1.3, net: "VCC" },
  // U1 VCC 핀 (좌측 핀0): 왼쪽으로 빠져나가 위로
  { points: [PADS.U1L0, [PADS.U1L0[0] - 10, PADS.U1L0[1]], [PADS.U1L0[0] - 10, 40], [150, 40], [150, VCC_Y]], w: 1.3, net: "VCC" },
  // C2 양극 → VCC 버스 (디커플링, 좌측 벽 따라 위로)
  { points: [PADS.C2P, [PADS.C2P[0] + 8, PADS.C2P[1]], [PADS.C2P[0] + 8, 232], [12, 232], [12, VCC_Y]], w: 1.1, net: "VCC" },

  // ── GND 드롭 (패드 → 버스) ──
  { points: [PADS.R3L, [PADS.R3L[0] - 8, PADS.R3L[1]], [PADS.R3L[0] - 8, GND_Y]], w: 1.3, net: "GND" },
  { points: [PADS.C2N, [PADS.C2N[0], GND_Y]], w: 1.2, net: "GND" },
  { points: [PADS.C3N, [PADS.C3N[0], GND_Y]], w: 1.2, net: "GND" },
  { points: [PADS.D1K, [PADS.D1K[0], GND_Y]], w: 1.2, net: "GND" },
  { points: [PADS.D2K, [PADS.D2K[0], GND_Y]], w: 1.2, net: "GND" },
  // U1 GND 핀 (우측 핀3): 오른쪽으로 빠져나가 아래로
  { points: [PADS.U1R3, [PADS.U1R3[0] + 10, PADS.U1R3[1]], [PADS.U1R3[0] + 10, 232], [210, 232], [210, GND_Y]], w: 1.3, net: "GND" },

  // ── 신호 네트 ──
  // NET1: R1 왼쪽 → U1 좌핀1
  { points: [PADS.R1L, [PADS.R1L[0] - 8, PADS.R1L[1]], [PADS.R1L[0] - 8, 100], [88, 100], [88, PADS.U1L1[1]], PADS.U1L1], w: 1.3, net: "NET1" },
  // NET2: R2 왼쪽 → U1 좌핀2 (R2와 핀2의 y가 다르므로 중간 굴절)
  { points: [PADS.R2L, [PADS.R2L[0] - 8, PADS.R2L[1]], [PADS.R2L[0] - 8, PADS.U1L2[1]], PADS.U1L2], w: 1.3, net: "NET2" },
  // NET3: R3 오른쪽 → U1 좌핀3
  { points: [PADS.R3R, [PADS.R3R[0] + 8, PADS.R3R[1]], [PADS.R3R[0] + 8, PADS.U1L3[1]], PADS.U1L3], w: 1.3, net: "NET3" },
  // SIG1: J1 핀1 → R2 오른쪽
  { points: [PADS.J1P1, [PADS.J1P1[0], 52], [70, 52], [70, PADS.R2R[1] - 18], [PADS.R2R[0] + 6, PADS.R2R[1] - 18], [PADS.R2R[0] + 6, PADS.R2R[1]], PADS.R2R], w: 1.2, net: "SIG1" },
  // SIG2: J1 핀2 → R1 왼쪽 위 경유 → R3 오른쪽... 단순화: J1핀2 → 좌측벽 → R3R로 가면 NET3와 겹침.
  //        대신 J1핀2 → R1L 쪽이 아니라 별도 수직선으로 R3R 위 분기 지점에 연결
  { points: [PADS.J1P2, [PADS.J1P2[0], 46], [58, 46], [58, 60], [PADS.R1L[0] - 14, 60], [PADS.R1L[0] - 14, PADS.R1L[1]]], w: 1.1, net: "SIG2" },
  // OUT: U1 우핀0 → R4 왼쪽
  { points: [PADS.U1R0, [PADS.U1R0[0] + 8, PADS.U1R0[1]], [PADS.U1R0[0] + 8, PADS.R4L[1]], PADS.R4L], w: 1.3, net: "OUT" },
  // OUT2: J2 핀1 → U1 우핀0 분기 (R4L 경유점에서 위로)
  { points: [PADS.J2P1, [PADS.J2P1[0], 50], [PADS.U1R0[0] + 8, 50], [PADS.U1R0[0] + 8, PADS.U1R0[1]]], w: 1.2, net: "OUT" },
  // NET5: U1 우핀1 → C1 양극... C1P는 오른쪽이므로 위로 돌아 들어감
  { points: [PADS.U1R1, [PADS.U1R1[0] + 14, PADS.U1R1[1]], [PADS.U1R1[0] + 14, C.C1.y - 16], [PADS.C1P[0], C.C1.y - 16], PADS.C1P], w: 1.3, net: "NET5" },
  // NET6: U1 우핀2 → R5 오른쪽
  { points: [PADS.U1R2, [PADS.U1R2[0] + 20, PADS.U1R2[1]], [PADS.U1R2[0] + 20, PADS.R5R[1]], PADS.R5R], w: 1.3, net: "NET6" },
  // NET6b: R5 왼쪽 → C3 양극
  { points: [PADS.R5L, [PADS.R5L[0] - 8, PADS.R5L[1]], [PADS.R5L[0] - 8, PADS.C3P[1] - 14], [PADS.C3P[0], PADS.C3P[1] - 14], PADS.C3P], w: 1.2, net: "NET6" },
  // C1 음극 → GND 버스 (우측 벽 따라)
  { points: [PADS.C1N, [PADS.C1N[0] - 8, PADS.C1N[1]], [PADS.C1N[0] - 8, 170], [288, 170], [288, GND_Y]], w: 1.1, net: "GND" },
  // LED1: D1 애노드 → U1 우핀2 분기 (수평 버스에서 내려옴)
  { points: [PADS.D1A, [PADS.D1A[0], 236], [150, 236], [150, 220], [PADS.U1R2[0] + 20, 220], [PADS.U1R2[0] + 20, PADS.U1R2[1]]], w: 1.1, net: "NET6" },
  // LED2: D2 애노드 → 같은 분기 버스
  { points: [PADS.D2A, [PADS.D2A[0], 236], [150, 236]], w: 1.1, net: "NET6" },
];

// ─── LCG 난수 생성기 (seed 재현성) ─────────────────────────────────────────────

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

  // 전역 시프트: 보드 전체가 같이 흔들림 → 패드-트레이스 연결 유지
  const gx = n() * 1.5;
  const gy = n() * 1.5;

  const noisyComps: PCBComponent[] = components.map((c) => ({
    ...c,
    x: c.x + gx + n() * 0.4,   // 부품별 미세 노이즈는 작게 (연결 유지)
    y: c.y + gy + n() * 0.4,
    angle: (c.angle ?? 0) + n() * 0.6,
  }));

  const noisyTraces: Trace[] = traces.map((t) => ({
    ...t,
    points: t.points.map(([x, y]): Point => [x + gx + n() * 0.3, y + gy + n() * 0.3]),
    w: Math.max(0.8, t.w + n() * 0.1),
  }));

  let anomalyInfo: AnomalyInfo = { type: "normal", description: "정상" };

  switch (anomaly) {
    case "open": {
      // 단선: 트레이스 한 세그먼트를 끊음
      const idx = 2 + Math.floor(rand() * (noisyTraces.length - 2)); // 버스 제외
      const t = noisyTraces[idx];
      if (t.points.length >= 2) {
        t.cut = { at: Math.floor(rand() * (t.points.length - 1)), gap: 5 + rand() * 7 };
      }
      anomalyInfo = { type: "open", description: "단선 (Open Circuit)" };
      break;
    }
    case "bridge": {
      // 솔더 브릿지: 트레이스 밀집 구역(IC 주변)에 짧은 납 덩어리
      const side = rand() < 0.5 ? -1 : 1;
      const bx = C.U1.x + side * (IC_PAD_DX + 2) + gx;
      const by = C.U1.y - 24 + rand() * 48 + gy;
      noisyTraces.push({
        points: [[bx, by], [bx + side * (6 + rand() * 8), by + n() * 6]],
        w: 2.5 + rand() * 2,
        net: "BRIDGE",
        isBridge: true,
      });
      anomalyInfo = { type: "bridge", description: "솔더 브릿지 (Short)" };
      break;
    }
    case "misalign": {
      // 부품 오정렬: 부품만 이동(패드는 그대로) → 트레이스에서 떨어진 모습이 곧 결함
      const idx = Math.floor(rand() * noisyComps.length);
      noisyComps[idx] = {
        ...noisyComps[idx],
        x: noisyComps[idx].x + (rand() - 0.5) * 18,
        y: noisyComps[idx].y + (rand() - 0.5) * 18,
        angle: (noisyComps[idx].angle ?? 0) + (rand() - 0.5) * 28,
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
      const cx = 40 + rand() * 220;
      const cy = 40 + rand() * 220;
      const len = 30 + rand() * 80;
      const ang = rand() * Math.PI;
      noisyTraces.push({
        isScratch: true, points: [], w: 1.5, net: "SCRATCH",
        x1: cx - Math.cos(ang) * len / 2, y1: cy - Math.sin(ang) * len / 2,
        x2: cx + Math.cos(ang) * len / 2, y2: cy + Math.sin(ang) * len / 2,
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
  ctx.fillStyle = PCB_BG;     ctx.fillRect(0, 0, PCB_W, PCB_H);
  ctx.fillStyle = MASK_COLOR; ctx.fillRect(0, 0, PCB_W, PCB_H);

  if (showGrid) {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < PCB_W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PCB_H); ctx.stroke(); }
    for (let y = 0; y < PCB_H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PCB_W, y); ctx.stroke(); }
  }

  // 보드 외곽
  ctx.strokeStyle = "#4a7a4a"; ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, PCB_W - 4, PCB_H - 4);

  // 실크스크린
  ctx.font = "bold 7px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillText("PCB-300 v3", 252, 297);

  // ── 1) 트레이스 (부품 아래 레이어) ──
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
      // 단선: cut.at 세그먼트를 gap만큼 비움
      const pts = t.points;
      const a = pts[t.cut.at];
      const b = pts[t.cut.at + 1];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const gapRatio = Math.min(0.8, t.cut.gap / Math.max(segLen, 1));
      const m1: Point = [
        a[0] + (b[0] - a[0]) * (0.5 - gapRatio / 2),
        a[1] + (b[1] - a[1]) * (0.5 - gapRatio / 2),
      ];
      const m2: Point = [
        a[0] + (b[0] - a[0]) * (0.5 + gapRatio / 2),
        a[1] + (b[1] - a[1]) * (0.5 + gapRatio / 2),
      ];
      ctx.strokeStyle = color;
      ctx.lineWidth = t.w;
      ctx.lineJoin = "round";
      // 앞 구간 (시작 ~ m1)
      ctx.beginPath();
      for (let i = 0; i <= t.cut.at; i++)
        i === 0 ? ctx.moveTo(pts[i][0], pts[i][1]) : ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.lineTo(m1[0], m1[1]);
      ctx.stroke();
      // 뒤 구간 (m2 ~ 끝)
      ctx.beginPath();
      ctx.moveTo(m2[0], m2[1]);
      for (let i = t.cut.at + 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    } else {
      ctx.beginPath();
      t.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.strokeStyle = color;
      ctx.lineWidth = t.w;
      ctx.lineJoin = "round";
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

    // 트레이스 종단 패드 (패턴 끝은 반드시 패드로 종료)
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

  // ── 2) 부품 (트레이스 위 레이어) ──
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

// ─── 부품 드로잉 (패드 오프셋 = SPEC와 동일) ──────────────────────────────────

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

  // 핀 패드 (본체보다 먼저: 본체가 일부 덮는 실제 모습)
  const pinCount = pins / 2;
  for (let i = 0; i < pinCount; i++) {
    const py = IC_PIN_DY(i);
    // 패드 중심 = ±IC_PAD_DX (= ±39): 본체边(±35)에서 padReach(8)의 절반만큼 나감
    padRect(ctx, -IC_PAD_DX, py, SPEC.IC.padReach, 5, coldSolder);
    padRect(ctx,  IC_PAD_DX, py, SPEC.IC.padReach, 5, coldSolder);
  }

  // 본체
  ctx.fillStyle = coldSolder ? "#2a2020" : "#222";
  ctx.fillRect(ox, oy, w, h);
  ctx.strokeStyle = coldSolder ? "#884444" : "#555";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox, oy, w, h);

  // 핀 리드 (본체에서 패드까지 이어지는 다리)
  for (let i = 0; i < pinCount; i++) {
    const py = IC_PIN_DY(i);
    ctx.fillStyle = "#999";
    ctx.fillRect(ox - 4, py - 1.5, 4, 3);
    ctx.fillRect(w / 2, py - 1.5, 4, 3);
  }

  // 핀1 마커
  ctx.beginPath();
  ctx.arc(ox + 8, oy + 8, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#555";
  ctx.fill();

  ctx.font = "bold 8px monospace";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "center";
  ctx.fillText(label, 0, 2);
  ctx.font = "5px monospace";
  ctx.fillStyle = "#666";
  ctx.fillText("MCU", 0, 10);
  ctx.textAlign = "left";
}

function drawResistor(ctx: CanvasRenderingContext2D, c: ResistorComponent): void {
  const { reversed, coldSolder } = c;
  const dx = SPEC.RES.padDX; // 16
  const bodyLen = 22, bodyH = 11;

  // 패드 (중심 ±16)
  padRect(ctx, -dx, 0, 7, 6, coldSolder);
  padRect(ctx,  dx, 0, 7, 6, coldSolder);

  // 리드선 (패드 ↔ 본체)
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-dx, 0); ctx.lineTo(-bodyLen / 2, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bodyLen / 2, 0); ctx.lineTo(dx, 0); ctx.stroke();

  // 본체
  ctx.fillStyle = coldSolder ? "#3a2010" : "#c8a060";
  ctx.fillRect(-bodyLen / 2, -bodyH / 2, bodyLen, bodyH);
  ctx.strokeStyle = coldSolder ? "#804020" : "#888";
  ctx.lineWidth = 1;
  ctx.strokeRect(-bodyLen / 2, -bodyH / 2, bodyLen, bodyH);

  // 컬러 밴드
  const bands = reversed ? ["#e00", "#888", "#e00"] : ["#c00", "#a00", "#888"];
  bands.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(-bodyLen / 2 + 4 + i * 5, -bodyH / 2, 3, bodyH);
  });

  ctx.font = "5px monospace";
  ctx.fillStyle = "#ddd";
  ctx.textAlign = "center";
  ctx.fillText(c.label, 0, -bodyH / 2 - 2);
  ctx.textAlign = "left";
}

function drawCap(ctx: CanvasRenderingContext2D, c: CapComponent): void {
  const { reversed, coldSolder } = c;
  const dx = SPEC.CAP.padDX; // 13

  // 패드 (중심 ±13)
  padRect(ctx, -dx, 0, 7, 6, coldSolder);
  padRect(ctx,  dx, 0, 7, 6, coldSolder);

  // 리드선
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-dx, 0); ctx.lineTo(-8, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(dx, 0); ctx.stroke();

  // 본체 (원, 중앙)
  ctx.fillStyle = coldSolder ? "#1a2030" : "#2a4a8a";
  ctx.beginPath();
  ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = coldSolder ? "#446688" : "#4a8aff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 극성 마커: 정상 = 양극(+)이 오른쪽 / 반전 = 양극이 왼쪽
  ctx.font = "bold 7px monospace";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  if (reversed) {
    ctx.fillText("+", -4, 3);
    ctx.fillStyle = "#f00";
    ctx.fillText("!", 4, 3);
  } else {
    ctx.fillText("+", 4, 3);
  }
  ctx.textAlign = "left";

  ctx.font = "5px monospace";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "center";
  ctx.fillText(c.label, 0, 17);
  ctx.textAlign = "left";
}

function drawConnector(ctx: CanvasRenderingContext2D, c: ConnectorComponent): void {
  const { pins, label, coldSolder } = c;
  const pitch = SPEC.CONN.pitch, ps = SPEC.CONN.padSize;
  const w = pins * pitch, h = 14;

  // 하우징
  ctx.fillStyle = coldSolder ? "#1a1010" : "#111";
  ctx.fillRect(-2, -2, w + 4, h + 4);
  ctx.strokeStyle = coldSolder ? "#664444" : "#555";
  ctx.lineWidth = 1;
  ctx.strokeRect(-2, -2, w + 4, h + 4);

  // 핀 패드: 핀 i 중심 = (i*pitch + 4, 4)  ← PADS의 J_P와 동일 오프셋
  for (let i = 0; i < pins; i++) {
    padRect(ctx, i * pitch + 4, 4, ps, ps, coldSolder);
  }

  ctx.font = "5px monospace";
  ctx.fillStyle = "#888";
  ctx.fillText(label, 0, h + 8);
}

function drawLED(ctx: CanvasRenderingContext2D, c: LEDComponent): void {
  const { reversed, coldSolder } = c;
  const dx = SPEC.LED.padDX; // 9

  // 패드 (중심 ±9)
  padRect(ctx, -dx, 0, 6, 6, coldSolder);
  padRect(ctx,  dx, 0, 6, 6, coldSolder);

  // 본체
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = coldSolder ? "#1a1a00" : reversed ? "#cc2222" : "#00cc44";
  ctx.fill();
  ctx.strokeStyle = coldSolder ? "#555" : "#fff";
  ctx.lineWidth = 1;
  ctx.stroke();

  // 캐소드 플랫 마커 (정상: 오른쪽 / 반전: 왼쪽)
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const mx = reversed ? -4 : 4;
  ctx.moveTo(mx, -4);
  ctx.lineTo(mx, 4);
  ctx.stroke();

  if (!coldSolder) {
    ctx.beginPath();
    ctx.arc(-1, -1, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fill();
  }

  ctx.font = "5px monospace";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "center";
  ctx.fillText(c.label, 0, 14);
  ctx.textAlign = "left";
}

// ─── UI 상수 & 헬퍼 ────────────────────────────────────────────────────────────

const ANOMALY_TYPES: AnomalyOption[] = [
  { value: "normal",      label: "정상",          color: "#4caf50", emoji: "✅" },
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

  const [anomaly, setAnomaly]               = useState<AnomalyType>("normal");
  const [seed, setSeed]                     = useState<number>(42);
  const [showGrid, setShowGrid]             = useState<boolean>(false);
  const [batchCount, setBatchCount]         = useState<number>(50);
  const [batchProgress, setBatchProgress]   = useState<number | null>(null);
  const [log, setLog]                       = useState<string[]>([]);
  const [selectedAnomalies, setSelectedAnomalies] = useState<Record<AnomalyType, boolean>>(
    Object.fromEntries(ANOMALY_TYPES.map((a) => [a.value, true])) as Record<AnomalyType, boolean>
  );

  const render = useCallback(
    (canvas: HTMLCanvasElement, anomalyType: AnomalyType, s: number): void => {
      const ctx = canvas.getContext("2d");
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
    const active = ANOMALY_TYPES.filter((a) => selectedAnomalies[a.value]);
    if (active.length === 0) return;

    setBatchProgress(0);
    const newLog: string[] = [];
    const perClass = Math.ceil(batchCount / active.length);
    let total = 0;
    let csv = "filename,anomaly_type,anomaly_label,seed\n";

    const off = document.createElement("canvas");
    off.width = PCB_W;
    off.height = PCB_H;
    const offCtx = off.getContext("2d");
    if (!offCtx) return;

    for (const aType of active) {
      for (let i = 0; i < perClass; i++) {
        const s = Math.floor(Math.random() * 999999);
        const { noisyComps, noisyTraces, anomalyInfo } = applyNoise(
          BASE_COMPONENTS, BASE_TRACES, aType.value, s
        );
        drawPCB(offCtx, noisyComps, noisyTraces, false);

        const fname = `pcb_${aType.value}_${String(i).padStart(4, "0")}_s${s}.png`;
        csv += `${fname},${aType.value},${anomalyInfo.description},${s}\n`;

        // 브라우저 자동 다운로드 제한: 처음 5장만
        if (total < 5) {
          const link = document.createElement("a");
          link.download = fname;
          link.href = off.toDataURL("image/png");
          link.click();
          await new Promise<void>((r) => setTimeout(r, 80));
        }

        total++;
        setBatchProgress(Math.round((total / (active.length * perClass)) * 100));
        newLog.push(`${fname} → ${aType.label}`);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    const csvLink = document.createElement("a");
    csvLink.download = "pcb_labels.csv";
    csvLink.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    csvLink.click();

    setLog(newLog.slice(-30));
    setBatchProgress(null);
  };

  const toggleAnomaly = (val: AnomalyType): void =>
    setSelectedAnomalies((prev) => ({ ...prev, [val]: !prev[val] }));

  const currentAnomaly = ANOMALY_TYPES.find((a) => a.value === anomaly);
  const activeCount = ANOMALY_TYPES.filter((a) => selectedAnomalies[a.value]).length;

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "monospace", padding: 20 }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* 헤더 */}
        <div style={{ marginBottom: 20, borderBottom: "1px solid #30363d", paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: "#58a6ff" }}>🔬 PCB 이상탐지 데이터셋 생성기</h1>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8b949e" }}>
            300×300 · 패드-트레이스 정합 · 모든 패턴은 패드에서 종료
          </p>
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>

          {/* 미리보기 */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "#58a6ff" }}>미리보기 (300×300)</span>
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
                  style={{
                    width: 80, background: "#0d1117", border: "1px solid #30363d",
                    color: "#e6edf3", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace",
                  }}
                />
              </div>
            </div>
          </div>

          {/* 컨트롤 */}
          <div style={{ flex: 1, minWidth: 260 }}>

            {/* 이상 유형 */}
            <div style={{ ...panelStyle, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#58a6ff", marginBottom: 12 }}>이상 유형 (미리보기)</div>
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
            <div style={panelStyle}>
              <div style={{ fontSize: 13, color: "#58a6ff", marginBottom: 12 }}>📦 배치 생성</div>

              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>포함할 클래스:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {ANOMALY_TYPES.map((a) => (
                  <label
                    key={a.value}
                    style={{
                      display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                      cursor: "pointer", color: selectedAnomalies[a.value] ? a.color : "#555",
                    }}
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
                  style={{
                    width: 70, background: "#0d1117", border: "1px solid #30363d",
                    color: "#e6edf3", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace",
                  }}
                />
                <span style={{ fontSize: 10, color: "#555" }}>
                  (~{activeCount > 0 ? Math.ceil(batchCount / activeCount) : 0}장/클래스)
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
              <div style={{ color: "#e6edf3", marginBottom: 4 }}>권장 모델 구조</div>
              <div>• CNN 분류 (ResNet18 경량)</div>
              <div>• Autoencoder (재구성 오차)</div>
              <div>• CBAM Attention 위치 탐지</div>
            </div>
            <div>
              <div style={{ color: "#e6edf3", marginBottom: 4 }}>300×300 설정 팁</div>
              <div>• 배치 32 · CPU 에폭 ~2-3분</div>
              <div>• 정상:이상 = 7:3 비율 시작</div>
              <div>• 클래스당 최소 200장 권장</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
