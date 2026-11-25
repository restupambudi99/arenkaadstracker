# Catatan operasional Arenka

## 25 November 2026: pemulihan akses pemilik

Atas permintaan pemilik, kata sandi akun yang sudah ada diperbarui dengan kata sandi sementara acak. Tidak ada akun baru, perubahan hak akses, bypass autentikasi, atau perubahan kode login.

- Hash mengikuti implementasi aplikasi: PBKDF2-SHA256, 100.000 iterasi, salt acak 16 byte.
- Versi sesi akun dinaikkan sehingga sesi sebelumnya tidak berlaku; token reset lama yang belum terpakai dinonaktifkan.
- Login memakai kata sandi baru, akses `/api/me`, dan logout sesi pengujian masing-masing mengembalikan HTTP 200.
- Kata sandi diberikan langsung kepada pemilik melalui percakapan, tidak dicatat di source, dokumentasi, atau Git. Berkas sementara yang berisi kredensial dan SQL sudah dihapus.
- Tidak ada kedaluwarsa otomatis khusus pada kata sandi sementara ini. Status sementara berarti pemilik dapat menggantinya; jangan menjanjikan mekanisme kedaluwarsa yang belum dibuat.

Jika pemulihan diperlukan lagi, gunakan otorisasi pemilik dan jalur administrasi yang tersedia. Jangan menambahkan password bawaan atau akses admin hanya berdasarkan email.
