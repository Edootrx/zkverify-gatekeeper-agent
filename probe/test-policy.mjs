import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (arr) => F.toString(poseidon(arr.map(x => BigInt(x))));
const wasm = "../circuits/vfy-policy.wasm";

async function tryWtns(input, label) {
  try {
    const wtns = { type: "mem" };
    await snarkjs.wtns.calculate(input, wasm, wtns);
    const json = await snarkjs.wtns.exportJson(wtns);
    console.log("PASS", label, "| witness[1..9]:", json.slice(1, 10).join(","));
    return json;
  } catch (e) {
    console.log("FAIL", label, "|", String(e.message || e).slice(0, 160));
    return null;
  }
}

// Benign state: turn 1, balances 100/100, version 1, matchId 0, params all zero, salt 0
const base = {
  matchId: "0", turnNumber: "1", selfBalance: "100", opponentBalance: "100",
  circuitVersion: "1", salt: "0",
  strategyParams: ["0","0","0","0","0","0","0","0"],
};
const layouts = {
  "params+salt": () => P([0,0,0,0,0,0,0,0,0]),
  "salt+params": () => P([0,0,0,0,0,0,0,0,0]),
  "params only": () => P([0,0,0,0,0,0,0,0]),
  "zero": () => "0",
  "one": () => "1",
};
// params+salt and salt+params coincide when everything is 0; still try each action
for (const [lname, fn] of Object.entries(layouts)) {
  const c = fn();
  for (const action of [0, 1, 2]) {
    const inp = { ...base, commitment: c, action: String(action), amount: "0" };
    const ok = await tryWtns(inp, `${lname} commitment=${c.slice(0, 20)}... action=${action} amount=0`);
    if (ok) { console.log("WINNER layout:", lname); process.exit(0); }
  }
}
console.log("no winner yet");
