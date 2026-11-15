import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (arr) => F.toString(poseidon(arr.map(x => BigInt(x))));
const wasm = "../circuits/vfy-policy.wasm";

async function tryWtns(input) {
  try {
    const wtns = { type: "mem" };
    await snarkjs.wtns.calculate(input, wasm, wtns);
    const json = await snarkjs.wtns.exportJson(wtns);
    return { ok: true, pub: json.slice(1, 10) };
  } catch (e) {
    const m = String(e.message || e).match(/line: (\d+)/);
    return { ok: false, line: m ? m[1] : "?", msg: String(e.message || e).slice(0, 80) };
  }
}
const params = [1, 2, 3, 4, 5, 6, 7, 8], salt = 9;
const layouts = {
  "params+salt": P([...params, salt]),
  "salt+params": P([salt, ...params]),
  "paramsOnly": P(params),
  "params+salt+ver": P([...params, salt, 1]),
  "ver+params+salt": P([1, ...params, salt]),
};
const base = {
  matchId: "12345", turnNumber: "1", selfBalance: "100", opponentBalance: "100",
  circuitVersion: "1", salt: String(salt), strategyParams: params.map(String),
};
for (const [lname, c] of Object.entries(layouts)) {
  for (const action of [0, 1, 2]) {
    const r = await tryWtns({ ...base, commitment: c, action: String(action), amount: "0" });
    console.log(lname.padEnd(16), "action", action, r.ok ? "PASS pub=" + r.pub.join(",") : "fail line " + r.line);
    if (r.ok) process.exit(0);
  }
}
