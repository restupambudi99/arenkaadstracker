# CSPoint di Arenka Ads Tracker

Diperbarui: 25 November 2026. Dokumen ini melengkapi `HANDOFF_AGENT_AI.md`.

## Ruang lingkup

Permintaan pemilik: tambahkan kode dan menu yang belum ada dari CSPoint ke aplikasi Arenka di `trackers.arenka.biz.id`, pertahankan pekerjaan sebelumnya. Ini bukan pengganti aplikasi atau migrasi akun CSPoint lama.

Menu lama, fungsi halaman lama, autentikasi Arenka, data tracking, dan Inbox WhatsApp Cloud API tetap memakai implementasi sebelumnya. `src/App.tsx` mendapat satu kelompok navigasi tambahan dan route lazy-loaded `/cspoint/*`. `worker/index.ts` hanya mendapat import serta dua mount router baru. CSS CSPoint dibatasi pada kelas `cs-*`; warna, font DM Sans, dan komponen Button/Input/Select mengikuti Arenka yang sedang berjalan. Modul tidak memakai iframe atau login admin kedua.

## Fitur dan penyimpanan

| Menu | Kemampuan | Penyimpanan / prasyarat |
| --- | --- | --- |
| Produk | Tambah, ubah, hapus, cari, paginasi; SKU, harga paket, stok, deskripsi | Cloudflare D1 |
| Pesanan | Nama, WA, total, catatan, Menunggu Bayar/Diproses/Selesai | D1; tidak mengubah revenue tracking |
| Kontak | Tambah, ubah, hapus, cari; normalisasi nomor Indonesia, label teks | D1; terpisah dari tabel leads |
| Template follow-up | Pesan FU1–FU5, edit, hapus, salin | D1; pengiriman manual, tanpa scheduler |
| Knowledge & ongkir | Teks/PDF, preview/edit hasil ekstraksi, klasifikasi referensi/tarif, cek tujuan | D1 menyimpan teks; PDF asli tidak diunggah |
| AI Agent | Instruksi/nama/status aktif per slot nomor, uji draf dengan katalog dan referensi workspace | D1 + endpoint 9Router kompatibel OpenAI |
| WhatsApp QR | Sampai 10 nomor, QR/reconnect/disconnect; Inbox, pencarian, label, unread/read, balasan manual, jeda AI | Gateway Node 24 dengan volume permanen |
| Pengaturan CSPoint | URL/model/key 9Router, URL/token gateway, daftar model, hapus kredensial | Secret terenkripsi di D1 |

Form Builder, billing, scheduler FU, dan impor massal yang masih placeholder di paket sumber tidak ditambahkan sebagai menu aktif. Fitur tersebut tidak dianggap selesai hanya karena tombolnya ada pada sumber.

## Peta kode

- `src/features/cspoint/index.tsx`: pemilih halaman baru.
- `Records.tsx`: tabel, form, dialog native, CRUD, pencarian/paginasi, pemeriksaan ongkir.
- `Agent.tsx`: konfigurasi penyedia/gateway dan instruksi per nomor; uji tidak mengirim WA.
- `WhatsApp.tsx`: pengelolaan QR dan Inbox gateway.
- `Pdf.ts`: ekstraksi PDF lewat pdfjs-dist yang dimuat hanya saat diperlukan.
- `cspoint.css`: gaya terisolasi, tabel dapat digeser, layout ponsel.
- `worker/cspoint/index.ts`: router API, secret masking, proxy gateway, draf AI, callback gateway.
- `worker/cspoint/validation.ts`: schema input, nomor telepon, slot, URL HTTPS publik.
- `shared/cspoint/`: algoritme ongkir, aturan balasan, perakitan prompt, pencarian knowledge dari CSPoint.
- `services/cspoint-gateway/`: runtime QR, API internal, antrean AI per percakapan, SQLite/sesi lokal.
- `migrations/0019_cspoint.sql`: hanya tabel baru, tidak mengubah migration 0001–0018.
- `tests/cspoint.test.mjs`: regresi API utama dengan SQLite in-memory sebagai adapter D1.
- `services/cspoint-gateway/test/`: pengujian kontrak gateway dengan socket palsu, bukan nomor sungguhan.

## Data D1

`cs_records`: id UUID, workspace_id, kind, name, data JSON, created_at, updated_at. Kind dibatasi ke products/orders/contacts/templates/knowledge. Query baca/tulis/hapus selalu menyertakan workspace_id. JSON divalidasi di API; payload tidak dapat memilih kolom/table SQL.

