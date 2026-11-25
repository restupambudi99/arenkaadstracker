# Catatan REA: Watzora Ads ke Arenka Ads Tracker

Tanggal pengamatan: 25 November 2026  
Sumber: tampilan `https://ads.watzora.online/` yang dibuka pemilik di Codex Browser.

## Cara pengamatan dan batasnya

Skill Reverse Engineer Anything digunakan untuk merencanakan observasi UI/runtime. Passive capture REA melalui CDP tidak tersedia karena browser in-app tidak memberikan endpoint debugging. Oleh karena itu bukti di bawah berasal dari pengamatan UI yang terlihat di Codex Browser; tidak ada inspeksi source code Watzora, API internal, atau akses data akun. Akun WhatsApp tampak belum terhubung dan tabel pelanggan/log kosong. Tidak ada QR yang dipindai dan tidak ada transaksi/top-up dilakukan.

## Menu dan fungsi yang terlihat

- Dashboard: total Lead, Pembelian, Omset, persentase pembelian, status event Meta, lead dari iklan, chat terlewat, grafik dan filter periode.
- Hubungkan WhatsApp: instruksi scan QR; chat masuk direkam; Click-to-WhatsApp disebut membawa `ctwa_clid`.
- Pelanggan: cari, filter Lead/Pembelian, rentang tanggal, ekspor CSV, status pengiriman Meta.
- Log Event: filter jenis chat masuk, event uji, status terkirim/pending/gagal.
- Pengaturan Pixel: Pixel ID, CAPI Access Token, Test Event Code, mata uang, pengiriman Lead otomatis, pembatasan lead iklan, `ctwa_clid`, tes Lead dan Purchase.
- Saldo dan Top Up: saldo, harga per chat, paket top up, pembuatan tagihan.
- Akun Saya: profil dan pengaturan akun.

Nilai konfigurasi dan data pribadi tidak dibaca atau disalin. Tampilan saldo adalah produk berbayar; fitur tersebut tidak dibuat sebagai simulasi saldo karena Arenka tidak memiliki billing provider yang terhubung. Menu penghapusan akun/data Watzora juga tidak disalin.

## Penambahan di Arenka

- Menu Tracking > Meta Conversions API untuk Pixel ID, token terenkripsi, Test Event Code, mata uang, persetujuan pengiriman, toggle Lead/Purchase, dan riwayat status Meta.
- Event uji Lead/Purchase hanya mengirim data sintetis dengan Test Event Code.
- Chat WhatsApp baru yang diteruskan gateway QR dicatat menjadi lead pada workspace terkait. Nilai `ctwa_clid` opsional disimpan dan dapat digunakan untuk membatasi lead iklan.
- Lead baru dengan status Closing dan transisi ke Closing mengantrekan Purchase bila pemilik mengaktifkan pengiriman otomatis. Transaksi Mayar yang baru dicocokkan menghasilkan Purchase dengan nilai transaksi.
- Payload CAPI meng-hash email, nomor, nama, dan ID lead sebelum pengiriman. Token dienkripsi di Worker. Event, token, dan query selalu dibatasi workspace.
- Pengiriman otomatis nonaktif secara default dan mensyaratkan konfirmasi hak/dasar pengiriman data.

## Batas implementasi

- Pengiriman lead QR memerlukan CSPoint gateway tersedia, dikonfigurasi, dan tersambung. Penerimaan pesan WA Cloud API yang dikelola Meta memiliki jalur webhook terpisah dan pengaitan CAPI otomatis untuk pesan webhook belum termasuk penambahan ini.
- Deteksi `ctwa_clid` mengikuti properti konteks pesan yang tersedia dari Baileys; ketersediaannya bergantung pada tipe pesan/ad referral.
- Endpoint Graph API mengikuti versi `v27.0` yang sudah digunakan konfigurasi WhatsApp di repo saat implementasi; verifikasi versi provider terkini belum dilakukan.
- Watzora menyatakan QR pairing, attribution, dan biaya chat pada UI; klaim efektivitas atau keamanan anti-ban tidak diverifikasi.
- Integrasi top-up, status koneksi WA Watzora, dan data historis akun tidak diakses atau direplikasi.

## Jalur file Arenka

- `migrations/0020_meta_conversions_api.sql`: token/config/status event per workspace.
- `worker/meta-capi.ts`: hashing payload dan klien Graph API.
- `worker/index.ts`: API pengaturan, event log, uji, Lead/Purchase.
- `worker/cspoint/index.ts` dan `services/cspoint-gateway/server.mjs`: lead masuk QR.
- `src/App.tsx` dan `src/styles.css`: menu dan UI CAPI.
- `tests/meta-capi.test.mjs`: pemeriksaan payload/hash/respons API.
