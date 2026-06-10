// ════════════════════════════════════════════════════════════════════════════
//  공용 타입 & 패드 계산 헬퍼
//  - 모든 템플릿과 구동 파일이 이 파일의 타입/헬퍼를 공유한다.
//  - 패드 좌표 계산식이 여기 한 곳에만 존재 → 드로잉과 트레이스가 항상 일치.
// ════════════════════════════════════════════════════════════════════════════

export const PCB_W = 300;
export const PCB_H = 300;

export type Point = [number, number];
export type ComponentType = "ic" | "resistor" | "cap" | "connector" | "led";
export type AnomalyType =
  | "open" | "bridge" | "misalign" | "missing"
  | "polarity" | "scratch" | "solder_cold";

export interface BaseComponent {
  type: ComponentType;
  x: number;            // 부품 중심 x
  y: number;            // 부품 중심 y
  angle?: number;
  label: string;
  missing?: boolean;
  reversed?: boolean;
  coldSolder?: boolean;
}
export interface ICComponent        extends BaseComponent { type: "ic"; w: number; h: number; pins: number; }
export interface ResistorComponent  extends BaseComponent { type: "resistor"; }
export interface CapComponent       extends BaseComponent { type: "cap"; }
export interface ConnectorComponent extends BaseComponent { type: "connector"; pins: number; }
export interface LEDComponent       extends BaseComponent { type: "led"; }
export type PCBComponent =
  | ICComponent | ResistorComponent | CapComponent
  | ConnectorComponent | LEDComponent;

export interface TraceCut { at: number; gap: number; }
export interface Trace {
  points: Point[];      // 첫/마지막 점은 반드시 패드 좌표
  w: number;
  net: string;
  cut?: TraceCut;
  isBridge?: boolean;
  isScratch?: boolean;
  x1?: number; y1?: number; x2?: number; y2?: number;
}

export interface PCBTemplate {
  id: string;           // 파일명에 들어갈 식별자 (예: "A")
  name: string;         // UI 표시명
  description: string;
  components: PCBComponent[];
  traces: Trace[];
}

// ─── 패드 오프셋 규격 (부품 중심 기준) ────────────────────────────────────────
//  드로잉 함수(구동 파일)와 템플릿의 패드 좌표 계산이 모두 이 값을 사용한다.

export const SPEC = {
  RES_DX: 16,                       // 저항: 패드중심 = 중심 ± 16
  CAP_DX: 13,                       // 커패시터: 음극 -13 / 양극 +13
  LED_DX: 9,                        // LED: 애노드 -9 / 캐소드 +9
  IC_PAD_REACH: 8,                  // IC 패드 가로 길이
  CONN_PITCH: 10,                   // 커넥터 핀 간격
  CONN_PAD: 8,                      // 커넥터 패드 크기
} as const;

interface XY { x: number; y: number; }

// 저항 패드: 왼쪽/오른쪽
export const resL = (c: XY): Point => [c.x - SPEC.RES_DX, c.y];
export const resR = (c: XY): Point => [c.x + SPEC.RES_DX, c.y];

// 커패시터 패드: 음극(N)/양극(P)
export const capN = (c: XY): Point => [c.x - SPEC.CAP_DX, c.y];
export const capP = (c: XY): Point => [c.x + SPEC.CAP_DX, c.y];

// LED 패드: 애노드(A)/캐소드(K)
export const ledA = (c: XY): Point => [c.x - SPEC.LED_DX, c.y];
export const ledK = (c: XY): Point => [c.x + SPEC.LED_DX, c.y];

// IC 패드: side 'L'|'R', pin 0부터 위→아래. 핀 수는 한쪽당 pins/2.
export const icPad = (c: XY, w: number, h: number, pins: number, side: "L" | "R", pin: number): Point => {
  const dx = w / 2 + SPEC.IC_PAD_REACH / 2;
  const perSide = pins / 2;
  const dy = -h / 2 + (h / (perSide + 1)) * (pin + 1);
  return [c.x + (side === "L" ? -dx : dx), c.y + dy];
};

// 커넥터 핀 패드: 핀 i 중심 = (x + i*pitch + 4, y + 4)
export const connPad = (c: XY, pin: number): Point =>
  [c.x + pin * SPEC.CONN_PITCH + 4, c.y + 4];