`cs_settings`: satu baris per workspace; router_url, model, api_key_cipher, gateway_url, gateway_token_cipher. Origin gateway yang terisi unik antarseluruh workspace. Mengganti URL tanpa mengisi kredensial baru menghapus kredensial lama agar secret tidak terkirim ke origin baru.

`cs_agents`: primary key (workspace_id, instance); assistant_name, instructions, enabled. Instance hanya default atau n2–n10. Menyimpan instruksi tidak mengaktifkan AI kecuali kotak aktif benar-benar dipilih dan koneksi AI tersedia.

Data produk, pesanan, kontak, dan template masing-masing dibatasi 1.000 baris/workspace; knowledge 20 dokumen. Paginasi 25 baris. Batas PDF 8 MiB/500 halaman/500.000 karakter. PDF scan tanpa teks ditolak dengan pesan; OCR belum tersedia. Isi dokumen dapat diperiksa sebelum disimpan.

## Kontrak API

Semua `/api/cspoint/*` memakai cookie `arenka_session` dan middleware origin serta workspace yang sudah ada. Tidak ada endpoint login baru. Respons galat JSON `{error}`; konfigurasi/proxy memakai `Cache-Control: no-store`.

| Method | Path relatif terhadap `/api/cspoint` | Isi / respons |
| --- | --- | --- |
| GET | `/records/:kind?q=&page=1` | `{items,total,page,pageSize}`; knowledge list tanpa isi panjang |
| GET | `/records/:kind/:id` | Item lengkap untuk editor |
| POST | `/records/:kind` | Validasi lalu insert; 201 |
| PUT | `/records/:kind/:id` | Ganti data item milik workspace; 404 untuk item lain |
| DELETE | `/records/:kind/:id` | Hapus item workspace; `{deleted:true}` |
| GET/PUT | `/settings` | Config publik; input key/token write-only; output hanya flag keberadaan |
| GET | `/agent?instance=default` | `{instance,assistantName,instructions,enabled}` |
| PUT | `/agent` | Bentuk data sama; aktif membutuhkan instruksi dan config penyedia |
| GET | `/ai/models` | `{models:[id...]}` dari konfigurasi tersimpan |
| POST | `/ai/test` | `{instance,prompt}` menghasilkan `{reply,guarded,model}` |
| POST | `/shipping/check` | `{destination}` menghasilkan status found/confirm/ambiguous/need_district/java/not_found/unavailable/none |
| GET/POST/DELETE | `/gateway/*` | Hanya route gateway yang diizinkan; bukan proxy URL bebas |

Field item:

```ts
products = { name, sku, price: string, stock: integer, description }
orders = { name, phone, status, total: integer, note }
contacts = { name, phone, tag }
templates = { name, stage: 'FU1'|'FU2'|'FU3'|'FU4'|'FU5', body }
knowledge = { name, category: 'knowledge'|'shipping', content, source, mime }
```

Callback `/cspoint-bridge/:workspace/reply` berada di luar middleware cookie tetapi memerlukan Bearer token gateway yang cocok dengan workspace tersebut. Input `{instance,thread}` maksimal 30 pesan. Callback memeriksa status agent sebelum dan sesudah membuat draf. Workspace tidak diambil dari pesan pelanggan. Endpoint ini mengembalikan draf, bukan mengirim WhatsApp sendiri.

## Batas kredensial dan runtime

API key 9Router dan token gateway dienkripsi AES-GCM menggunakan helper Arenka yang sudah ada, dengan kunci turunan `SESSION_SECRET`. Jangan mengganti secret produksi tanpa merencanakan migrasi data terenkripsi. Secret tidak dikirim kembali ke browser.

URL penyedia/gateway harus HTTPS, domain publik, tanpa user/password/query/fragment. IP literal/localhost/port nonstandar ditolak. Fetch menggunakan timeout dan `redirect: manual`; redirect tidak diikuti. Header cookie sesi tidak diteruskan ke gateway. Setiap request gateway memakai Bearer token dan `X-Arenka-Workspace`.

Worker tidak menjalankan sesi Baileys atau filesystem Node. Gateway perlu proses Node 24 di server/container persisten. Satu gateway khusus per workspace. Saat startup, gateway mengikat DATA_DIR ke workspace pertama dan menolak direktori milik workspace lain.

Cara menyiapkan gateway pada host milik pemilik proyek:

