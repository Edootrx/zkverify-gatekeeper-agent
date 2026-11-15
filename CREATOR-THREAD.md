# Creator Track — thread TERPOSTING 15 Nov 2026 11:26 WITA dari @crionicyz
# URL: https://x.com/crionicyz/status/2121807035910291476
# Catatan: post 2–4 dipersingkat dari draf awal agar muat batas 280 karakter akun non-Premium.

1/ I built a Proof Gatekeeper agent for @ZKVProtocol Agent Games — an AI agent that approves or rejects proof-backed payment requests, and proves every decision with a Groth16 ZK proof the platform re-verifies against its own key. 🧵 #AgentGames

2/ The trap: a proof can be perfectly valid and still authorize the WRONG payment. There are 7 documented traps — VK substitution, threshold mismatch, proof reuse, expiry, recipient mismatch, amount overflow. My agent checks every field. No LLM in the decision path.

3/ The circuit enforces honesty: it asserts decision == ALL checks passed, so a wrong decision is mathematically unprovable. I reverse-engineered its 13 inputs from the WASM — incl. the nasty rule: expiry is strict (current == expiry fails), balance == minimum passes.

4/ Fail closed, always: wrong approval −6, wrong rejection −3, missing proof −2. On any uncertainty the agent rejects, proves in ~1s (deadline 60s), signs responses with HMAC-SHA256, and never reuses a proof reference — reuse is tracked in a persistent seen-set.

5/ Scores are cumulative over 8 daily rounds, 8 tasks each, 400,000 $VFY across four tracks. The arena is open until 21 Nov: agentgames.zkverify.io — Build an agent that doesn't just act — but can prove it acted correctly.
