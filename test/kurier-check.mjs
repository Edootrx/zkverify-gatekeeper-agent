// Local check for the Kurier integration (Round 3 fix) with a mocked fetch.
// No real API key, no network: validates register-vk payload, optimisticVerify
// gating, IncludedInBlock/Finalized txHash extraction, and the timeout path.
import { registerVk, submitToKurier } from "../src/prover.js";

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const calls = [];
function mockFetch(responses) {
  let i = 0;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    const r = responses[Math.min(i++, responses.length - 1)];
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.json };
  };
}

const VK = { protocol: "groth16", curve: "bn128", nPublic: 13 };

// 1. register-vk posts the full vk object and returns the vkHash.
mockFetch([{ json: { vkHash: "0xdeadbeef" } }]);
const reg = await registerVk(VK, "key-123");
check("register-vk returns vkHash", reg.vkHash === "0xdeadbeef");
check(
  "register-vk payload carries full vk + groth16/snarkjs/bn128",
  calls[0].url.endsWith("/register-vk/key-123") &&
    calls[0].body.proofType === "groth16" &&
    JSON.stringify(calls[0].body.vk) === JSON.stringify(VK) &&
    calls[0].body.proofOptions.library === "snarkjs"
);

// 2. submit-proof -> IncludedInBlock with txHash returns the reference.
mockFetch([
  { json: { jobId: "job-1", optimisticVerify: "success" } },
  { json: { jobId: "job-1", status: "Submitted" } },
  { json: { jobId: "job-1", status: "IncludedInBlock", txHash: "0xtxabc" } },
]);
const ok = await submitToKurier({ pi_a: ["1"] }, ["2"], "0xvk", "key-123", 30000);
check("submit returns txHash at IncludedInBlock", ok.txHash === "0xtxabc", `got ${ok.txHash}`);
check("submit payload uses vkRegistered + vk hash", calls[1].body.vkRegistered === true && calls[1].body.proofData.vk === "0xvk");

// 3. optimisticVerify != success throws (bad proof artifacts never finalize).
mockFetch([{ json: { jobId: "job-2", optimisticVerify: "failed" } }]);
let threw = false;
try {
  await submitToKurier({ pi_a: ["1"] }, ["2"], "0xvk", "key-123", 30000);
} catch (e) {
  threw = /optimisticVerify/.test(e.message);
}
check("optimisticVerify failure throws", threw);

// 4. No txHash within budget -> txHash null (caller still returns the proof).
mockFetch([
  { json: { jobId: "job-3", optimisticVerify: "success" } },
  { json: { jobId: "job-3", status: "Submitted" } },
]);
const slow = await submitToKurier({ pi_a: ["1"] }, ["2"], "0xvk", "key-123", 100);
check("timeout without anchor returns txHash null", slow.txHash === null, `status=${slow.status}`);

console.log(failures === 0 ? "\nAll Kurier checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
