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
    return { ok: true };
  } catch (e) {
    const m = String(e.message || e).match(/line: (\d+)/);
    return { ok: false, line: m ? m[1] : "?" };
  }
}
async function probe(params, salt, extra = {}) {
  const c = P([...params, salt]);
  const inp = {
    matchId: "12345", turnNumber: "1", selfBalance: "100", opponentBalance: "100",
    circuitVersion: "1", salt: String(salt), strategyParams: params.map(String),
    commitment: c, action: "0", amount: "0", ...extra,
  };
  return tryWtns(inp);
}
// baseline all zero
console.log("all-zero params:", JSON.stringify(await probe([0,0,0,0,0,0,0,0], 0)));
// single param = 1 at each index
for (let i = 0; i < 8; i++) {
  const p = [0,0,0,0,0,0,0,0]; p[i] = 1;
  console.log(`param[${i}]=1:`, JSON.stringify(await probe(p, 0)));
}
// single param = 2 at each index
for (let i = 0; i < 8; i++) {
  const p = [0,0,0,0,0,0,0,0]; p[i] = 2;
  console.log(`param[${i}]=2:`, JSON.stringify(await probe(p, 0)));
}
