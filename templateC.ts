// ════════════════════════════════════════════════════════════════════════════
//  템플릿 C — 단순 (Autoencoder 베이스라인 / 디버깅용)
//  IC 중앙 + 저항 2 + 커패시터 1
// ════════════════════════════════════════════════════════════════════════════
import {
  PCBTemplate, PCBComponent, Trace, Point,
  resL, resR, capN, capP, icPad,
} from "./types";

const U1 = { x: 150, y: 150 }, IC_W = 60, IC_H = 60, IC_PINS = 8;
// IC 핀 y = 132, 144, 156, 168 / 패드 x = 150 ± 34 → L:116, R:184
const R1 = { x: 60, y: 110 }, R2 = { x: 60, y: 190 };
const C1 = { x: 240, y: 150 };

const L = (p: number): Point => icPad(U1, IC_W, IC_H, IC_PINS, "L", p);
const R = (p: number): Point => icPad(U1, IC_W, IC_H, IC_PINS, "R", p);

const VCC_Y = 10, GND_Y = 290;

const components: PCBComponent[] = [
  { type: "ic",       ...U1, w: IC_W, h: IC_H, pins: IC_PINS, label: "U1" },
  { type: "resistor", ...R1, label: "R1" },
  { type: "resistor", ...R2, label: "R2" },
  { type: "cap",      ...C1, label: "C1" },
];

const traces: Trace[] = [
  // 전원 버스
  { points: [[12, VCC_Y], [288, VCC_Y]], w: 2.2, net: "VCC" },
  { points: [[12, GND_Y], [288, GND_Y]], w: 2.2, net: "GND" },
  // R1 왼쪽 → VCC / R2 왼쪽 → GND (x44, y구간 분리)
  { points: [resL(R1), [resL(R1)[0], VCC_Y]], w: 1.3, net: "VCC" },
  { points: [resL(R2), [resL(R2)[0], GND_Y]], w: 1.3, net: "GND" },
  // R 오른쪽 → IC 좌핀 (x100, y구간 분리: 110-132 / 168-190)
  { points: [resR(R1), [100, R1.y], [100, L(0)[1]], L(0)], w: 1.3, net: "NET1" },
  { points: [resR(R2), [100, R2.y], [100, L(3)[1]], L(3)], w: 1.3, net: "NET2" },
  // IC 좌핀1 → VCC (x108, y10-144)
  { points: [L(1), [108, L(1)[1]], [108, VCC_Y]], w: 1.3, net: "VCC" },
  // IC 우핀0 → C1 양극 (y132 수평 → x253 수직)
  { points: [R(0), [capP(C1)[0], R(0)[1]], capP(C1)], w: 1.3, net: "NET3" },
  // C1 음극 → GND (x227)
  { points: [capN(C1), [capN(C1)[0], GND_Y]], w: 1.2, net: "GND" },
  // IC 우핀3 → GND (x196)
  { points: [R(3), [196, R(3)[1]], [196, GND_Y]], w: 1.3, net: "GND" },
];

const templateC: PCBTemplate = {
  id: "C",
  name: "C · 단순",
  description: "IC + R×2 + C×1 (Autoencoder 베이스라인용)",
  components,
  traces,
};
export default templateC;
