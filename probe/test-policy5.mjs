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
  try {
    const wtns = { type: "mem" };
    await snarkjs.wtns.calculate(inp, wasm, wtns);
    return "PASS";
  } catch (e) {
    const m = String(e.message || e).match(/line: (\d+)/);
    return "L" + (m ? m[1] : "?");
  }
}
const params = [7, 0, 0, 0, 0, 0, 0, 0];
const states = [
  { turn: 1, self: 100, opp: 100 }, { turn: 1, self: 50, opp: 100 }, { turn: 1, self: 100, opp: 50 },
  { turn: 1, self: 10, opp: 100 }, { turn: 1, self: 100, opp: 10 }, { turn: 1, self: 0, opp: 100 },
  { turn: 1, self: 100, opp: 0 }, { turn: 10, self: 100, opp: 100 }, { turn: 19, self: 100, opp: 100 },
  { turn: 20, self: 100, opp: 100 }, { turn: 20, self: 90, opp: 100 }, { turn: 20, self: 110, opp: 100 },
  { turn: 5, self: 30, opp: 120 }, { turn: 5, self: 120, opp: 30 },
];
for (const st of states) {
  const row = [];
  for (const action of [0, 1, 2]) {
    const amt = action === 2 ? 7 : 0;
    row.push(`a${action}:${await probe(params, st, action, amt)}`);
  }
  console.log(`turn=${st.turn} self=${st.self} opp=${st.opp} ->`, row.join("  "));
}
