# Audit penambahan CSPoint, 25 November 2026

## Bukti backend

`npm run test:cspoint`: 11 kelompok pengujian lulus, termasuk dua file pengujian ongkir dari arsip CSPoint.

- Cookie sesi/origin Arenka tetap wajib untuk API CSPoint; `/api/me`, leads dan integrasi lama masih merespons.
- CRUD kelima jenis data, pencarian, paginasi, validasi telepon/nominal/tahap, batas dokumen.
- Workspace B tidak dapat melihat, mengubah, atau menghapus ID workspace A.
- Secret terenkripsi, respons hanya flag, perubahan URL menghapus kredensial lama; gateway tidak dapat dibagi dua workspace.
- Callback tanpa token ditolak; agent nonaktif tidak membalas.
- Provider AI palsu menerima referensi workspace yang benar; tidak ada panggilan WhatsApp pada uji draf.
- Gateway memerlukan token DAN workspace; QR/connect/disconnect menggunakan socket palsu.
- Labels, assign labels, receipt/read/unread, riwayat per nomor, manual send dan pause AI.
- Pesan duplikat, takeover manusia selama draf, dan timeout send tidak menghasilkan pengiriman ulang.
- Tariff parsing, wilayah ambigu, konfirmasi ongkir, invalidasi alamat, isolasi lead, sumber CS, echo race, dan perhitungan total dari test asal.

`npm run build`: TypeScript dan build client/Worker lulus. PDF parser dan CSPoint dimuat secara lazy. Worker tidak mengimpor node:sqlite atau Baileys.

## Bukti UI lokal

Pengujian dilakukan pada database QA terpisah melalui browser, memakai data buatan dengan label QA.

| Aksi | Hasil yang terlihat |
| --- | --- |
| Login akun QA lokal | Membuka menu Produk memakai auth Arenka |
| Tambah produk | Baris produk tersimpan dan muncul |
| Ubah produk | Nama baru muncul pada tabel |
| Cari produk yang tidak ada | Empty state pencarian terlihat |
| Kosongkan pencarian | Baris produk kembali muncul |
| Tambah lalu Escape | Dialog tertutup; tidak ada data tambahan |
| Tambah pesanan, pilih Diproses, isi total | Baris pesanan muncul |
| Tambah kontak 08… | Baris kontak tersimpan melalui normalisasi API |
| Tambah template FU2 | Template muncul pada tabel |
| Salin template | Pesan “Template disalin.” terlihat |
| Upload PDF teks buatan | Teks diekstrak dan tampil pada editor sebelum disimpan |
| Simpan Knowledge | Baris Knowledge muncul |
| Cek ongkir tanpa tabel tarif | Pesan “Daftar tarif belum tersedia” |
| Simpan nama/instruksi agent tanpa aktif | Pesan berhasil tersimpan |
| Uji AI tanpa key | Pesan konfigurasi yang diperlukan terlihat, tanpa klaim balasan berhasil |
| Simpan koneksi kosong | Config tersimpan tanpa menciptakan kredensial |
| WhatsApp QR tanpa gateway | Pesan gateway belum dihubungkan dan tombol Pengaturan gateway berfungsi |
| Coba lagi pada error gateway | Error tetap jelas; tidak memunculkan nomor palsu |
| Ponsel 390 × 844 | Lebar dokumen 390 px; tombol baru 44 px; form tidak keluar layar |
| Menu ponsel → Produk | Navigasi menutup menu dan membuka tabel |
| Tabel produk di ponsel | Container 358 px, konten 406 px dapat digeser di dalam tabel |
| Dialog di ponsel + Escape | Dialog tertutup |

Hapus data diverifikasi melalui test API. Konfirmasi/cancel UI mengikuti dialog native yang sama; tidak menghapus data produksi.

## Batas verifikasi

- QR nyata belum dipasangkan; tidak ada pesan pelanggan dikirim. Tombol gateway yang bergantung pada nomor sungguhan diverifikasi lewat kontrak API/socket palsu, bukan scan pada ponsel.
- Kredensial 9Router produksi belum disetel pada modul baru. Draf/model diuji dengan provider palsu dan kondisi belum dikonfigurasi, bukan klaim koneksi provider live.
- Label/gateway inbox belum diklik end-to-end dengan layanan produksi; unit/integration test mencakup operasinya.
- Scheduler FU, Form Builder penuh, OCR, media, dan impor massal tidak dihadirkan sebagai fungsi yang sudah siap.
- UI memakai tema Arenka yang sudah ada sesuai arahan pemilik. Tidak ada tema baru, perubahan login, atau penggantian dashboard.

## Verifikasi produksi

- Commit implementasi: `f511dd8f70c6d1485f87b312122bc491ea90c3f7`, sudah dipush ke `main` GitHub.
- Migration `0019_cspoint.sql` berhasil diterapkan pada D1 remote; hanya satu migration baru yang menunggu saat pemeriksaan.
- Worker `arenka-ads-tracker` diterbitkan pada `trackers.arenka.biz.id`, version `ee284eef-28ef-4651-b1c5-7fc7fe75e5fe`.
- GET `/cspoint/products` = 200 dan memuat hash build yang sama dengan hasil build lokal; bundle CSPoint = 200.
- GET `/api/cspoint/records/products` dan `/api/me` tanpa sesi = 401; `/tracker.js` tetap 200.
- Pemeriksaan browser produksi menampilkan halaman login Arenka yang sudah ada. Pengujian CRUD terautentikasi dilakukan lokal, bukan pada akun produksi.
- Hitungan users, workspaces, leads, events dan wa_messages sama sebelum/sesudah migrasi. Tabel CSPoint produksi masih kosong; tidak ada data QA atau kredensial provider yang dipindahkan ke produksi.
- Pemeriksaan console pada reload build final lokal dan buka/tutup dialog tidak menemukan exception atau console error.

## Catatan untuk agent berikutnya

Periksa status aktual gateway dan provider melalui Pengaturan CSPoint sebelum menyatakan QR/AI aktif. Jangan memakai akun/password bawaan atau bypass login. Jangan menggunakan sesi WhatsApp lama untuk menguji integrasi. Jalankan pemeriksaan migrasi remote sebelum menambahkan migration baru. Semua perubahan lanjutan harus dicatat ke GitHub sesuai permintaan pemilik.
