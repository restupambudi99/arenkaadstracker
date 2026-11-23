# Arenka Ads Tracker

Dashboard atribusi iklan dan lead berbasis Cloudflare Workers + D1. Repo dimulai dari kosong dan aplikasi ini membangun alur tracking yang setara secara fungsi dengan workflow yang diamati pada aplikasi referensi, dengan identitas dan implementasi Arenka sendiri.

## Modul

- Ringkasan: lead, biaya, revenue, ROAS, distribusi sumber, dan tahap lead.
- Leads: pencarian, filter status, input manual, perubahan status, dan ekspor CSV.
- Integrasi iklan: status enam platform dan metadata akun. OAuth/provider API belum diaktifkan.
- Event mapping: pemetaan tujuh event ke event tujuan per platform.
- Tracking code: script embed workspace, event otomatis, dan `window.arenkaTrack(event, payload)`.
- UTM: template parameter untuk platform iklan.
- Campaign report: biaya manual, lead, closing, revenue, ROAS, rentang tanggal, dan ekspor CSV.
- Event logs: 100 event terakhir.

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

## Memasang tracker

Catatan: script akan tersedia setelah custom domain aktif.

```html
<script async src="https://trackers.arenka.biz.id/tracker.js?k=WORKSPACE_KEY"></script>
```

Kode ini menyimpan UTM sesi, merekam `Visit LP`, serta klik tautan WhatsApp dan elemen `data-track`. Untuk custom event:

```js
window.arenkaTrack("Masuk WA", { name: "Nama lead", phone: "+62..." });
```

## Kondisi provider iklan

OAuth dan sinkronisasi biaya live belum tersedia. Halaman Integrasi menyebut status secara eksplisit dan hanya menyimpan nama/ID akun. Untuk mengaktifkan data live, setiap provider masih memerlukan aplikasi developer, redirect URI, secret terenkripsi, token refresh, dan implementasi API serta webhook sesuai provider.

## Data pengunjung

Pemilik situs bertanggung jawab memberi pemberitahuan kepada pengunjung dan mengatur persetujuan tracking sesuai aturan yang berlaku. Payload event dibatasi, dan endpoint tidak menerima access token iklan.
