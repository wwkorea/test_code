// ════════════════════════════════════════════════════════════════════════════
//  템플릿 A — 복잡 (메인 학습용)
//  IC 중앙 + 저항 5 + 커패시터 3 + LED 2 + 커넥터 2
// ════════════════════════════════════════════════════════════════════════════
import {
  PCBTemplate, PCBComponent, Trace, Point,
  resL, resR, capN, capP, ledA, ledK, icPad, connPad,
} from "./types";

const U1 = { x: 150, y: 140 }, IC_W = 70, IC_H = 70, IC_PINS = 8;
const R1 = { x: 42,  y: 75  }, R2 = { x: 42,  y: 140 }, R3 = { x: 42,  y: 205 };
const R4 = { x: 258, y: 75  }, R5 = { x: 258, y: 205 };
const C1 = { x: 258, y: 140 }, C2 = { x: 60,  y: 258 }, C3 = { x: 240, y: 258 };
const J1 = { x: 22,  y: 18  }, J2 = { x: 248, y: 18  };
const D1 = { x: 130, y: 258 }, D2 = { x: 170, y: 258 };

const L = (p: number): Point => icPad(U1, IC_W, IC_H, IC_PINS, "L", p);
const R = (p: number): Point => icPad(U1, IC_W, IC_H, IC_PINS, "R", p);

const VCC_Y = 10, GND_Y = 290;

const components: PCBComponent[] = [
  { type: "ic",        ...U1, w: IC_W, h: IC_H, pins: IC_PINS, label: "U1" },
  { type: "resistor",  ...R1, label: "R1" }, { type: "resistor", ...R2, label: "R2" },
  { type: "resistor",  ...R3, label: "R3" }, { type: "resistor", ...R4, label: "R4" },
  { type: "resistor",  ...R5, label: "R5" },
  { type: "cap",       ...C1, label: "C1" }, { type: "cap", ...C2, label: "C2" },
  { type: "cap",       ...C3, label: "C3" },
  { type: "connector", ...J1, pins: 3, label: "J1" },
  { type: "connector", ...J2, pins: 2, label: "J2" },
  { type: "led",       ...D1, label: "D1" }, { type: "led", ...D2, label: "D2" },
];

const traces: Trace[] = [
  // 전원 버스
  { points: [[12, VCC_Y], [288, VCC_Y]], w: 2.2, net: "VCC" },
  { points: [[12, GND_Y], [288, GND_Y]], w: 2.2, net: "GND" },
  // VCC 드롭
  { points: [connPad(J1, 0), [connPad(J1, 0)[0], VCC_Y]], w: 1.4, net: "VCC" },
  { points: [connPad(J2, 0), [connPad(J2, 0)[0], VCC_Y]], w: 1.4, net: "VCC" },
  { points: [resR(R1), [resR(R1)[0] + 8, R1.y], [resR(R1)[0] + 8, VCC_Y]], w: 1.3, net: "VCC" },
  { points: [resR(R4), [resR(R4)[0] + 8, R4.y], [resR(R4)[0] + 8, VCC_Y]], w: 1.3, net: "VCC" },
  { points: [L(0), [L(0)[0] - 10, L(0)[1]], [L(0)[0] - 10, 40], [150, 40], [150, VCC_Y]], w: 1.3, net: "VCC" },
  { points: [capP(C2), [capP(C2)[0] + 8, C2.y], [capP(C2)[0] + 8, 232], [12, 232], [12, VCC_Y]], w: 1.1, net: "VCC" },
  // GND 드롭
  { points: [resL(R3), [resL(R3)[0] - 8, R3.y], [resL(R3)[0] - 8, GND_Y]], w: 1.3, net: "GND" },
  { points: [capN(C2), [capN(C2)[0], GND_Y]], w: 1.2, net: "GND" },
  { points: [capN(C3), [capN(C3)[0], GND_Y]], w: 1.2, net: "GND" },
  { points: [ledK(D1), [ledK(D1)[0], GND_Y]], w: 1.2, net: "GND" },
  { points: [ledK(D2), [ledK(D2)[0], GND_Y]], w: 1.2, net: "GND" },
  { points: [R(3), [R(3)[0] + 10, R(3)[1]], [R(3)[0] + 10, 232], [210, 232], [210, GND_Y]], w: 1.3, net: "GND" },
  { points: [capN(C1), [capN(C1)[0] - 8, C1.y], [capN(C1)[0] - 8, 170], [288, 170], [288, GND_Y]], w: 1.1, net: "GND" },
  // 신호 네트
  { points: [resL(R1), [resL(R1)[0] - 8, R1.y], [resL(R1)[0] - 8, 100], [88, 100], [88, L(1)[1]], L(1)], w: 1.3, net: "NET1" },
  { points: [resL(R2), [resL(R2)[0] - 8, R2.y], [resL(R2)[0] - 8, L(2)[1]], L(2)], w: 1.3, net: "NET2" },
  { points: [resR(R3), [resR(R3)[0] + 8, R3.y], [resR(R3)[0] + 8, L(3)[1]], L(3)], w: 1.3, net: "NET3" },
  { points: [connPad(J1, 1), [connPad(J1, 1)[0], 52], [70, 52], [70, R2.y - 18], [resR(R2)[0] + 6, R2.y - 18], [resR(R2)[0] + 6, R2.y], resR(R2)], w: 1.2, net: "SIG1" },
  { points: [connPad(J1, 2), [connPad(J1, 2)[0], 46], [58, 46], [58, 60], [resL(R1)[0] - 14, 60], [resL(R1)[0] - 14, R1.y]], w: 1.1, net: "SIG2" },
  { points: [R(0), [R(0)[0] + 8, R(0)[1]], [R(0)[0] + 8, R4.y], resL(R4)], w: 1.3, net: "OUT" },
  { points: [connPad(J2, 1), [connPad(J2, 1)[0], 50], [R(0)[0] + 8, 50], [R(0)[0] + 8, R(0)[1]]], w: 1.2, net: "OUT" },
  { points: [R(1), [R(1)[0] + 14, R(1)[1]], [R(1)[0] + 14, C1.y - 16], [capP(C1)[0], C1.y - 16], capP(C1)], w: 1.3, net: "NET5" },
  { points: [R(2), [R(2)[0] + 20, R(2)[1]], [R(2)[0] + 20, R5.y], resR(R5)], w: 1.3, net: "NET6" },
  { points: [resL(R5), [resL(R5)[0] - 8, R5.y], [resL(R5)[0] - 8, capP(C3)[1] - 14], [capP(C3)[0], capP(C3)[1] - 14], capP(C3)], w: 1.2, net: "NET6" },
  { points: [ledA(D1), [ledA(D1)[0], 236], [150, 236], [150, 220], [R(2)[0] + 20, 220], [R(2)[0] + 20, R(2)[1]]], w: 1.1, net: "NET6" },
  { points: [ledA(D2), [ledA(D2)[0], 236], [150, 236]], w: 1.1, net: "NET6" },
];

const templateA: PCBTemplate = {
  id: "A",
  name: "A · 복잡",
  description: "IC + R×5 + C×3 + LED×2 + CONN×2 (메인 학습용)",
  components,
  traces,
};
export default templateA;
