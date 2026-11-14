import * as snarkjs from "snarkjs";
import fs from "fs";
const wasm = "../circuits/gatekeeper.wasm";
// Use low-level witness calculator from snarkjs internals via groth16 fullProve error path:
// snarkjs exports wtns calculate through 'snarkjs.wtns.calculate'
let input = {};
for (let iter=0; iter<30; iter++) {
  try {
    const wtns = {type:"mem"};
    await snarkjs.wtns.calculate(input, wasm, wtns);
    console.log("SUCCESS with input:", JSON.stringify(input));
    const json = await snarkjs.wtns.exportJson(wtns);
    console.log("WITNESS len", json.length, "first 40:", json.slice(0,40));
    fs.writeFileSync("witness.json", JSON.stringify(json));
    break;
  } catch(e) {
    const msg = String(e.message||e);
    console.log("ERR:", msg.slice(0,300));
    const m = msg.match(/Signal not assigned:\s*main\.([A-Za-z0-9_]+)/) || msg.match(/([A-Za-z0-9_.]+) is not assigned/) || msg.match(/Missing signal:?\s*([A-Za-z0-9_.]+)/);
    if (!m) { console.log("FULL:", String(e).slice(0,1000)); break; }
    const name = m[1].replace(/^main\./,"");
    console.log("-> adding", name, "= 0");
    input[name]="0";
  }
}
console.log("FINAL INPUT KEYS:", Object.keys(input));
