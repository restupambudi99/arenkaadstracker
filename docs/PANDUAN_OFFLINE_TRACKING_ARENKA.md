# Panduan Offline Tracking Arenka

Panduan ini menjelaskan cara mengimpor laporan kinerja iklan Meta ke menu **Offline Tracking** di Arenka Ads Tracker. Fitur ini membaca file export yang dipilih dan membuat analisis historis. Proses ini terpisah dari pixel dan Conversions API: data import tidak mengirim event kembali ke Meta.

## 1. Siapkan laporan dari Meta Ads Manager

1. Buka Ads Manager dan pilih akun iklan serta rentang tanggal yang ingin dianalisis.
2. Pilih tab **Iklan (Ads)** untuk mendapatkan rincian sampai nama iklan. Pastikan Anda menggunakan tampilan kolom yang memuat metrik performa.
3. Pilih **Breakdown / Perincian → By time → Day** agar setiap baris mewakili satu hari. Hindari menggabungkan beberapa rentang atau tujuan hasil yang berbeda dalam satu laporan.
4. Ekspor sebagai **CSV** atau **XLSX**. Gunakan kolom yang setara dengan Day, Campaign name, Amount spent, Impressions, dan Results. Ad set, Ad name, Reach, Frequency, Link clicks, video plays, budget, objective, delivery, serta quality ranking dapat disertakan sebagai rincian tambahan.
5. Simpan file secara lokal. File akan dibaca pada browser dan tidak diunggah sebagai file mentah.

## 2. Impor di Arenka

1. Buka **Workspace → Offline Tracking**, lalu pilih **Upload laporan**.
2. Pilih file CSV/XLSX atau tarik file ke area impor. Batas ukuran file 12 MB dan maksimal 5.000 baris data per laporan.
3. Periksa pemetaan kolom. Arenka mencoba mencocokkan judul kolom; pilih sendiri kolom tanggal, campaign, biaya, impressions, dan results bila belum cocok. Kolom lain bersifat opsional.
4. Pilih tujuan yang paling sesuai: Click to WhatsApp, landing page ke WhatsApp, instant form, form website, penjualan website, atau CPAS. Pisahkan laporan ketika metrik Results mewakili tujuan yang berbeda.
5. Pilih mata uang serta format angka/tanggal. Tinjau rentang tanggal dan ringkasan biaya/hasil sebelum menyimpan.
6. Secara opsional isi target biaya per hasil. Untuk proyeksi penjualan, isi asumsi laba dan persentase closing. Proyeksi tersebut hanya perkiraan dari asumsi Anda.
7. Pilih **Simpan**. Metrik terpilih disimpan sebagai baris laporan pada workspace aktif.

## 3. Baca analisis

Pilih laporan untuk melihat KPI biaya, hasil, biaya per hasil, CTR link, ringkasan periode, tren harian, alur impressions-ke-klik-ke-hasil, serta rincian campaign, ad set, iklan, dan breakdown yang tersedia. Gunakan pilihan mingguan/bulanan/rentang, bandingkan periode sebelumnya, atau filter campaign. **Ekspor CSV** mengunduh baris yang sedang difilter; **Cetak report** membuka dialog cetak browser untuk menyimpan atau mencetak ringkasan.

Biaya per hasil adalah total biaya dibagi total hasil. CTR link adalah link clicks dibagi impressions. Periksa definisi kolom Results pada export Anda karena definisinya mengikuti tujuan dan pengaturan atribusi Meta. Bila export tidak menyediakan suatu kolom, analisis menandainya sebagai tidak tersedia. Hasil ini bersumber dari file yang diimpor, bukan sinkronisasi langsung akun iklan.

## 4. Data, privasi, dan pengelolaan

Arenka memproses file di browser dan mengirim metrik yang sudah dipetakan untuk disimpan dalam workspace. Nama file, rentang, tujuan, serta nilai metrik dicatat agar laporan bisa ditinjau kembali. Laporan dibatasi pada workspace aktif. Hindari memasukkan data pribadi pelanggan ke kolom tambahan atau nama file. Hapus laporan melalui ikon hapus bila tidak diperlukan lagi; penghapusan menghapus baris metrik terkait.

Impor tidak mengubah akun Meta, tidak memasang pixel, dan tidak mengirim data ke Conversions API. Atur pixel/CAPI secara terpisah di menu **Meta Conversions API**. Gunakan data sesuai pemberitahuan privasi dan hak akses akun iklan Anda.

## Pemecahan masalah

- **Header tidak ditemukan:** pastikan file berasal dari Ads Manager dan berisi kolom tanggal, campaign, biaya, impressions, dan results.
- **Sebagian baris terlewat:** periksa tanggal dan nama campaign; pilih format tanggal/angka yang sesuai lalu cek pemetaan.
- **Angka berubah skala:** pilih format Indonesia untuk `1.234,56` atau English untuk `1,234.56`.
- **File terlalu besar:** batasi tanggal atau pecah export agar maksimal 5.000 baris pada setiap laporan.
- **File sudah pernah diimpor:** setiap file hanya dapat disimpan satu kali per workspace; pilih export yang diperbarui dan simpan sebagai file baru.
- **Nilai Results tidak sebanding:** buat laporan terpisah untuk setiap tujuan konversi dan periksa definisi metrik di Ads Manager.

Arenka Ads Tracker · Panduan Offline Tracking · Versi 1
