# 06 - Stock Count dan Adjustment

## 1. Tujuan dan jadwal

Stock count mencatat hasil fisik, bukan transaksi stok. Adjustment adalah dokumen
terpisah yang menerjemahkan selisih terverifikasi menjadi ledger append-only.
Jadwal: harian untuk material kritis/pergerakan tinggi, sampling mingguan,
bulanan penuh atau parsial terencana, dan ad-hoc setelah insiden atau kebutuhan
rekonsiliasi. Head menetapkan lokasi dan petugas. Jadwal otomatis belum tersedia.

## 2. Scope dan freeze (aturan sementara paling aman)

Satu count mencakup satu lokasi dalam satu gudang, seluruh SKU/batch lokasi itu.
Mulai count SEBELUM menghitung fisik. Dalam satu transaksi: kunci baris lokasi,
ambil snapshot system_quantity dari ledger, simpan count, aktifkan freeze.
Snapshot tidak berubah pada submit, recount, verify, approve, atau posting.
Staff tidak menerima snapshot, saldo, atau selisih melalui payload backend.
Barang ditemukan yang belum ada di snapshot dicatat dengan snapshot nol.

Semua mutasi masuk/keluar, transfer pada kedua sisi, dan adjustment lain pada
lokasi beku ditolak sampai posting atau cancel selesai. Lokasi lain tetap berjalan.
Jangan mulai jika ada pekerjaan fisik/transaksi pending yang belum diselesaikan.
Backend minimal belum memiliki receiving/issue pending: pemeriksaan tersebut
wajib ditambahkan saat integrasi receiving/issue. Fitur tersebut dinonaktifkan pada frontend terhubung.
Freeze jangan kedaluwarsa otomatis. Gangguan ditangani cancel beralasan.

## 3. Alur dan pemisahan tugas

1. Staff mulai COUNTING, isi seluruh hasil integer satuan dasar, lalu COUNTED.
2. Admin berbeda dari penghitung memeriksa hasil dan alasan. Bila perlu meminta
   recount beralasan: kembali COUNTING, snapshot/freeze tetap. Submit sebelumnya
   tetap tersimpan pada audit; Staff mengirim hasil baru. Lalu VERIFIED.
3. Head berbeda dari penghitung dan verifier menyetujui count. Transaksi ini
   membuat satu adjustment PENDING dengan baris selisih nonnol dan relasi count_id.
   Status count APPROVED; belum ada perubahan stok dan lokasi masih beku.
4. Aksi Head terpisah menyetujui DAN mem-posting adjustment: ledger, status POSTED,
   count COMPLETED, pelepasan freeze, audit, dan receipt idempotensi satu transaksi.
5. Jika semua selisih nol, approval langsung COMPLETED, tanpa adjustment/ledger,
   lokasi dibuka kembali. Tidak ada approval otomatis untuk selisih kecil.

Frontend terhubung menampilkan status backend secara langsung; status adjustment
menentukan apakah count APPROVED masih menunggu posting dan lokasi tetap beku.

## 4. Alasan selisih wajib

Setiap baris nonnol wajib alasan: miscount (salah hitung), damaged (rusak),
wrong_location (salah lokasi), unrecorded_transaction (transaksi belum tercatat),
missing (hilang), other (lainnya; penjelasan wajib). Admin mengisi alasan saat
verifikasi. Jangan mengubah angka fisik untuk menyembunyikan selisih: minta recount.
Backend menyimpan alasan per baris; demo menerapkan pilihan alasan dan penjelasan
ke seluruh baris berselisih. Bukti/foto dan tindak lanjut investigasi sesuai audit.

## 5. Model dan transaksi

stock_counts + stock_count_lines menyimpan scope, snapshot, hasil, petugas,
status, waktu mulai, dan correction_of. adjustments + adjustment_lines menyimpan
referensi count unik, delta nonnol, alasan dan status posting. inventory_ledger
mereferensikan adjustment, bukan count; audit_events append-only menyimpan aksi.

