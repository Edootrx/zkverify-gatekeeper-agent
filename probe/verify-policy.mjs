import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import fs from "fs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (arr) => F.toString(poseidon(arr.map(x => BigInt(x))));
const params = [10, 0, 0, 0, 0, 0, 0, 0];
const salt = "98765432109876543210";
const inp = {
  matchId: "12345", circuitVersion: "1", salt,
  strategyParams: params.map(String), commitment: P([...params, BigInt(salt)]),
  action: "2", amount: "10", turnNumber: "1", selfBalance: "100", opponentBalance: "100",
};
const { proof, publicSignals } = await snarkjs.groth16.fullProve(inp, "../circuits/vfy-policy.wasm", "../circuits/vfy-policy_final.zkey");
fs.writeFileSync("policy-proof.json", JSON.stringify({ proof, publicSignals }));
console.log("proved. pub:", JSON.stringify(publicSignals));
