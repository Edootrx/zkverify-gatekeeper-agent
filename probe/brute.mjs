import fs from "fs";
function fnvHash(str){ const M=(1n<<64n); let h=0xCBF29CE484222325n; for(let i=0;i<str.length;i++){ h^=BigInt(str.charCodeAt(i)); h=(h*0x100000001B3n)%M;} return h.toString(16).padStart(16,'0'); }
const buf = fs.readFileSync("../circuits/gatekeeper.wasm");
const mod = await WebAssembly.compile(buf);
// need imports: circom wasm expects some env? WitnessCalculator instantiates with imports {env:{...}}? try empty + runtime helpers
let instance;
try { instance = await WebAssembly.instantiate(mod, {}); }
catch(e){ console.log("instantiate no imports failed:", e.message); 
  // try with snarkjs builder to get instance
  const {default: WitnessCalculatorBuilder} = await import("./node_modules/circom_runtime/js/witness_calculator.js");
  const wc = await WitnessCalculatorBuilder(buf);
  instance = wc.instance;
}
const exp = instance.exports;
console.log("exports sample:", Object.keys(exp).filter(k=>/Input|Signal|Version/i.test(k)));
function size(name){
  const h=fnvHash(name); const msb=parseInt(h.slice(0,8),16), lsb=parseInt(h.slice(8,16),16);
  try { return exp.getInputSignalSize(msb, lsb); } catch(e){ return -999; }
}
const stems = [
 // task fields snake
 "registered_vk","proof_vk","minimum","public_balance","expiry_block","current_block","recipient","condition_recipient","amount","max_transfer","proof_tx","task_id","decision","reason_code","reason",
 // camel
 "registeredVk","proofVk","publicBalance","expiryBlock","currentBlock","conditionRecipient","maxTransfer","proofTx","taskId","reasonCode",
 // flags
 "vk_match","vkMatch","vk_matches","vkMatches","is_vk_match","threshold_met","thresholdMet","threshold_ok","thresholdOk","balance_ok","recipient_match","recipientMatch","recipient_ok","not_expired","notExpired","expired","amount_ok","amountOk","amount_within_cap","not_reused","notReused","reused","proof_reused","proofValid","proof_valid","is_valid","valid","approved","approve","all_checks_pass","checks_passed","checks","flags",
 "vk_equal","vkEqual","balance","min","threshold","cap","limit","expiry","current","block","sender","receiver","to","from","value","transfer_amount","transferAmount","payment_amount","paymentAmount",
 "vk_hash","vkHash","registered_vk_hash","proof_vk_hash","vk","registered","proof","hash","commitment","nullifier",
 "a","b","c","x","y","in","out","output","result","score","gate","pass","fail","ok",
 "condition_vk","conditionVk","expected_vk","expectedVk","actual_vk","actualVk","min_balance","minBalance","required_minimum","requiredMinimum","balance_amount",
 "expiry_ok","expiryOk","within_expiry","recipient_equal","amount_le","decision_code","decisionCode","approve_flag","is_approved","should_approve",
 "signal","inputs","public_signals","publicSignals","proof_reference","proofReference","seen","is_seen","fresh","is_fresh",
];
const found=[];
for (const s of stems){
  for (const full of [`main.${s}`, `main.main.${s}`, s]){
    const z = size(full);
    if (z>0) { found.push([full,z]); console.log("FOUND", full, "size", z); }
  }
}
console.log("done, found:", found);