```sh
cd services/cspoint-gateway
npm ci
# Pasang env melalui secret manager/service manager:
# GATEWAY_TOKEN = secret acak minimal 32 karakter
# ARENKA_WORKSPACE_ID = nilai yang terlihat di Pengaturan CSPoint
# ARENKA_ORIGIN = https://trackers.arenka.biz.id
# DATA_DIR = direktori persisten yang hanya dapat dibaca service
# HOST = 127.0.0.1 (default; letakkan reverse proxy HTTPS di depannya)
# PORT = 18181 (default)
npm start
```

Selanjutnya isi URL HTTPS gateway dan token yang sama melalui Pengaturan CSPoint. Hubungkan nomor dari menu WhatsApp QR, lalu scan di ponsel. Gunakan instance/sesi baru; jangan menunjuk DATA_DIR ke layanan CSPoint produksi lama. Backup seluruh DATA_DIR saat menyiapkan operasi rutin. Jangan commit SQLite, sesi WA, env, token, atau key.

## Alur balasan otomatis

1. Baileys menerima pesan teks baru di nomor yang terhubung.
2. Pesan dan status receipt disimpan di SQLite gateway. Label/read state dipisah berdasarkan instance dan JID.
3. Antrean per (instance,JID) mengambil claim pesan di SQLite. Pesan duplikat tidak membuat pengiriman baru.
4. Gateway memanggil callback Worker; Worker membaca hanya instruksi, produk, dan knowledge workspace yang terikat token.
5. Parsing ongkir, pencarian referensi, prompt terbatas, dan pemeriksaan balasan memakai kode CSPoint.
6. Sebelum kirim, gateway memeriksa socket, jeda AI, dan pesan terakhir lagi. Balasan manual menjeda AI, termasuk saat draf masih berjalan.
7. ID outbound didaftarkan sebelum send agar echo AI tidak diperlakukan sebagai pernyataan CS manusia. Sumber `cs` dan `ai` disimpan berbeda.
8. Pengiriman gagal/hasilnya tidak pasti tidak diulang otomatis. Ini menghindari pengiriman ganda; tim CS perlu memeriksa dan membalas manual bila perlu.

Riwayat provider dibatasi 16 pesan terakhir (600 karakter/pesan), instruksi 16.000 karakter, dan potongan knowledge relevan sekitar 3.000 karakter. Jangan menjanjikan memori tak terbatas atau balasan yang selalu benar. Media, voice note, OCR, pengiriman ulang otomatis setelah restart, dan pembuatan pesanan otomatis belum ditambahkan.

## Validasi dan deployment

```sh
npm ci
npm run test:cspoint
npm run build
# Terapkan hanya migration yang belum ada pada database target:
npm run db:remote
npm run deploy
```

Pengujian Node membutuhkan Node 24 untuk `node:sqlite`. Test gateway tidak membutuhkan dependency Baileys karena memakai socket injeksi. PDF/QR/AI test tidak mengirim pesan ke pelanggan.

Pada workstation ini database `.wrangler/state` lama memiliki kolom yang sudah diterapkan tanpa catatan migration yang konsisten. Jangan menghapusnya. QA menggunakan `wrangler d1 migrations apply arenka-tracker --local --persist-to .wrangler/cspoint-test`, lalu `wrangler dev --assets dist/client --persist-to .wrangler/cspoint-test --port 8788`.

Lihat `CSPOINT_AUDIT_2026-11-25.md` untuk bukti yang benar-benar dijalankan dan batas yang belum diuji dengan akun/nomor produksi.

## Provenance sumber

Paket yang diberikan pemilik: `CSPoint-Rebuild-2026-11-25.zip`.
SHA-256: `813fb17b6fc49924129f2e1030b60fb8ca9b4df095c9e591c31f875f69bf6509`.
Paket mencatat repo asal `restupambudi99/cspoint`, head `a503575e231c0c779458f829f67cf63b932fe300`, dengan patch lokal pada enam file gateway. Itu adalah provenance arsip, bukan bukti deployment lama.

Yang dipakai kembali: shipping.mjs, reply-rules.mjs, compose-reply.mjs, ranking knowledge, perakitan prompt AI, messages.mjs, wa-numbers.mjs, phone.mjs, read-receipts.mjs dan pengujian ongkir. `prompt.mjs` mengambil fungsi murni dari ai.mjs; batas instruksi tetap 16.000. `knowledge.mjs` mengambil rankKnowledge tanpa extractor PDF Node. `messages.mjs` menambahkan argumen source pada registerOutbound untuk membedakan balasan manual dan AI sebelum echo tiba. HTTP server/autentikasi/config/store lama tidak diaktifkan; implementasi baru menyambungkannya ke workspace Arenka.

Tidak ada akses ke VPS, database, session WhatsApp, atau kredensial CSPoint lama selama integrasi ini.
