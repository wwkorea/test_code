// ════════════════════════════════════════════════════════════════════════════
//  템플릿 B — 중간 (일반화 검증용)
//  IC 좌측 치우침 + 저항 3 + 커패시터 2 + LED 1 + 커넥터 1
// ════════════════════════════════════════════════════════════════════════════
import {
  PCBTemplate, PCBComponent, Trace, Point,
  resL, resR, capN, capP, ledA, ledK, icPad, connPad,
} from "./types";

const U1 = { x: 110, y: 150 }, IC_W = 60, IC_H = 60, IC_PINS = 8;
// IC 핀 y = 150-30 + 12*(p+1) = 132, 144, 156, 168 / 패드 x = 110 ± 34
const R1 = { x: 46, y: 80 }, R2 = { x: 46, y: 150 }, R3 = { x: 46, y: 220 };
const C1 = { x: 230, y: 110 }, C2 = { x: 230, y: 190 };
const D1 = { x: 230, y: 258 };
const J1 = { x: 20, y: 18 }; // 2핀

const L = (p: number): Point => icPad(U1, IC_W, IC_H, IC_PINS, "L", p);
const R = (p: number): Point => icPad(U1, IC_W, IC_H, IC_PINS, "R", p);

const VCC_Y = 10, GND_Y = 290;

const components: PCBComponent[] = [
  { type: "ic",        ...U1, w: IC_W, h: IC_H, pins: IC_PINS, label: "U1" },
  { type: "resistor",  ...R1, label: "R1" },
  { type: "resistor",  ...R2, label: "R2" },
  { type: "resistor",  ...R3, label: "R3" },
  { type: "cap",       ...C1, label: "C1" },
  { type: "cap",       ...C2, label: "C2" },
  { type: "connector", ...J1, pins: 2, label: "J1" },
  { type: "led",       ...D1, label: "D1" },
];

const traces: Trace[] = [
  // 전원 버스
  { points: [[12, VCC_Y], [288, VCC_Y]], w: 2.2, net: "VCC" },
  { points: [[12, GND_Y], [288, GND_Y]], w: 2.2, net: "GND" },
  // VCC/GND 드롭
  { points: [connPad(J1, 0), [connPad(J1, 0)[0], VCC_Y]], w: 1.4, net: "VCC" },          // J1P0(24,22)→VCC
  { points: [resL(R1), [resL(R1)[0], VCC_Y]], w: 1.3, net: "VCC" },                       // R1L(30,80)→VCC (x30)
  { points: [resL(R3), [resL(R3)[0], GND_Y]], w: 1.3, net: "GND" },                       // R3L(30,220)→GND (x30, y220-290)
  // J1P1(34,22) → R2L(30,150): 좌측 벽 경유 (x16)
  { points: [resL(R2), [16, R2.y], [16, 30], [connPad(J1, 1)[0], 30], connPad(J1, 1)], w: 1.2, net: "SIG1" },
  // 저항 → IC 좌측 핀 (수직 버스 x70, y구간 분리: 80-132 / 144-150 / 156-220)
  { points: [resR(R1), [70, R1.y], [70, L(0)[1]], L(0)], w: 1.3, net: "NET1" },
  { points: [resR(R2), [70, R2.y], [70, L(1)[1]], L(1)], w: 1.3, net: "NET2" },
  { points: [resR(R3), [70, R3.y], [70, L(2)[1]], L(2)], w: 1.3, net: "NET3" },
  // IC 우핀0 → C1 양극 (위로 우회, y88)
  { points: [R(0), [152, R(0)[1]], [152, 88], [capP(C1)[0], 88], capP(C1)], w: 1.3, net: "NET4" },
  // C1 음극 → GND (위로 빠져 우측 벽 x270 경유)
  { points: [capN(C1), [capN(C1)[0], 102], [270, 102], [270, GND_Y]], w: 1.1, net: "GND" },
  // IC 우핀1 → C2 양극 (y176 경유)
  { points: [R(1), [156, R(1)[1]], [156, 176], [capP(C2)[0], 176], capP(C2)], w: 1.3, net: "NET5" },
  // C2 음극 → GND (본체 아래 x226 경유)
  { points: [capN(C2), [226, C2.y], [226, GND_Y]], w: 1.2, net: "GND" },
  // IC 우핀2 → D1 애노드 (x150 수직 → y240 수평)
  { points: [R(2), [150, R(2)[1]], [150, 240], [ledA(D1)[0], 240], ledA(D1)], w: 1.2, net: "NET6" },
  // D1 캐소드 → GND
  { points: [ledK(D1), [ledK(D1)[0], GND_Y]], w: 1.2, net: "GND" },
  // IC 우핀3 → GND (x148)
  { points: [R(3), [148, R(3)[1]], [148, GND_Y]], w: 1.3, net: "GND" },
];

const templateB: PCBTemplate = {
  id: "B",
  name: "B · 중간",
  description: "IC 좌측 배치 + R×3 + C×2 + LED×1 (일반화 검증용)",
  components,
  traces,
};
export default templateB;
