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
console.log("— A: p3 nature (state 100/100, try extract a2 amt=p0 and hold a0)");
for (const [p0, p3] of [[7,2],[7,5],[7,7],[7,8],[7,9],[10,8],[10,9],[10,10],[20,15],[11,0]]) {
  const params = [p0,0,p3,0,0,0,0,0];
  console.log(`p0=${p0} p3=${p3}: a2=${await probe(params, S(100,100), 2, p0)} a0=${await probe(params, S(100,100), 0, 0)} a1=${await probe(params, S(100,100), 1, 0)}`);
}
console.log("— B: precedence fortify(self<p1) vs hold(opp<=p2), state self=20 opp=100");
{
  const params = [7,50,0,100,0,0,0,0]; // p1=50, p2=100 — wait order: [p0,p1,p2,p3]; fix below
}
{
  const params = [7,50,100,0,0,0,0,0];
  console.log("p1=50 p2=100 self=20 opp=100:", "a0=" + await probe(params, S(20,100), 0, 0), "a1=" + await probe(params, S(20,100), 1, 0), "a2=" + await probe(params, S(20,100), 2, 7));
  const params2 = [7,0,100,1,0,0,0,0]; // p2=100, p3=1
  console.log("p2=100 p3=1 self=20 opp=100:", "a0=" + await probe(params2, S(20,100), 0, 0), "a1=" + await probe(params2, S(20,100), 1, 0), "a2=" + await probe(params2, S(20,100), 2, 7));
  const params3 = [7,50,0,1,0,0,0,0]; // p1=50, p3=1
  console.log("p1=50 p3=1 self=20 opp=100:", "a0=" + await probe(params3, S(20,100), 0, 0), "a1=" + await probe(params3, S(20,100), 1, 0), "a2=" + await probe(params3, S(20,100), 2, 7));
}
console.log("— C: extract amount vs opp balance (p0=7)");
{
  const params = [7,0,0,0,0,0,0,0];
  console.log("opp=3 amt7:", await probe(params, S(100,3), 2, 7), "| amt3:", await probe(params, S(100,3), 2, 3));
  console.log("opp=7 amt7:", await probe(params, S(100,7), 2, 7));
  console.log("opp=6 amt7:", await probe(params, S(100,6), 2, 7), "| amt6:", await probe(params, S(100,6), 2, 6));
}
console.log("— D: fortify with tiny self balance (p1=50)");
{
  const params = [7,50,0,0,0,0,0,0];
  console.log("self=1 a1:", await probe(params, S(1,100), 1, 0), "| self=0 a1:", await probe(params, S(0,100), 1, 0), "| self=2 a1:", await probe(params, S(2,100), 1, 0));
}
