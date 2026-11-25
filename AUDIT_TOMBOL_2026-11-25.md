# Audit fungsi tombol — 25 November 2026

## Cakupan

- Menjelajahi seluruh 25 rute menu workspace melalui sesi produksi yang sudah login.
- Memeriksa 160 elemen tombol di `src/App.tsx` melalui handler JSX, disabled state, dan form submit. Satu elemen tambahan berasal dari komponen tombol bersama.
- Membuka dialog integrasi Meta dan webhook masuk tanpa menyimpan konfigurasi.
- Mencoba navigasi, Workspace selector, Bantuan, Salin kunci tracker, Salin script, dan Salin parameter UTM.
- Tidak menjalankan aksi yang menulis data, menghapus data, mengekspor kontak, mengirim pesan, atau memanggil endpoint eksternal.

## Temuan

### P1 — Tombol Notifikasi tidak berfungsi

Ikon lonceng di topbar memiliki label aksesibel `Notifikasi`, tetapi tidak memiliki handler klik atau tujuan. Klik pada UI produksi tidak membuka panel maupun memberi respons. Tambahkan tampilan notifikasi yang terhubung ke backend, atau sembunyikan/nonaktifkan tombol sampai fiturnya tersedia.

### P1 — Lima rute adalah placeholder tanpa fungsi aplikasi

`Form & katalog`, `Biaya WhatsApp`, `Team`, `Billing`, dan `Afiliasi` masih menampilkan “Modul belum tersedia”. Tombol di dalamnya hanya mengarahkan ke Integrasi iklan atau Leads; belum menjalankan fungsi halaman yang dijanjikan.

### P1 — Integrasi iklan bukan OAuth aktif

Tombol `Hubungkan` membuka dialog dan menyimpan nama serta ID akun. Dialog menjelaskan OAuth dan sinkronisasi belum dikonfigurasi; tidak ada koneksi token atau data biaya live. Label “Hubungkan” dapat disalahartikan sebagai koneksi akun sebenarnya.

### P1 — Fitur WhatsApp bergantung pada koneksi Meta

Sesi produksi menunjukkan WhatsApp belum terhubung dan belum ada penerima/template. Sinkronisasi template, balasan Inbox, aturan otomatis, broadcast, dan rotator berbasis nomor bisnis belum dapat diverifikasi end-to-end tanpa koneksi dan data Meta. Jangan menganggap tombol yang memanggil API sudah berhasil hanya dari terbukanya dialog.

### P2 — Custom domain hanya allowlist

Halaman menjelaskan hostname hanya diizinkan untuk event. Provisioning DNS, SSL, dan routing Worker pelanggan belum tersedia; tombol tambah hostname tidak membuat domain kustom aktif.

### P2 — Tombol ekspor dinonaktifkan saat data kosong

Di workspace ini belum ada lead/event/order. Tombol ekspor campaign report dan lokasi terlihat nonaktif pada keadaan kosong. Ini sesuai dengan ketiadaan data, tetapi perlu dicek lagi setelah ada data.

## Perilaku yang terverifikasi

- Seluruh 25 rute menu berhasil dibuka tanpa halaman error.
- Tab Integrasi iklan (Platform, Event mapping, Tracking code, UTM) berpindah dengan benar.
- Dialog `Hubungkan Meta` dan `Buat webhook masuk` terbuka dan bisa ditutup tanpa menyimpan.
- Bantuan menampilkan petunjuk; Salin kunci tracker, Salin script, dan Salin parameter UTM menyalin konten serta memberi toast sukses.
- Workspace selector membuka status workspace aktif.
- Tombol Notifikasi tidak mengubah tampilan.
- Tombol submit yang tampak tidak memiliki `onClick` adalah submit form atau state sibuk/nonaktif; bukan temuan tombol aktif tanpa handler selain Notifikasi.

## Batas audit

Perilaku yang memerlukan data nyata, kredensial provider, pengiriman WhatsApp/email, penghapusan, atau perubahan database tidak dieksekusi pada akun produksi. Audit ini memastikan rute dan alur UI yang aman, serta mencocokkan tombol dengan handler; bukan bukti seluruh integrasi pihak ketiga bekerja end-to-end.