PostgreSQL: row lock lokasi, unique active-count index, unique adjustment per
count dan ledger per adjustment/item/batch. Setiap command punya idempotency key:
retry request identik mengembalikan hasil tersimpan; key dengan payload berbeda
ditolak. Advisory transaction lock menserialisasi retry. Kegagalan rollback
seluruh command, termasuk ledger, status, audit, dan receipt. Approval count dan
posting adjustment adalah DUA transaksi bisnis berbeda, masing-masing atomik.

## 6. Cancel dan koreksi

Staff boleh cancel count miliknya saat COUNTING; Admin sebelum approval; Head
sebelum posting. Alasan wajib. Cancel count APPROVED membatalkan adjustment
PENDING dalam transaksi yang sama. Rejection adjustment berarti cancel beralasan
melalui count terkait; jangan melepas freeze sambil meninggalkan adjustment aktif.
Dokumen posted/selesai tidak dapat dibatalkan atau diedit, meski belum diekspor.
Koreksi adalah count baru dengan correction_of ke count selesai di lokasi sama,
snapshot baru, verifikasi/approval baru, adjustment baru. Ledger lama tidak diubah.

## 7. Audit dan pengamanan

Audit mencatat actor, waktu server, aksi, dokumen dan payload hasil/input command;
recount mempertahankan hasil lama melalui audit submit. Target audit lengkap
(perangkat, shift, before/after, viewed events) mengikuti dokumen 07, belum seluruhnya
tersedia dalam modul minimal. Role/gudang wajib berasal dari autentikasi terpercaya,
bukan request body. HTTP API memperoleh Actor dari sesi cookie HttpOnly dan
membership gudang di database. Password memakai scrypt, sesi disimpan sebagai hash,
mutation memeriksa Origin, dan login dibatasi. Master SKU/serial lengkap belum tersedia.
DB owner/admin dapat melewati guard; jangan mengekspos koneksi DB kepada pengguna.

## 8. Ekspor

Hanya adjustment POSTED yang layak antrean ekspor. Minus mengikuti pengurangan
stok. Plus belum memiliki jalur BigSeller yang disepakati; jangan menyamarkan
stok lebih sebagai penerimaan supplier. Zero variance tidak ikut ekspor.

## 9. Implementasi dan validasi

backend memakai Node TypeScript, pg, migration SQL PostgreSQL dan service
transaksional. Docker Compose menyediakan PostgreSQL persisten. Tes memakai
PGlite (engine PostgreSQL WASM, bukan mock) untuk constraint, rollback transaksi,
freeze, snapshot, pemisahan dokumen, retry, dan append-only. Tes ini tidak
membuktikan konkurensi multi-connection server PostgreSQL; uji integrasi tersebut
wajib sebelum deployment. Tidak ada Docker/psql pada lingkungan pengembangan ini.
Frontend default memakai API; data demo localStorage tidak dibaca. Tes HTTP mencakup
auth, isolasi gudang/owner, blind count, alur lengkap, logout/expiry, throttling, serta
persistensi disk setelah DB dibuka ulang. PGlite persisten tersedia hanya sebagai mode
development eksplisit. Mulai count menyimpan freeze sebelum form hasil fisik dibuka.

## 10. Integrasi berikutnya

Master SKU/batch/serial lengkap, administrasi akun/membership, shift server,
audit lengkap, pending receiving/issue, lampiran, scheduler, export jobs dan uji
konkurensi PostgreSQL nyata belum termasuk. Semua writer stok harus memakai
lock lokasi dan ledger; trigger menolak mutasi pada lokasi beku.

## 11. Keputusan terbuka

1. Kalender operasional dan penugasan per lokasi.
2. Ambang eskalasi investigasi (bukan pengecualian approval).
3. Prosedur pemulihan count tertunda dan SLA freeze.
4. Rincian serial dan bukti pendukung.
5. Jalur BigSeller adjustment plus.
