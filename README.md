# Arenka Ads Tracker

Dashboard atribusi iklan dan lead berbasis Cloudflare Workers + D1. Repo dimulai dari kosong dan aplikasi ini membangun alur tracking yang setara secara fungsi dengan workflow yang diamati pada aplikasi referensi, dengan identitas dan implementasi Arenka sendiri.

## Modul

- Ringkasan performa: lead, biaya, revenue, ROAS, sumber, dan tahap lead.
- Leads: pencarian, impor/ekspor CSV, status, tampilan Kanban, dan jadwal follow-up.
- Lokasi leads: ringkasan event dan konversi berdasarkan wilayah.
- Inbox WhatsApp: percakapan Cloud API, kirim pesan, dan balasan cepat yang dapat ditinjau sebelum dikirim.
- WhatsApp Rotator: link pendek dengan distribusi round-robin ke nomor WhatsApp dan hitungan klik tanpa penyimpanan IP.
- Integrasi iklan: metadata akun, event mapping, UTM, dan script tracker. OAuth dan sinkronisasi data iklan belum aktif.
- Campaign report: biaya manual, lead, closing, revenue, ROAS, rentang tanggal, dan ekspor CSV.
- Tracking: event logs, sumber lead, custom audience, riset iklan, dan allowlist hostname.
- Sumber lead Mayar: baca transaksi yang dibayar, cocokkan ke lead, dan sinkronkan secara manual.
- API & Webhook: endpoint webhook masuk untuk membuat lead serta endpoint keluar bertanda tangan untuk event workspace.

## Menjalankan lokal

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
# Ganti SESSION_SECRET dengan string acak yang kuat sebelum memakai akun lokal.
npm run db:local
npm run dev
```

## Deploy ke Cloudflare

1. Pastikan Wrangler terhubung ke akun Cloudflare yang benar: `npx wrangler login`, lalu `npx wrangler whoami`.
2. Database D1 `arenka-tracker` sudah dibuat; ID-nya tercatat di `wrangler.jsonc`.
3. Terapkan migration: `npm run db:remote`.
4. Buat secret: `npx wrangler secret put SESSION_SECRET` dan masukkan nilai acak kuat saat diminta.
5. Deploy: `npm run deploy`.
6. Tambahkan custom domain `trackers.arenka.biz.id` ke Worker melalui Cloudflare Workers & Pages atau konfigurasi route yang sesuai.

### Email reset kata sandi

Reset kata sandi memakai Resend. Verifikasi domain pengirim di Resend, buat API key khusus untuk email, lalu pasang rahasia Worker tanpa memasukkannya ke repository:

```powershell
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESET_EMAIL_FROM
```

Nilai `RESET_EMAIL_FROM` harus berupa alamat pada domain yang sudah diverifikasi, misalnya `Arenka Ads <no-reply@arenka.biz.id>`. Gunakan alamat sebenarnya yang diizinkan oleh domain Resend Anda. Migration `0003_password_reset.sql` membuat penyimpanan token dan pembatasan permintaan. Tautan reset berlaku 30 menit, sekali pakai; reset membatalkan sesi lama.

## Memasang tracker

Worker aplikasi saat ini aktif pada `trackers.arenka.biz.id`, dan script tracker tersedia pada origin tersebut:

```html
<script async src="https://trackers.arenka.biz.id/tracker.js?k=WORKSPACE_KEY"></script>
```

Kode ini menyimpan UTM sesi, merekam `Visit LP`, serta klik tautan WhatsApp dan elemen `data-track`. Untuk custom event:

```js
window.arenkaTrack("Masuk WA", { name: "Nama lead", phone: "+62..." });
```

### Custom domain pelanggan

Menu Custom Domain saat ini menyimpan hostname pada allowlist workspace untuk validasi origin event. Pendaftaran tersebut **belum** membuat DNS, sertifikat SSL, atau routing Worker untuk hostname pelanggan. Record CNAME ke `trackers.arenka.biz.id` saja tidak mengarahkan request ke Worker untuk domain di luar zona Cloudflare Arenka.

Penerimaan domain eksternal secara otomatis memerlukan Cloudflare for SaaS pada zona provider, konfigurasi fallback origin/hostname routing, verifikasi kepemilikan, serta sinkronisasi status dan penghapusan custom hostname melalui API Cloudflare. Jangan menambahkan Worker route wildcard `*/*` pada zona `arenka.biz.id`: wildcard dapat mengambil trafik subdomain lain. Sampai provisioning itu dibuat, anggap domain pelanggan sebagai *allowlist saja* dan jangan menjanjikan custom URL atau SSL aktif.

## Kondisi provider iklan

OAuth dan sinkronisasi biaya live belum tersedia. Halaman Integrasi menyebut status secara eksplisit dan hanya menyimpan nama/ID akun. Untuk mengaktifkan data live, setiap provider masih memerlukan aplikasi developer, redirect URI, secret terenkripsi, token refresh, dan implementasi API serta webhook sesuai provider.

## Data pengunjung

Pemilik situs bertanggung jawab memberi pemberitahuan kepada pengunjung dan mengatur persetujuan tracking sesuai aturan yang berlaku. Payload event dibatasi, dan endpoint tidak menerima access token iklan.
