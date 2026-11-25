# Audit sinkronisasi menu Arenka Ads dan CSPoint

Tanggal audit: 25 November 2026  
Lingkungan UI: Worker lokal dengan data QA terisolasi.  
Ruang lingkup: navigasi, tombol menu lintas modul, kontak dan leads, template follow-up, inbox QR, aksesibilitas dialog, dan status fitur.

## Perubahan

- Menu WhatsApp **Form & katalog** membuka katalog Produk CSPoint yang sama dengan sumber data produk agent. Halaman produk menyediakan pintasan kembali ke Broadcast.
- Kontak CSPoint menyediakan pencarian lead berdasarkan nomor WhatsApp. Tautan membawa nomor sebagai pencarian pada `/leads`; halaman Leads membaca parameter `q` dan menampilkan hasil yang cocok. Kontak dan leads tetap berupa record terpisah, sehingga tidak ada duplikasi atau perubahan data otomatis.
- Inbox QR membaca template FU tersimpan dan dapat menyisipkannya ke kolom pesan. Template Cloud API/Meta tetap berada di menu WhatsApp lama dan tidak dicampur dengan template FU.
- Inbox QR mengikat hasil pesan setelah kirim ke percakapan asal. Jika pengguna berpindah percakapan saat permintaan berjalan, pesan tidak masuk ke tampilan percakapan yang salah.
- Menu aktif sekarang dapat ditutup. Di ponsel, menu dapat dibuka dan ditutup dengan Escape serta fokus berpindah ke tombol tutup. Sasaran menu dibuat lebih mudah disentuh.
- Ikon notifikasi membuka log aktivitas. Bantuan membuka petunjuk tracking. Workspace yang belum menyediakan pemilih workspace tampil sebagai identitas, bukan tombol yang seolah dapat mengganti workspace.
- Rute yang belum tersedia menunjukkan statusnya secara jelas dan tidak menawarkan tombol contoh yang hanya memindahkan pengguna ke halaman yang tidak berkaitan.
- Dialog Arenka mengembalikan fokus setelah ditutup, membatasi navigasi Tab di dalam dialog, dan tetap mendukung Escape.

## Hasil verifikasi

- Klik menu Form & katalog pada browser lokal membuka halaman Produk CSPoint.
- Tombol Cari lead pada kontak QA membuka Leads dengan nomor kontak terisi pada pencarian.
- Menu WhatsApp yang aktif dapat diciutkan dan `aria-expanded` berubah menjadi `false`.
- Pada viewport 390 px, menu dapat dibuka, fokus menuju tombol tutup, Escape menutup menu, dan lebar dokumen tetap 390 px.
- `npm run build` berhasil.
- `npm run test:cspoint` berhasil: 11 tes lulus, termasuk pemisahan workspace, validasi data, alur inbox gateway, dan pencegahan pengiriman ganda.

## Batas fungsi yang masih terlihat

- Team, Billing, Afiliasi, dan Biaya WhatsApp belum memiliki alur kerja atau penyimpanan; halaman menyatakannya dan tidak menampilkan aksi palsu.
- Integrasi iklan menyimpan nama dan ID akun. OAuth, sinkronisasi biaya iklan, dan token platform belum tersedia.
- Inbox WhatsApp lama memakai Cloud API Meta. Inbox QR CSPoint membutuhkan gateway terpisah. Kode UI dan kontraknya diuji lokal; status gateway dan pengiriman pesan pada workspace produksi belum diverifikasi dalam audit ini.
- Halaman produk menjadi katalog bersama untuk penggunaan agent. Belum ada form pemesanan publik yang menghasilkan pesanan.

Data QA berada pada penyimpanan lokal dan tidak dipakai untuk mengubah data workspace produksi.

## Rilis

- GitHub `main`: commit audit `ead3dcd`.
- Cloudflare Worker `arenka-ads-tracker`: versi `4ac8bb40-bf61-4b49-9cf5-17e2b8f9a8f6` pada `trackers.arenka.biz.id`.
- Smoke check publik: `/` dan `/cspoint/products` mengembalikan 200; asset aplikasi mengembalikan 200; `/api/me` dan data CSPoint tanpa sesi mengembalikan 401 sebagaimana mestinya.
