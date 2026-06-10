// ════════════════════════════════════════════════════════════════════════════
//  템플릿 D — 변형 배치 (구조 다양성용)
//  IC 좌하단 + 저항 3 상단 가로 배열 + 커패시터 2 우측 + LED 1
// ════════════════════════════════════════════════════════════════════════════
import {
  PCBTemplate, PCBComponent, Trace, Point,
  resL, resR, capN, capP, ledA, ledK, icPad, connPad,
} from "./types";

const U1 = { x: 90, y: 210 }, IC_W = 60, IC_H = 60, IC_PINS = 8;
// IC 핀 y = 210-30 + 12*(p+1) = 192, 204, 216, 228 / 패드 x = 90 ± 34 → L:56, R:124
const R1 = { x: 70,  y: 60 }, R2 = { x: 160, y: 60 }, R3 = { x: 230, y: 60 };
const C1 = { x: 230, y: 140 }, C2 = { x: 230, y: 220 };
const D1 = { x: 180, y: 258 };
const J1 = { x: 130, y: 18 }; // 2핀: P0(134,22), P1(144,22)

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
  // VCC 드롭
  { points: [connPad(J1, 0), [connPad(J1, 0)[0], VCC_Y]], w: 1.4, net: "VCC" },     // (134,22)→(134,10)
  { points: [resL(R1), [resL(R1)[0], VCC_Y]], w: 1.3, net: "VCC" },                  // (54,60)→(54,10)
  { points: [resL(R3), [resL(R3)[0], VCC_Y]], w: 1.3, net: "VCC" },                  // (214,60)→(214,10)
  // J1P1(144,22) → R2 왼쪽(144,60): 수직 일치
  { points: [connPad(J1, 1), resL(R2)], w: 1.2, net: "SIG1" },
  // R1 오른쪽 → IC 좌핀0: (86,60)→x94↓y176→x48↓→(56,192)
  { points: [resR(R1), [94, R1.y], [94, 176], [48, 176], [48, L(0)[1]], L(0)], w: 1.3, net: "NET1" },
  // R2 오른쪽 → IC 우핀0: (176,60)→x176↓y120→x132↓→(124,192)
  { points: [resR(R2), [resR(R2)[0], 120], [132, 120], [132, R(0)[1]], R(0)], w: 1.3, net: "NET2" },
  // R3 오른쪽 → C1 양극: (246,60)→x252↓y126→(243,140)
  { points: [resR(R3), [252, R3.y], [252, 126], [capP(C1)[0], 126], capP(C1)], w: 1.3, net: "NET3" },
  // C1 음극 → IC 우핀1: (217,140)→x208↓y160→x140↓→(124,204)
  { points: [capN(C1), [208, C1.y], [208, 160], [140, 160], [140, R(1)[1]], R(1)], w: 1.2, net: "NET4" },
  // C2: 디커플링 (양극→VCC 우측벽 x258, 음극→GND x217)
  { points: [capP(C2), [258, C2.y], [258, VCC_Y]], w: 1.1, net: "VCC" },
  { points: [capN(C2), [capN(C2)[0], GND_Y]], w: 1.2, net: "GND" },
  // IC 우핀2 → D1 애노드: (171,258)→x171↑y236→x140↓?  ─ 역방향 기재 (패드→패드)
  { points: [ledA(D1), [ledA(D1)[0], 236], [140, 236], [140, R(2)[1]], R(2)], w: 1.2, net: "NET5" },
  // D1 캐소드 → GND
  { points: [ledK(D1), [ledK(D1)[0], GND_Y]], w: 1.2, net: "GND" },
  // IC 우핀3 → GND (x132, y228-290; NET2의 x132는 y120-192이므로 분리)
  { points: [R(3), [132, R(3)[1]], [132, GND_Y]], w: 1.3, net: "GND" },
  // IC 좌핀3 → GND (x48, y228-290; NET1의 x48은 y176-192이므로 분리)
  { points: [L(3), [48, L(3)[1]], [48, GND_Y]], w: 1.3, net: "GND" },
];

const templateD: PCBTemplate = {
  id: "D",
  name: "D · 변형",
  description: "IC 좌하단 + R 상단 가로열 + C×2 + LED×1 (배치 다양성용)",
  components,
  traces,
};
export default templateD;
