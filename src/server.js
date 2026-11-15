import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signBody, verifySignature } from "./hmac.js";
import { decide } from "./decision.js";
import { StateStore } from "./state.js";
import { buildCircuitInput, generateProof, submitToKurier } from "./prover.js";
import {
  initPoseidon,
  stealPolicy,
  strategyCommitment,
  publicInputsHash,
  buildStealCircuitInput,
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
const STEAL_WASM = process.env.STEAL_WASM || path.join(ROOT, "circuits", "vfy-policy.wasm");
const STEAL_ZKEY = process.env.STEAL_ZKEY || path.join(ROOT, "circuits", "vfy-policy_final.zkey");
const STEAL_PARAMS = (process.env.STEAL_PARAMS || DEFAULT_PARAMS.join(","))
  .split(",")
  .map((s) => s.trim());
const STEAL_SALT = process.env.STEAL_SALT || DEFAULT_SALT;
let STEAL_COMMITMENT = null;
// Hard internal budget: answer well inside the platform's 60s deadline.
const PROOF_BUDGET_MS = Number(process.env.PROOF_BUDGET_MS || 40000);

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
      if (USE_KURIER) {
        try {
          const job = await submitToKurier(proof, publicSignals, VK_HASH, KURIER_API_KEY, 15000);
          if (job && (job.txHash || job.transactionHash))
            response.proof_reference = job.txHash || job.transactionHash;
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
      (response.proof ? " +proof" : " (no proof)")
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
  const response = {
    matchId,
    turn,
    action: actionObj,
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: signBody(key, SECRET || "no-secret"),
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
    response.policyProof = {
      circuitVersion: "v1",
      proof,
      public_signals: publicSignals,
      publicInputsHash: publicInputsHash({
        commitment: STEAL_COMMITMENT,
        matchId,
        turn,
        selfBalance,
        opponentBalance,
        action,
        amount,
      }),
    };
  } catch (e) {
    // Degrade gracefully: the platform treats a proof-less turn as HOLD.
    console.error(`[steal ${matchId} turn ${turn}] proof generation failed: ${e.message}`);
    response.policyProof = { circuitVersion: "v1" };
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
      (response.policyProof.proof ? " +proof" : " (no proof)")
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
              idempotencyKey: signBody(`steal:${task.matchId}:${task.turn}`, SECRET || "no-secret"),
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
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Proof Gatekeeper agent listening on :${PORT}${AGENT_PATH} (health: /health)`);
    });
  });
