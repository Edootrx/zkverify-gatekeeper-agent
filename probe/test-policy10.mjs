import { buildPoseidon } from "circomlibjs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (arr) => F.toString(poseidon(arr.map(x => BigInt(x))));
const X = "2708287137618167083071271322118855142826429784436426317679245281225247825385";
const vals = { mid: 12345, t: 1, self: 100, opp: 100, a: 2, amt: 7, ver: 1, zero: 0, one: 1 };
const keys = Object.keys(vals);
let tried = 0;
// all ordered subsets up to length 5 from a focused key set
const focus = ["mid", "t", "opp", "a", "ver", "amt", "self", "zero", "one"];
function* perms(arr, n, prefix = []) {
  if (prefix.length === n) { yield prefix; return; }
  for (const k of arr) { if (!prefix.includes(k)) yield* perms(arr, n, [...prefix, k]); }
}
for (let n = 1; n <= 5; n++) {
  for (const combo of perms(focus, n)) {
    tried++;
    if (P(combo.map(k => vals[k])) === X) { console.log("MATCH:", combo.join(",")); process.exit(0); }
  }
}
console.log("no match in", tried, "combos");
// two-level: poseidon([poseidon([mid]), t]) style quick tries
const two = [
  [P([12345]), 1], [P([12345, 1])], [P([12345]), P([1])],
];
for (const arr of two) { if (P(arr) === X) { console.log("MATCH two-level", arr); process.exit(0); } }
console.log("no two-level match");
