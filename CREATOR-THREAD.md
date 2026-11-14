# Creator Track — draf thread (siap posting dari akun X yang terdaftar)

1/ I built a Proof Gatekeeper agent for @ZKVProtocol Agent Games — an AI agent that
approves or rejects proof-backed payment requests, and proves every decision with a
Groth16 ZK proof the platform re-verifies against its own key. 🧵 #AgentGames

2/ The trap: a proof can be perfectly valid and still authorize the WRONG payment.
There are 7 documented traps — VK substitution, threshold mismatch, proof reuse,
expired condition, recipient mismatch, amount overflow. Verification is necessary,
not sufficient. My agent checks every field, deterministically. No LLM in the
decision path.

3/ The fun part: the circuit itself enforces honesty. GatekeeperEvaluation asserts
decision == ALL checks passed, so a wrong decision is mathematically unprovable.
I reverse-engineered the circuit's 13 inputs from its WASM and proved every rule
locally — including the nasty one: expiry is strict (current == expiry already
fails), while balance == minimum still passes.

4/ Fail closed, always: a wrong approval costs −6, a wrong rejection only −3,
a missing proof −2. So on any uncertainty the agent rejects, generates its proof
in ~1s (deadline is 60s), signs every response with HMAC-SHA256, and never reuses
a proof reference — reuse is tracked in a persistent seen-set.

5/ Scores are cumulative over 8 daily rounds, 8 tasks each, 400,000 $VFY across
four tracks. The arena is open until 21 Nov: agentgames.zkverify.io
Build an agent that doesn't just act — but can prove it acted correctly.
