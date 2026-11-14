import fs from "fs";
function fnvHash(str){ const M=(1n<<64n); let h=0xCBF29CE484222325n; for(let i=0;i<str.length;i++){ h^=BigInt(str.charCodeAt(i)); h=(h*0x100000001B3n)%M;} return h.toString(16).padStart(16,'0'); }
const buf = fs.readFileSync("../circuits/gatekeeper.wasm");
const {default: Builder} = await import("./node_modules/circom_runtime/js/witness_calculator.js");
const wc = await Builder(buf);
const exp = wc.instance.exports;
function size(name){ const h=fnvHash(name); try { return exp.getInputSignalSize(parseInt(h.slice(0,8),16), parseInt(h.slice(8,16),16)); } catch(e){ return -999; } }
const cand = new Set();
const A=["registered","proof","condition","expected","actual","task","payment","transfer","agent","public","current","max","min"];
const B=["Vk","VK","vk","VkHash","vkHash","Hash","hash","Tx","tx","Ref","ref","Reference","reference","Id","ID","id","Block","block","Balance","balance","Amount","amount","Recipient","recipient","Code","code"];
for(const a of A) for(const b of B) cand.add(a+b);
for(const a of A) for(const b of B) for(const c of ["Hash","hash","Id","id",""]) cand.add(a+b+c);
const singles=["vk","VK","Vk","proofHash","txHash","proofRef","proofReference","proofId","reference","ref","nonce","mode","agent","agentId","owner","issuer","deadline","issuedAt","expiresAt","expiry","expires","validUntil","blockNumber","blockHeight","currentHeight","chainHeight","minThreshold","thresholdValue","requiredBalance","requiredAmount","spendable","spendableBalance","availableBalance","balancePublic","pubBalance","pubBal","decisionCode","approve","approved","isApproved","verdict","outcome","action","choice","accept","accepted","isValid","validProof","proofOk","reuse","reusedFlag","seenBefore","isReused","freshProof","unique","salt","secret","key","verificationKey","verification_key","vkRegistered","registeredVK","proofVK","conditionVK","expectedVK","actualVK","regVk","condVk","vkReg","vkProof","vkCond","vkExpected","vkActual","registeredKey","proofKey","conditionKey","keyHash","vkey","vKey","verificationKeyHash","vkH","rVk","pVk","vkR","vkP","limb","limbs","hi","lo","high","low","part","chunk","taskHash","task_id_hash","id","ID","tid","taskID","taskid","requestId","requestID","paymentId","transferId","gatekeeper","evaluation","result","score","pass","passed","allOk","all_ok","checksOk","flagsOk","n","count","index","turn","round"];
singles.forEach(s=>cand.add(s));
// snake variants of camel candidates
for(const s of [...cand]){ cand.add(s.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase()); }
let found=[];
for(const name of cand){ const z=size(name); if(z>0){ found.push([name,z]); console.log("FOUND",name,z);} }
console.log("total tried", cand.size, "found", found);
