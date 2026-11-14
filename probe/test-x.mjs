import * as snarkjs from "snarkjs";
const wasm="../circuits/gatekeeper.wasm", zkey="../circuits/gatekeeper_final.zkey";
const base={ minimum:"1000", publicBalance:"1460", expiryBlock:"19842201", currentBlock:"19832000",
 recipient:"12345", conditionRecipient:"12345", amount:"500", maxTransfer:"1000",
 registeredVkHash:"777", proofVkHash:"777", taskId:"42", salt:"999", decision:"1" };
for (const [name, inp] of [
  ["base salt=999 task=42", base],
  ["salt=1000", {...base, salt:"1000"}],
  ["task=43", {...base, taskId:"43"}],
  ["amount=501 decision still 1", {...base, amount:"501"}],
]) {
  const {publicSignals} = await snarkjs.groth16.fullProve(inp, wasm, zkey);
  console.log(name, "-> out[0] =", publicSignals[0]);
}
process.exit(0);
