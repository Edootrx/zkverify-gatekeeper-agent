import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (arr) => F.toString(poseidon(arr.map(x => BigInt(x))));
const wasm = "../circuits/vfy-policy.wasm";
async function run(over) {
  const params = [7, 0, 0, 0, 0, 0, 0, 0];
  const inp = {
    matchId: "12345", circuitVersion: "1", salt: "0",
    strategyParams: params.map(String), commitment: P([...params, 0]),
    action: "2", amount: "7", turnNumber: "1", selfBalance: "100", opponentBalance: "100",
    ...over,
  };
  if (over.salt !== undefined) inp.commitment = P([...params, Number(over.salt)]);
  const w = { type: "mem" };
  await snarkjs.wtns.calculate(inp, wasm, w);
  const json = await snarkjs.wtns.exportJson(w);
  return json.slice(1, 10);
}
console.log("base      :", (await run({})).join(","));
console.log("salt=5    :", (await run({ salt: "5" })).join(","));
console.log("mid=999   :", (await run({ matchId: "999" })).join(","));
console.log("turn=7    :", (await run({ turnNumber: "7" })).join(","));
console.log("self=55   :", (await run({ selfBalance: "55" })).join(","));
console.log("ver=1 only var circuitVersion same; done");
