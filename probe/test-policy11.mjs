import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import fs from "fs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (arr) => F.toString(poseidon(arr.map(x => BigInt(x))));
const wasm = "../circuits/vfy-policy.wasm";
const zkey = "../circuits/vfy-policy_final.zkey";
const params = [10, 0, 0, 0, 0, 0, 0, 0];
const salt = "98765432109876543210";
const commitment = P([...params, BigInt(salt)]);
console.log("commitment:", commitment);
const inp = {
  matchId: "12345", circuitVersion: "1", salt,
  strategyParams: params.map(String), commitment,
  action: "2", amount: "10", turnNumber: "1", selfBalance: "100", opponentBalance: "100",
};
const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(inp, wasm, zkey);
console.log("prove ms:", Date.now() - t0);
console.log("publicSignals:", JSON.stringify(publicSignals));
const vk = await snarkjs.zKey.exportVerificationKey(zkey);
const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
console.log("verify:", ok);
// also a HOLD case (opp=0) and check X binding there
const inp2 = { ...inp, opponentBalance: "0", action: "0", amount: "0" };
const r2 = await snarkjs.groth16.fullProve(inp2, wasm, zkey);
console.log("hold case pub:", JSON.stringify(r2.publicSignals), "verify:", await snarkjs.groth16.verify(vk, r2.publicSignals, r2.proof));
fs.writeFileSync("policy-vk.json", JSON.stringify(vk));
