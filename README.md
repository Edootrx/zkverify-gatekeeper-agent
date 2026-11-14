# zkVerify Agent Games — Proof Gatekeeper Agent

Bot untuk track **Proof Gatekeeper** (zkVerify Agent Games, prize pool 400.000 $VFY,
100.000 $VFY per track: 50k / 30k / 20k untuk peringkat 1–3).

## Kenapa bot ini kuat

1. **Logika keputusan deterministik, tanpa LLM.** Semua 7 tipe task dideteksi dari
   field-nya langsung (aturan resmi memang mempublikasikan semua jebakan):
   `VALID_CONDITION` (~50%), `VK_SUBSTITUTION` (~13%), `PROOF_REUSED` (~11%),
   `THRESHOLD_MISMATCH` (~8%), `EXPIRED_CONDITION` (~6%), `RECIPIENT_MISMATCH` (~6%),
   `AMOUNT_OVERFLOW` (~6%).
2. **Semantik circuit dibuktikan lokal, bukan ditebak.** Nama & jumlah input circuit
   `GatekeeperEvaluation` di-reverse-engineer dari `gatekeeper.wasm` (13 input),
   lalu setiap aturan diuji dengan `snarkjs fullProve`:
   - Circuit **mengunci** `decision == semua cek lolos` — keputusan yang salah
     secara matematis tidak bisa dibuktikan.
   - **Expiry bersifat ketat:** `current_block == expiry_block` sudah EXPIRED
     (circuit pakai `GreaterThan`). Bot yang pakai `>` akan salah APPROVE di batas ini.
   - Balance `== minimum` dan amount `== max_transfer` tetap lolos (inklusif).
   - Perbandingan pakai `BigInt` dan hex dinormalisasi case-insensitive.
3. **Proof Groth16 asli di setiap task yang provable** → memenuhi syarat
   reliability bonus (+0 s/d +5/ronde). Tanpa proof = −2 per task.
   `PROOF_REUSED` dikecualikan dari proof (sesuai aturan) dan dideteksi dari
   seen-set persisten di disk.
4. **Cepat & tidak pernah timeout:** proof terukur ±1,1 detik/task (batas 60 detik),
   idempotent per `task_id` (retry platform menerima respons identik),
   HMAC-SHA256 diverifikasi atas raw body sebelum parsing, semua respons ditandatangani,
   preflight `{ok:true, protocolVersion:"v1"}` terimplementasi.
5. **Fail closed:** error/ketidakpastian apa pun → REJECT (salah REJECT hanya −3,
   salah APPROVE −6).

## Hasil tes lokal (2026-11-15)

- `npm test` — simulasi keputusan: **12/12 PASS** (semua jebakan + kasus batas).
- `npm run test:proof` — **12/12 PASS**: keputusan bot selalu bisa dibuktikan &
  terverifikasi; keputusan lawannya selalu gagal dibuktikan.
- E2E server: preflight bertanda tangan ✓, task valid +proof dalam 1,1 dtk ✓,
  retry idempotent ✓, reuse terdeteksi ✓, signature salah → 401 ✓.

## Arsitektur

```
platform ──POST /agent (HMAC)──> src/server.js
                                   ├─ src/hmac.js      verifikasi + tanda tangan
                                   ├─ src/decision.js  7 cek deterministik (BigInt)
                                   ├─ src/state.js     seen-set + cache respons (disk, atomik)
                                   └─ src/prover.js    snarkjs fullProve (gatekeeper.wasm/.zkey)
                                                       + opsi submit Kurier (zkVerify)
```

Circuit: Groth16/BN128, `vk_hash 0x6b79c601…bad77b0` (terdaftar di zkVerify mainnet,
sumber: `https://agentgames.zkverify.io/api/circuit-info`).
Input circuit (13): `registeredVkHash, proofVkHash, minimum, publicBalance,
expiryBlock, currentBlock, recipient, conditionRecipient, amount, maxTransfer,
decision, taskId, salt` — `salt` privat, diturunkan deterministik dari task_id.

## Cara pasang (target: live sebelum Ronde 3, 15 Nov 18:30 WITA)

### 1. Daftar akun
1. Buka https://agentgames.zkverify.io/register → **Continue with X**.
2. Isi handle, negara, bio. Wallet diisi nanti untuk klaim hadiah.

### 2. Soal GitHub — bukan di Settings akun
Tombol/field GitHub **memang tidak ada di `/dashboard/settings`** (itu cuma profil).
Menurut panduan dashboard resmi: *"Add your agent's endpoint and repository,
**link GitHub**, and commit a strategy"* — GitHub dihubungkan **saat mendaftarkan
agent**: Dashboard → **My Agents → Register agent** (endpoint + repository + link GitHub).
Syarat kelayakan hadiah (Rules 1.1): GitHub terhubung + wallet terhubung.

### 3. Deploy bot (butuh HTTPS publik, TANPA port custom, tidak boleh tidur)
Rekomendasi: **Railway** (Dockerfile + railway.json sudah siap, healthcheck /health):
```bash
# push folder ini ke repo GitHub, lalu Railway → New Project → Deploy from GitHub
# set env: AGENT_GAMES_HMAC_SECRET (diisi setelah langkah 4), TASKID_ENCODING=bytes
```
Alternatif: Render / Fly.io / VPS + Caddy. **Hindari free tier yang sleep**
(Render free spin-down, dsb.) — task yang datang saat agent tidur = hangus.
Arena jalan tiap hari **18:30–04:30 WITA**, jadi host harus bangun di jam itu.

### 4. Daftarkan agent
Dashboard → My Agents → Register agent:
- Endpoint: `https://<host-kamu>/agent` (path lengkap, bukan root saja)
- Repository: repo GitHub bot ini, lalu **link GitHub** di alur yang sama
- Event: Proof Gatekeeper
Setelah itu **Rotate Secret** → salin secret (muncul sekali) → set sebagai
`AGENT_GAMES_HMAC_SECRET` di host → restart → jalankan **Preflight** dari dashboard
sampai agent berstatus active.

### 5. Kalibrasi lewat Practice Mode (penting)
Practice (maks 10 kiriman/jam) identik dengan task asli. Cek di riwayat task:
- Keputusan benar + proof "verified" → siap tempur.
- Kalau proof ditolak karena public signals tidak cocok, kemungkinan besar
  encoding `taskId` berbeda: ganti env `TASKID_ENCODING` ke `sha256` atau `numeric`,
  restart, ulangi practice. Satu-satunya variabel yang belum bisa diverifikasi
  dari luar adalah pemetaan string `task_id` → field element; sisanya
  (VK, alamat, angka) pemetaan langsung `BigInt`.

## Jadwal sisa (WITA)

Ronde 1–2 (13–14 Nov) sudah lewat. Tersisa **6 ronde × 8 task**:
Ronde 3–8, **15–20 Nov, tiap hari 18:30–04:30 WITA**. Skor kumulatif;
maksimum per ronde 8×12 + 5 bonus = **101**.

## Bonus: dua track lain dari aset yang sama
- **Wildcard:** agent ini juga layak disubmit sebagai Wildcard (payment guard
  berbasis ZK proof) — sertakan repo + endpoint publik + penjelasan use case.
- **Creator Track:** draf thread siap posting ada di `CREATOR-THREAD.md`.

## Skor (referensi)
Betul +12 · salah APPROVE −6 · salah REJECT −3 · timeout −2 · proof hilang/invalid −2 ·
reliability bonus +0…+5 per ronde (proporsional proof terverifikasi).
