import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (arr) => F.toString(poseidon(arr.map(x => BigInt(x))));
const wasm = "../circuits/vfy-policy.wasm";
async function probe(params, state, action, amount) {
  const inp = {
    matchId: "12345", circuitVersion: "1", salt: "0",
    strategyParams: params.map(String), commitment: P([...params, 0]),
    action: String(action), amount: String(amount),
    turnNumber: String(state.turn), selfBalance: String(state.self), opponentBalance: String(state.opp),
  };
  try { const w = { type: "mem" }; await snarkjs.wtns.calculate(inp, wasm, w); return "PASS"; }
  catch (e) { const m = String(e.message || e).match(/line: (\d+)/); return "L" + (m ? m[1] : "?"); }
}
const states = [
  { turn: 1, self: 100, opp: 100 }, { turn: 1, self: 50, opp: 100 }, { turn: 1, self: 100, opp: 50 },
  { turn: 1, self: 150, opp: 100 }, { turn: 1, self: 100, opp: 150 }, { turn: 10, self: 100, opp: 100 },
  { turn: 19, self: 100, opp: 100 }, { turn: 20, self: 100, opp: 100 }, { turn: 1, self: 20, opp: 100 },
  { turn: 1, self: 100, opp: 20 },
];
for (const idx of [1, 2, 3]) {
  for (const v of [1, 10, 50, 100]) {
    const params = [7, 0, 0, 0, 0, 0, 0, 0]; params[idx] = v;
    const hits = [];
    for (const st of states) {
      for (const action of [0, 1]) {
        const r = await probe(params, st, action, 0);
        if (r === "PASS") hits.push(`a${action}@(t${st.turn},${st.self},${st.opp})`);
      }
      const r2 = await probe(params, st, 2, 7);
      if (r2 !== "PASS") hits.push(`a2FAIL(${r2})@(t${st.turn},${st.self},${st.opp})`);
    }
    console.log(`p${idx}=${v}:`, hits.length ? hits.join(" ") : "(extract always, no hold/fortify)");
  }
}
