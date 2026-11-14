import * as snarkjs from "snarkjs";
const wasm="../circuits/gatekeeper.wasm", zkey="../circuits/gatekeeper_final.zkey";
const base={ minimum:"1000", publicBalance:"1460", expiryBlock:"19842201", currentBlock:"19832000",
 recipient:"12345", conditionRecipient:"12345", amount:"500", maxTransfer:"1000",
 registeredVkHash:"777", proofVkHash:"777", taskId:"42", salt:"999", decision:"1" };
async function tryCase(name, inp){
  try{
    const {proof, publicSignals} = await snarkjs.groth16.fullProve(inp, wasm, zkey);
    console.log("OK  ", name, "| publicSignals:", publicSignals);
    return {proof, publicSignals};
  }catch(e){ console.log("FAIL", name, "|", String(e.message||e).slice(0,120)); return null; }
}
await tryCase("valid + decision=1 (expect OK)", base);
await tryCase("valid + decision=0 (expect FAIL if circuit enforces)", {...base, decision:"0"});
await tryCase("vk mismatch + decision=1 (expect FAIL)", {...base, proofVkHash:"778"});
await tryCase("vk mismatch + decision=0 (expect OK)", {...base, proofVkHash:"778", decision:"0"});
await tryCase("balance<min + decision=0 (expect OK)", {...base, publicBalance:"999", decision:"0"});
await tryCase("balance<min + decision=1 (expect FAIL)", {...base, publicBalance:"999"});
await tryCase("expired + decision=0 (expect OK)", {...base, currentBlock:"19842202", decision:"0"});
await tryCase("expired + decision=1 (expect FAIL)", {...base, currentBlock:"19842202"});
await tryCase("recipient mismatch + decision=0 (expect OK)", {...base, recipient:"99999", decision:"0"});
await tryCase("amount>max + decision=0 (expect OK)", {...base, amount:"1001", decision:"0"});
await tryCase("amount>max + decision=1 (expect FAIL)", {...base, amount:"1001"});
await tryCase("boundary balance==min decision=1", {...base, publicBalance:"1000"});
await tryCase("boundary current==expiry decision=1", {...base, currentBlock:"19842201"});
await tryCase("boundary amount==max decision=1", {...base, amount:"1000"});
await tryCase("different salt decision=1", {...base, salt:"123456"});
await tryCase("different taskId decision=1", {...base, taskId:"424242"});
process.exit(0);
