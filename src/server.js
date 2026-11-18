import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signBody, verifySignature } from "./hmac.js";
import { decide } from "./decision.js";
import { StateStore } from "./state.js";
import { buildCircuitInput, generateProof, registerVk, submitToKurier } from "./prover.js";
import {
  initPoseidon,
  stealPolicy,
  strategyCommitment,
  publicInputsHash,
  buildStealCircuitInput,
  uuidFromHex,
  fortifiedFlag,
  ACTION_NAMES,
  DEFAULT_PARAMS,
  DEFAULT_SALT,
} from "./steal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const PORT = process.env.PORT || 8080;
const SECRET = process.env.AGENT_GAMES_HMAC_SECRET || "";
const AGENT_PATH = process.env.AGENT_PATH || "/agent";
const WASM = process.env.GATEKEEPER_WASM || path.join(ROOT, "circuits", "gatekeeper.wasm");
const ZKEY = process.env.GATEKEEPER_ZKEY || path.join(ROOT, "circuits", "gatekeeper_final.zkey");
const STATE_FILE = process.env.STATE_FILE || path.join(ROOT, "data", "state.json");
const TASKID_ENCODING = process.env.TASKID_ENCODING || "bytes";
const VK_HASH =
  process.env.GATEKEEPER_VK_HASH ||
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const KURIER_API_KEY = process.env.KURIER_API_KEY || "";
const USE_KURIER = process.env.SUBMIT_TO_KURIER === "1" && KURIER_API_KEY;
// Testnet (Volta) Kurier — added 19 Nov 2026. Four rounds of mainnet-only
// Kurier submissions (Finalized, correct contract fields) scored VERIFIED
// PROOFS 0, while top agents verify 7/8 per round. The Build guide's
// zkVerifyJS path starts a "Volta session", i.e. the platform's on-chain
// confirmation most plausibly indexes the Volta testnet, not mainnet.
// Strategy: submit to BOTH networks in parallel; proof_tx carries the
// Volta tx hash (the bet), the mainnet statement still lands as a hedge.
const KURIER_TESTNET_API_KEY = process.env.KURIER_TESTNET_API_KEY || "";
const USE_KURIER_TESTNET = KURIER_TESTNET_API_KEY.length > 0;
const KURIER_TESTNET_API = "https://api-testnet.kurier.xyz/api/v1";
// Full verification key JSON (public by design — the platform publishes its
// hash). Needed once: Kurier requires register-vk before submit-proof.
const VK_JSON = process.env.GATEKEEPER_VKEY || path.join(ROOT, "circuits", "gatekeeper.vkey.json");
const STEAL_WASM = process.env.STEAL_WASM || path.join(ROOT, "circuits", "vfy-policy.wasm");
const STEAL_ZKEY = process.env.STEAL_ZKEY || path.join(ROOT, "circuits", "vfy-policy_final.zkey");
const STEAL_PARAMS = (process.env.STEAL_PARAMS || DEFAULT_PARAMS.join(","))
  .split(",")
  .map((s) => s.trim());
const STEAL_SALT = process.env.STEAL_SALT || DEFAULT_SALT;
let STEAL_COMMITMENT = null;
// Hard internal budget: answer well inside the platform's 60s deadline.
const PROOF_BUDGET_MS = Number(process.env.PROOF_BUDGET_MS || 40000);
// Total per-task response cap. The Kurier wait for Finalized (guide: a proof
// counts as confirmed on-chain only once finalized) typically takes ~30s
// end-to-end; cap the whole response at 50s so a slow chain can never turn
// a scored task into a timeout — at the cap we answer with the proof alone.
const RESPONSE_CAP_MS = Number(process.env.RESPONSE_CAP_MS || 50000);

if (!SECRET) {
  console.error(
    "WARNING: AGENT_GAMES_HMAC_SECRET is not set — signature checks will fail. " +
      "Set it from Dashboard → My Agents → Rotate Secret after registering."
  );
}
for (const f of [WASM, ZKEY]) {
  if (!fs.existsSync(f)) console.error(`WARNING: circuit artifact missing: ${f}`);
}

const state = new StateStore(STATE_FILE);

