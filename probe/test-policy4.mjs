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
    return { ok: false, line: m ? m[1] : "?" };
  }
}
async function probe(params, salt, state, action, amount) {
  const inp = {
    matchId: "12345", circuitVersion: "1", salt: String(salt),
    strategyParams: params.map(String), commitment: P([...params, salt]),
    action: String(action), amount: String(amount),
    turnNumber: String(state.turn), selfBalance: String(state.self), opponentBalance: String(state.opp),
  };
  return tryWtns(inp);
}
const state = { turn: 1, self: 100, opp: 100 };
for (const p0 of [0, 1, 2, 3, 5, 10]) {
  const params = [p0, 0, 0, 0, 0, 0, 0, 0];
  for (const action of [0, 1, 2]) {
    for (const amount of [0, 1, 5, 10]) {
      const r = await probe(params, 0, state, action, amount);
      console.log(`p0=${p0} action=${action} amount=${amount} ->`, r.ok ? "FULL PASS pub=" + r.pub.join(",") : "line " + r.line);
    }
  }
}
