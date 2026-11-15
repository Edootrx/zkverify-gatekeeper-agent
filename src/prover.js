import crypto from "node:crypto";
import * as snarkjs from "snarkjs";

// Gatekeeper circuit — reverse-engineered & verified locally 2026-11-15.
// 13 inputs, all size 1 (fnv-hash probed against gatekeeper.wasm):
//   registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
//   currentBlock, recipient, conditionRecipient, amount, maxTransfer,
//   decision (1=APPROVE / 0=REJECT), taskId, salt (private)
// Public signals order returned by snarkjs:
//   [commitment, registeredVkHash, proofVkHash, minimum, publicBalance,
//    expiryBlock, currentBlock, recipient, conditionRecipient, amount,
//    maxTransfer, decision, taskId]
// commitment = circuit output binding (taskId, salt) — computed by the circuit.
// The circuit ASSERTS decision == AND(all checks), so a proof can only be
// generated for the honest decision. That is why decision.js must be right.

const BN254_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function fieldFromValue(v) {
  // Accepts "0x..." hex or decimal string / number. Returns decimal string.
  if (v === undefined || v === null || v === "") throw new Error("missing field value");
  return BigInt(v).toString();
}

export function encodeTaskId(taskId, strategy = "bytes") {
  const s = String(taskId);
  if (/^\d+$/.test(s)) return s;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s).toString();
  switch (strategy) {
    case "numeric": {
      const suffix = s.split("_").pop();
      if (/^[0-9a-fA-F]+$/.test(suffix) && /[a-fA-F]/.test(suffix))
        return BigInt("0x" + suffix).toString();
      const digits = s.replace(/\D/g, "");
      return digits ? BigInt(digits).toString() : "0";
    }
    case "sha256": {
      const h = crypto.createHash("sha256").update(s).digest("hex");
      return (BigInt("0x" + h) % BN254_PRIME).toString();
    }
    case "bytes":
    default: {
      const hex = Buffer.from(s, "utf8").toString("hex");
      return (BigInt("0x" + hex) % BN254_PRIME).toString();
    }
  }
}

export function deriveSalt(taskId, secret) {
  const h = crypto
    .createHmac("sha256", secret || "gatekeeper")
    .update("gatekeeper-salt:" + String(taskId))
    .digest("hex");
  return (BigInt("0x" + h) % BN254_PRIME).toString();
}

export function buildCircuitInput(task, verdict, { secret, taskIdEncoding }) {
  const input = task.input;
  return {
    registeredVkHash: fieldFromValue(input.registered_vk),
    proofVkHash: fieldFromValue(input.proof_vk),
    minimum: fieldFromValue(input.minimum),
    publicBalance: fieldFromValue(input.public_balance),
    expiryBlock: fieldFromValue(input.expiry_block),
    currentBlock: fieldFromValue(input.current_block),
    recipient: fieldFromValue(input.recipient),
    conditionRecipient: fieldFromValue(input.condition_recipient),
    amount: fieldFromValue(input.amount),
    maxTransfer: fieldFromValue(input.max_transfer),
    decision: verdict.decision === "APPROVE" ? "1" : "0",
    taskId: encodeTaskId(task.task_id, taskIdEncoding),
    salt: deriveSalt(task.task_id, secret),
  };
}

export async function generateProof(circuitInput, wasmPath, zkeyPath) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );
  return { proof, publicSignals };
}

// Kurier (zkVerify REST API) — REQUIRED for scored rounds, not optional.
// The platform's "VERIFIED PROOFS" counter counts proofs confirmed ON-CHAIN,
// and a provable task without an on-chain-confirmed proof scores -2 even when
// the decision is correct (Round 3: 8x correct decisions, 0 verified, 80.0
// points = 8 x (+12 - 2)). The proof itself is still returned to the platform
// in every case; Kurier only adds the on-chain proof_reference.
//
// Flow per docs.zkverify.io/overview/getting-started/kurier:
//   1. register-vk ONCE per verification key (full vk JSON, not just the hash)
//   2. submit-proof -> { jobId, optimisticVerify: 'success' }
//   3. poll job-status until Finalized (example: ~16s) — txHash is present on
//      the Finalized status object (and per the tutorial, tx data is returned
//      once the job reaches IncludedInBlock).
// Enable with env SUBMIT_TO_KURIER=1 + KURIER_API_KEY (free key from kurier.xyz).
export async function registerVk(vk, apiKey, timeoutMs = 15000) {
  const API = "https://api.kurier.xyz/api/v1";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/register-vk/${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proofType: "groth16",
        proofOptions: { library: "snarkjs", curve: "bn128" },
        vk,
      }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || JSON.stringify(data).slice(0, 200);
      throw new Error(`Kurier register-vk HTTP ${res.status}: ${msg}`);
    }
    return data; // contains vkHash (or the already-registered vkHash)
  } finally {
    clearTimeout(t);
  }
}

export async function submitToKurier(proof, publicSignals, vkHash, apiKey, timeoutMs = 30000) {
  const API = "https://api.kurier.xyz/api/v1";
  const res = await fetch(`${API}/submit-proof/${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      proofType: "groth16",
      vkRegistered: true,
      proofOptions: { library: "snarkjs", curve: "bn128" },
      proofData: { proof, publicSignals, vk: vkHash },
    }),
  });
  if (!res.ok) throw new Error(`Kurier submit HTTP ${res.status}`);
  const job = await res.json();
  // Optimistic verification runs before the job is queued: anything other than
  // 'success' means the proof artifacts are wrong and the job will never finalize.
  if (job.optimisticVerify && job.optimisticVerify !== "success") {
    throw new Error(`Kurier optimisticVerify=${job.optimisticVerify}`);
  }
  const jobId = job.jobId || job.id;
  if (!jobId) return { txHash: null, status: "no-job-id", job };
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "Submitted";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await fetch(`${API}/job-status/${apiKey}/${jobId}`);
    if (!s.ok) continue;
    const st = await s.json();
    lastStatus = st.status || lastStatus;
    // txHash appears once the verification is included in a block; Finalized
    // is the strongest state. Either is an on-chain reference the platform
    // can confirm, so return as soon as we have one.
    if ((st.status === "Finalized" || st.status === "finalized" ||
         st.status === "IncludedInBlock") && (st.txHash || st.transactionHash)) {
      return { txHash: st.txHash || st.transactionHash, status: st.status, job: st };
    }
    if (/fail|error|invalid/i.test(String(st.status))) throw new Error(`Kurier job ${st.status}`);
  }
  // Not anchored in time — caller still returns the proof itself; the task
  // will score +12 - 2 instead of +12, but never times out.
  return { txHash: null, status: lastStatus, job };
}