// Durable PROOF_REUSED memory across deploys: the container filesystem (and
// with it the state file) is replaced on every deploy, which blinded the
// seen-set to proofs first used in earlier rounds — Round 5 scored one such
// cross-round reuse as a wrong APPROVE (-6). SEEN_SEED (comma-separated
// proof_tx values, recovered from previous deployments' server logs) is
// merged into the seen-set at boot so a redeploy never resets reuse memory.
if (process.env.SEEN_SEED) {
  const seeds = process.env.SEEN_SEED.split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of seeds) state.markSeen(s);
  if (seeds.length) console.log(`Seen-set seeded with ${seeds.length} proof_tx values from SEEN_SEED`);
}

// One-time Kurier verification-key registration. Kurier requires register-vk
// before submit-proof (docs: "first confirm that register-vk successfully
// returned the vk hash"). Runs once per boot, before listening; a failure is
// logged and never blocks boot — tasks still answer with their (locally
// valid) proof, just without an on-chain reference.
async function registerGatekeeperVk() {
  if (!USE_KURIER && !USE_KURIER_TESTNET) return;
  try {
    const vk = JSON.parse(fs.readFileSync(VK_JSON, "utf8"));
    if (USE_KURIER) {
      const data = await registerVk(vk, KURIER_API_KEY);
      console.log(`Kurier vk registered: ${data.vkHash || data.hash || "ok"}`);
    }
    if (USE_KURIER_TESTNET) {
      const data = await registerVk(vk, KURIER_TESTNET_API_KEY, 15000, KURIER_TESTNET_API);
      console.log(`Kurier TESTNET vk registered: ${data.vkHash || data.hash || "ok"}`);
    }
  } catch (e) {
    console.error(`Kurier register-vk failed (proofs will lack on-chain refs): ${e.message}`);
  }
}

function sendSigned(res, obj) {
  const body = JSON.stringify(obj);
  const headers = { "content-type": "application/json" };
  if (SECRET) headers["x-agent-games-signature"] = signBody(body, SECRET);
  res.writeHead(200, headers);
  res.end(body);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("proof timeout")), ms)),
  ]);
}

