# Arenka Ads Tracker

## Bahasa dan konteks
- Jelaskan pekerjaan kepada pemilik repo dalam Bahasa Indonesia.
- Ikuti `design-system/arenka-ads-tracker/MASTER.md` untuk perubahan UI.
- UI memakai React + Vite + Tailwind v4 dan komponen lokal bergaya shadcn/ui di `src/components/ui`.
- Backend berjalan sebagai Cloudflare Worker dengan Hono dan D1. Jangan menganggap konektor Emdash CMS sebagai runtime Worker.

## Arsitektur
- `src/App.tsx`: dashboard, leads, integrasi, mapping, tracker, UTM, report, event log.
- `worker/index.ts`: API, auth, event ingestion, dan static asset fallback.
- `migrations/`: skema D1. Buat migration baru; jangan ubah migration yang sudah diterapkan.
- Semua data aplikasi dibatasi `workspace_id`; query baru harus mengikuti batas ini.
- Secret `SESSION_SECRET` hanya lewat `.dev.vars` lokal atau `wrangler secret put`; jangan masukkan secret ke source/config yang di-commit.

## Batas fitur saat ini
- Login/registrasi dan tracking pihak pertama berfungsi setelah Worker dan D1 dikonfigurasi.
- Integrasi OAuth Meta, Google Ads, TikTok, GA4, LinkedIn, dan ChatGPT Ads belum dibuat. UI hanya menyimpan ID/nama akun tanpa access token.
- Ad spend dapat dimasukkan manual. Report saat ini mengagregasi event lead dan biaya manual.
- Tracker script mengirim page view dan klik CTA WhatsApp/elemen `data-track`; `window.arenkaTrack(event, payload)` tersedia untuk custom event.
- Sebelum mengumpulkan data pengunjung di situs publik, pemilik situs harus memberi pemberitahuan dan mengatur consent sesuai kebijakan yang berlaku.

## Pengembangan dan deployment
- `npm install` lalu `npm run dev` untuk pengembangan lokal.
- `npm run db:local` menerapkan migration ke D1 lokal.
- `npm run build` memeriksa TypeScript dan membangun asset produksi.
- Database Cloudflare D1 `arenka-tracker` sudah dibuat dan ID tersimpan di `wrangler.jsonc`; buat secret Worker `SESSION_SECRET` sebelum deploy.
- Terapkan migration remote, deploy Worker, lalu pasang route/domain `trackers.arenka.biz.id` pada Worker.
- Setiap perubahan yang diminta pemilik repo harus dicatat dengan commit Git.
