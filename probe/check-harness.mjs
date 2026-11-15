import fs from "fs";
function fnvHash(str){ const M=(1n<<64n); let h=0xCBF29CE484222325n; for(let i=0;i<str.length;i++){ h^=BigInt(str.charCodeAt(i)); h=(h*0x100000001B3n)%M;} return h.toString(16).padStart(16,'0'); }
const {default: Builder} = await import("./node_modules/circom_runtime/js/witness_calculator.js");
for (const f of ["gatekeeper.wasm","vfy-policy.wasm"]) {
  const wc = await Builder(fs.readFileSync("../circuits/"+f));
  const exp = wc.instance.exports;
  console.log(f, "inputSize:", exp.getInputSize());
  for (const name of ["registeredVkHash","salt","selfBalance","main.registeredVkHash","main.salt","main.selfBalance"]) {
    const h = fnvHash(name);
    let z; try { z = exp.getInputSignalSize(parseInt(h.slice(0,8),16), parseInt(h.slice(8,16),16)); } catch(e){ z = "ERR "+e.message; }
    console.log("  ", name, "->", z);
  }
}