async function handleTask(task, res) {
  const startedAt = Date.now();
  const taskId = task.task_id;
  // Idempotency: platform retries get the identical signed response.
  const cached = taskId && state.getResponse(taskId);
  if (cached) {
    const headers = { "content-type": "application/json" };
    if (SECRET) headers["x-agent-games-signature"] = signBody(cached, SECRET);
    res.writeHead(200, headers);
    res.end(cached);
    return;
  }

  const input = task.input || {};
  // Envelope timing visibility: the platform sets its own deadline_at per
  // task (practice tasks appear to allow far less than the documented 60s).
  // Logged once per task so scored-round latency can be audited afterwards.
  // proof_tx is logged as well: it is the PROOF_REUSED key, and the log is
  // the only durable record of it — containers (and their state files) are
  // replaced on every deploy, so past rounds' proof_tx values can be
  // backfilled into SEEN_SEED from these lines after any redeploy.
  console.log(
    `[task ${taskId}] envelope mode=${task.mode || "?"} issued_at=${task.issued_at || "?"} deadline_at=${task.deadline_at || "?"} proof_tx=${input.proof_tx || "?"}`
  );
  const verdict = decide(input, state.seen);
  const response = {
    decision: verdict.decision,
    reason_code: verdict.reason_code,
    proof_tx: input.proof_tx,
  };

  if (verdict.provable) {
    try {
      const circuitInput = buildCircuitInput(task, verdict, {
        secret: SECRET,
        taskIdEncoding: TASKID_ENCODING,
      });
      const { proof, publicSignals } = await withTimeout(
        generateProof(circuitInput, WASM, ZKEY),
        PROOF_BUDGET_MS
      );
      response.proof = proof;
      response.public_signals = publicSignals;
      if (USE_KURIER || USE_KURIER_TESTNET) {
        // Dual-network submission (19 Nov 2026): the same proof is anchored
        // on zkVerify mainnet AND on Volta testnet in parallel, and the
        // response's proof_tx carries the VOLTA tx hash when one exists.
        // Rationale: Rounds 3–6 with mainnet-only anchoring (echo proof_tx,
        // then IncludedInBlock, then Finalized, then Finalized + mainnet
        // tx hash) ALL scored VERIFIED PROOFS 0, while the top agents
        // verify 7 of 8 provable tasks per round. The Build guide's
        // zkVerifyJS instructions start a "Volta session" — the strongest
        // remaining explanation is that the platform's confirmation
        // counter indexes Volta. The mainnet submission continues as a
        // hedge: its statement exists on mainnet whichever hash is
        // returned. Both waits share the same budget (they run in
        // parallel), bounded by the response cap and the task deadline,
        // so this can never cause a platform timeout; with no tx hash at
        // all, proof_tx keeps the input echo as before.
        try {
          let budget = RESPONSE_CAP_MS - (Date.now() - startedAt);
          if (task.deadline_at) {
            const untilDeadline = Date.parse(task.deadline_at) - Date.now() - 5000;
            if (Number.isFinite(untilDeadline)) budget = Math.min(budget, untilDeadline);
          }
          if (budget > 3000) {
            const jobs = [];
            if (USE_KURIER)
              jobs.push(
                submitToKurier(proof, publicSignals, VK_HASH, KURIER_API_KEY, budget)
                  .then((r) => ({ net: "mainnet", ...r }))
                  .catch((e) => ({ net: "mainnet", error: e.message }))
              );
            if (USE_KURIER_TESTNET)
              jobs.push(
                submitToKurier(proof, publicSignals, VK_HASH, KURIER_TESTNET_API_KEY, budget, 18000, KURIER_TESTNET_API)
                  .then((r) => ({ net: "testnet", ...r }))
                  .catch((e) => ({ net: "testnet", error: e.message }))
              );
            const results = await Promise.all(jobs);
            const tn = results.find((r) => r.net === "testnet");
            const mn = results.find((r) => r.net === "mainnet");
            if (tn && tn.txHash) response.proof_tx = tn.txHash;
            else if (mn && mn.txHash) response.proof_tx = mn.txHash;
            for (const r of results) {
              if (r.error)
                console.error(`[task ${taskId}] Kurier ${r.net} submit failed (proof still returned): ${r.error}`);
              else if (r.finalized)
                console.log(`[task ${taskId}] Kurier ${r.net} Finalized: ${r.txHash}`);
              else
                console.error(`[task ${taskId}] Kurier ${r.net} not finalized in time (status ${r.status}; proof still returned)`);
            }
          } else {
            console.error(`[task ${taskId}] Kurier skipped: only ${budget}ms of response budget left`);
          }
        } catch (e) {
          console.error(`[task ${taskId}] Kurier submit failed (proof still returned): ${e.message}`);
        }
      }
    } catch (e) {
      // Fail safe: still return the (correct) decision without a proof.
      // Cost is -2 + no reliability bonus for this task — never a timeout.
      console.error(`[task ${taskId}] proof generation failed: ${e.message}`);
    }
  }

  // Record the proof reference as seen AFTER deciding (first use is legitimate,
  // any later task reusing it is PROOF_REUSED).
  state.markSeen(input.proof_tx);
  const body = JSON.stringify(response);
  if (taskId) state.setResponse(taskId, body);
  state.save();

  const headers = { "content-type": "application/json" };
  if (SECRET) headers["x-agent-games-signature"] = signBody(body, SECRET);
  res.writeHead(200, headers);
  res.end(body);
  console.log(
    `[task ${taskId}] ${response.decision}/${response.reason_code}` +
      (response.proof ? " +proof" : " (no proof)") +
      ` (${Date.now() - startedAt}ms)`
  );
}

