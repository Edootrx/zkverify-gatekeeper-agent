import fs from "fs";
function fnvHash(str){ const M=(1n<<64n); let h=0xCBF29CE484222325n; for(let i=0;i<str.length;i++){ h^=BigInt(str.charCodeAt(i)); h=(h*0x100000001B3n)%M;} return h.toString(16).padStart(16,'0'); }
const buf = fs.readFileSync("../circuits/vfy-policy.wasm");
const {default: Builder} = await import("./node_modules/circom_runtime/js/witness_calculator.js");
const wc = await Builder(buf);
const exp = wc.instance.exports;
function size(name){ const h=fnvHash(name); try { return exp.getInputSignalSize(parseInt(h.slice(0,8),16), parseInt(h.slice(8,16),16)); } catch(e){ return -999; } }
const cand = new Set();
const words = ["strategy","policy","commitment","self","opponent","opp","enemy","balance","bal","action","amount","turn","match","salt","nonce","hash","threshold","extract","fortify","hold","attack","defend","defense","aggression","aggressive","risk","max","min","cost","block","steal","lead","trail","ahead","behind","win","score","round","state","public","private","secret","param","params","config","version","circuit","id","code","type","value","limit","cap","target","trigger","when","above","below","under","over","low","high","level","mode","choice","decision","move","spendable","exposed","fortified","until","deadline","index","count","total","start","initial","current","previous","prev","last","next","flag","enabled","active","VK","vk","Vk","key","proof","input","inputs","signal","witness","data"];
// singles + camel pairs + triples with common joiners
for (const w of words) cand.add(w);
const suffixes = ["","Hash","hash","Id","id","ID","Amount","amount","Balance","balance","Threshold","threshold","Code","code","Value","value","Turn","turn","Block","block","Cost","cost","Limit","limit","Until","untilTurn","Flag","flag","Count","count"];
const prefixes = ["","self","opponent","opp","strategy","policy","max","min","my","their"];
for (const p of prefixes) for (const w of words) for (const s of suffixes) {
  if (!p && !s) continue;
  const camel = (p ? p + w[0].toUpperCase()+w.slice(1) : w) + s;
  cand.add(camel);
}
// known guide vocabulary, exact guesses
["strategyCommitment","commitmentHash","policyHash","strategyHash","selfBalance","opponentBalance","oppBalance","selfFortifiedUntilTurn","opponentFortifiedUntilTurn","selfFortified","opponentFortified","fortifiedUntilTurn","actionCode","extractAmount","maxExtract","maxAmount","fortifyCost","blockAmount","publicInputsHash","inputsHash","matchId","matchIdHash","turnNumber","circuitVersion","versionCode","strategyParams","policyParams","params","strategy","policy","aggression","aggressiveness","riskLevel","riskAppetite","stealThreshold","extractThreshold","fortifyThreshold","holdThreshold","defendThreshold","attackThreshold","leadThreshold","trailThreshold","minBalance","balanceThreshold","extractAbove","fortifyBelow","salt","privateSalt","commitmentSalt","strategySalt","nonce","action","amount","turn","self","opponent","hash","commitment","threshold","extract","fortify","hold"].forEach(s=>cand.add(s));
// snake_case variants of everything so far
for (const s of [...cand]) cand.add(s.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase());
let found=[];
for (const name of cand){ const z=size(name); if(z>0){ found.push([name,z]); console.log("FOUND",name,z);} }
console.log("total tried", cand.size, "found", JSON.stringify(found));
