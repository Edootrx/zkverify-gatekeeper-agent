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
const S = (self, opp, turn = 1) => ({ turn, self, opp });
console.log("— p3 (index 3) values 2..9, state 100/100");
for (const v of [2, 3, 5, 9]) {
  const params = [7, 0, 0, v, 0, 0, 0, 0];
  console.log(`p3=${v}: a0=${await probe(params, S(100,100), 0, 0)} a1=${await probe(params, S(100,100), 1, 0)} a2=${await probe(params, S(100,100), 2, 7)}`);
}
console.log("— X identification: observed X for (mid=12345,t=1,self=100,opp=100,a=2,amt=1,ver=1):");
const X = "2708287137618167083071271322118855142826429784436426317679245281225247825385";
console.log("observed:", X);
const cands = {
  "P(mid,t,self,opp,a,ver)": [12345, 1, 100, 100, 2, 1],
  "P(mid,t,self,opp,a,amt,ver)": [12345, 1, 100, 100, 2, 1, 1],
  "P(mid,t,self,opp)": [12345, 1, 100, 100],
  "P(self,opp,a)": [100, 100, 2],
  "P(mid,t,self,opp,a)": [12345, 1, 100, 100, 2],
  "P(t,self,opp,a,amt)": [1, 100, 100, 2, 1],
  "P(mid,self,opp)": [12345, 100, 100],
  "P(1)": [1],
  "P(0)": [0],
  "P(mid)": [12345],
  "P(mid,t)": [12345, 1],
};
for (const [k, arr] of Object.entries(cands)) {
  const v = P(arr);
  console.log(k, v === X ? "*** MATCH ***" : v.slice(0, 24) + "...");
}