async function handleStealTurn(task, res) {
  const matchId = task.matchId;
  const turn = task.turn;
  const key = `steal:${matchId}:${turn}`;
  const cached = state.getResponse(key);
  if (cached) {
    const headers = { "content-type": "application/json" };
    if (SECRET) headers["x-agent-games-signature"] = signBody(cached, SECRET);
    res.writeHead(200, headers);
    res.end(cached);
    return;
  }

  const st = task.state || {};
  const selfBalance = BigInt(st.selfBalance ?? "0");
  const opponentBalance = BigInt(st.opponentBalance ?? "0");
  const { action, amount } = stealPolicy(STEAL_PARAMS, selfBalance, opponentBalance);

  const actionObj = { type: ACTION_NAMES[action] };
  if (action === 2) actionObj.amount = Number(amount);
  // Response schema per the official starter prompt: proof and
  // public_signals are TOP-LEVEL; policyProof carries only circuitVersion,
  // proofReference and publicInputsHash; idempotencyKey must be a uuid.
  const response = {
    matchId,
    turn,
    action: actionObj,
    policyProof: { circuitVersion: "v1" },
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: uuidFromHex(signBody(key, SECRET || "no-secret")),
  };

  try {
    const circuitInput = buildStealCircuitInput({
      params: STEAL_PARAMS,
      salt: STEAL_SALT,
      commitment: STEAL_COMMITMENT,
      matchId,
      turn,
      selfBalance,
      opponentBalance,
      action,
      amount,
    });
    const { proof, publicSignals } = await withTimeout(
      generateProof(circuitInput, STEAL_WASM, STEAL_ZKEY),
      PROOF_BUDGET_MS
    );
    const inputsHash = publicInputsHash({
      matchId,
      turn,
      action,
      amount,
      selfBalance,
      opponentBalance,
      selfFortified: fortifiedFlag(st.selfFortifiedUntilTurn, turn),
      opponentFortified: fortifiedFlag(st.opponentFortifiedUntilTurn, turn),
      publicSignals,
    });
    response.proof = proof;
    response.public_signals = publicSignals;
    response.policyProof = {
      circuitVersion: "v1",
      proofReference: inputsHash,
      publicInputsHash: inputsHash,
    };
  } catch (e) {
    // Degrade gracefully: the platform treats a proof-less turn as HOLD.
    console.error(`[steal ${matchId} turn ${turn}] proof generation failed: ${e.message}`);
  }

  const body = JSON.stringify(response);
  state.setResponse(key, body);
  state.save();
  if (process.env.DEBUG_STEAL === "1") console.log("[steal-debug] response:", body.slice(0, 2000));
  const headers = { "content-type": "application/json" };
  if (SECRET) headers["x-agent-games-signature"] = signBody(body, SECRET);
  res.writeHead(200, headers);
  res.end(body);
  console.log(
    `[steal ${matchId} turn ${turn}] ${ACTION_NAMES[action]}${action === 2 ? " " + amount : ""}` +
      (response.proof ? " +proof" : " (no proof)")
  );
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        agent: "proof-gatekeeper",
        seen: state.seen.size,
        stealCommitment: STEAL_COMMITMENT,
        stealParams: STEAL_PARAMS.map(Number),
      })
    );
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith(AGENT_PATH)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    // 1. Verify HMAC over the RAW body BEFORE parsing (platform requirement).
    const sig = req.headers["x-agent-games-signature"];
    if (SECRET && !verifySignature(raw, sig, SECRET)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid signature" }));
      return;
    }
    let task;
    try {
      task = JSON.parse(raw.toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }

    try {
      if (task.type === "agent-games.preflight.v1") {
        sendSigned(res, { ok: true, protocolVersion: "v1" });
        return;
      }
      if (task.type === "agent-games.proof-gatekeeper.v1") {
        await handleTask(task, res);
        return;
      }
      if (task.eventId === "steal-the-vfy" || (task.matchId && task.state)) {
        if (process.env.DEBUG_STEAL === "1")
          console.log("[steal-debug] request:", raw.toString("utf8").slice(0, 2000));
        await handleStealTurn(task, res);
        return;
      }
      // Unknown envelope: fail closed but stay responsive.
      console.error("unknown task type:", task.type);
      sendSigned(res, { decision: "REJECT", reason_code: "VK_SUBSTITUTION" });
    } catch (e) {
      console.error("handler error:", e);
      if (!res.headersSent) {
        try {
          if (task && (task.eventId === "steal-the-vfy" || (task.matchId && task.state))) {
            // Steal fallback: a bare HOLD turn response (never a timeout).
            sendSigned(res, {
              matchId: task.matchId,
              turn: task.turn,
              action: { type: "HOLD" },
              policyProof: { circuitVersion: "v1" },
              agentTimestamp: new Date().toISOString(),
              idempotencyKey: uuidFromHex(signBody(`steal:${task.matchId}:${task.turn}`, SECRET || "no-secret")),
            });
          } else {
            sendSigned(res, { decision: "REJECT", reason_code: "VK_SUBSTITUTION" });
          }
        } catch {
          res.writeHead(500); res.end();
        }
      }
    }
  });
});

initPoseidon()
  .then(() => {
    STEAL_COMMITMENT = strategyCommitment(STEAL_PARAMS, STEAL_SALT);
    console.log(`Steal the VFY: params=[${STEAL_PARAMS.join(",")}] commitment=${STEAL_COMMITMENT}`);
  })
  .catch((e) => console.error("Steal poseidon init failed (Steal turns will lack proofs):", e.message))
  .then(() => registerGatekeeperVk())
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Proof Gatekeeper agent listening on :${PORT}${AGENT_PATH} (health: /health)`);
    });
  });
