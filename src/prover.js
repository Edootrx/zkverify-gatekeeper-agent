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

// Optional: submit the proof to zkVerify via Kurier and wait briefly for a
// finalized reference. OFF by default — the platform re-verifies the proof
// from our response itself; proof_tx in the response is only an audit pointer.
export async function submitToKurier(proof, publicSignals, vkHash, apiKey, timeoutMs = 20000) {
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
  const jobId = job.jobId || job.id;
  if (!jobId) return job;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await fetch(`${API}/job-status/${apiKey}/${jobId}`);
    if (!s.ok) continue;
    const st = await s.json();
    if (st.status === "Finalized" || st.status === "finalized") return st;
    if (/fail|error|invalid/i.test(String(st.status))) throw new Error(`Kurier job ${st.status}`);
  }
  return job; // not finalized in time — caller still returns the proof itself
}
