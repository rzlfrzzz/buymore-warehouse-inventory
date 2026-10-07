# 07 - Audit Rules

Dokumen ini mengatur apa yang dicatat sebagai jejak audit, bagaimana jejak itu
dijaga agar tidak bisa diubah, siapa yang boleh melihatnya, dan bagaimana
dipakai untuk pemantauan. Mengacu pada `03-role-permission.md`,
`05-inventory-rules.md`, `06-stock-count-rules.md`, `08-bigseller-export.md`,
dan skema `001` + `002`.

---

## 1. Prinsip

1. **Setiap aksi yang mengubah data atau melewati batas kontrol dicatat.**
2. **Append-only.** Baris audit tidak boleh diubah atau dihapus. Sudah
   ditegakkan di database oleh migration 002 (trigger menolak `UPDATE`,
   `DELETE`, dan `TRUNCATE`).
3. **Pencatatan di transaksi database yang sama** dengan aksi yang dicatat.
   Aksi yang berhasil tanpa catatan audit tidak boleh terjadi; jika pencatatan
   gagal, aksinya dibatalkan.
4. **Waktu dari server**, bukan dari perangkat pengguna. Disimpan UTC dan
   ditampilkan dalam zona waktu gudang.
5. **Pelaku selalu akun pribadi.** Akun bersama tidak diizinkan.
6. **Audit log tidak menggantikan ledger.** Ledger sudah merupakan catatan
   permanen setiap perubahan stok; audit log mencatat siapa dan mengapa,
   serta aksi non-stok. Baris audit merujuk ke dokumen atau ledger, tidak
   menyalin seluruh isinya.
7. **Tidak ada data rahasia di log:** kata sandi, token sesi, dan nilai
   sejenisnya tidak pernah dicatat.

---

## 2. Struktur Catatan

Tabel `audit_logs` saat ini memiliki kolom:

| Kolom | Isi |
|---|---|
| `id` | Primary key |
| `user_id` | Pelaku (pengguna) |
| `action` | Kode aksi |
| `entity_type` | Jenis objek (contoh: `receiving`, `issue`, `product`) |
| `entity_id` | ID objek |
| `old_data` / `new_data` | Nilai sebelum dan sesudah (JSONB) |
| `ip_address` / `user_agent` | Asal permintaan |
| `warehouse_id` | Gudang terkait (kosong untuk aksi global) |
| `created_at` | Waktu kejadian |

### Konvensi `action`

Format `entitas.aksi` dengan huruf kecil, contoh: `receiving.submit`,
`receiving.verify`, `stock_count.approve`, `export.job_complete`,
`auth.login_failed`. Daftar kode aksi dikelola di satu tempat di kode agar tidak
ada kode liar.

### Konvensi `old_data` dan `new_data`

- Hanya **kolom yang berubah**, bukan seluruh baris.
- Untuk pembuatan: `old_data` kosong. Untuk penghapusan draft: `new_data` kosong.
- Nilai kuantitas dalam **satuan dasar**.
- Alasan (jika wajib) disimpan di `new_data.reason` sampai kolom `reason` khusus
  tersedia (bagian 11).

---

## 3. Peristiwa yang Wajib Dicatat

### 3.1 Autentikasi dan keamanan

| Aksi | Keterangan |
|---|---|
| `auth.login` / `auth.login_failed` | Termasuk username yang dicoba dan asal |
| `auth.logout`, `auth.session_expired` | |
| `auth.password_changed`, `auth.password_reset` | Tanpa nilai kata sandi |
| `auth.locked` | Akun terkunci karena percobaan berulang |
| `security.permission_denied` | Aksi ditolak karena tidak punya izin |
| `security.sod_violation` | Percobaan melanggar pemisahan tugas (contoh: verifier = pembuat) |

### 3.2 Pengguna, role, dan gudang

| Aksi | Keterangan |
|---|---|
| `user.create`, `user.update`, `user.deactivate`, `user.reactivate` | Alasan wajib untuk nonaktif |
| `user_role.assign`, `user_role.end` | Role, gudang, periode |
| `warehouse.create`, `warehouse.update`, `warehouse.deactivate` | |
| `shift.create`, `shift.update`, `shift_schedule.change` | Perubahan jadwal tanggal yang sudah lewat wajib beralasan |

### 3.3 Master data

| Aksi | Keterangan |
|---|---|
| `product.create`, `product.update` | Termasuk perubahan flag batch/ED/serial, satuan dasar, presisi |
| `product.structure_override` | Override struktur produk setelah ada riwayat (wajib beralasan dan persetujuan Head) |
| `product_unit.change` | Perubahan faktor konversi |
| `location.create`, `location.update`, `location.deactivate` | |
| `supplier.create`, `supplier.update` | |
| `bigseller_mapping.change` | Perubahan `bigseller_sku` atau status terdaftar |
| `unit.change` | Termasuk `bigseller_uom_name` |

### 3.4 Dokumen transaksi (receiving dan issue)

| Aksi | Keterangan |
|---|---|
| `receiving.create`, `receiving.update`, `receiving.submit` | |
| `receiving.verify`, `receiving.reject`, `receiving.cancel` | Reject dan cancel wajib beralasan |
| `issue.create`, `issue.update`, `issue.submit` | |
| `issue.verify`, `issue.reject`, `issue.cancel` | Reject dan cancel wajib beralasan |
| `issue.batch_selected_non_fefo` | Checker memilih batch yang bukan kedaluwarsa terdekat |
| `issue.expired_batch_confirmed` | Batch kedaluwarsa dipilih dengan konfirmasi dan alasan |
| `ledger.post` | Merujuk ke baris ledger yang dihasilkan |
| `attachment.upload`, `attachment.delete` | Nama berkas, ukuran, objek terkait |

### 3.5 Stock count dan adjustment

| Aksi | Keterangan |
|---|---|
| `stock_count.create`, `stock_count.start` | Saat snapshot saldo sistem diambil |
| `stock_count.submit`, `stock_count.recount_request`, `stock_count.recount_submit` | Permintaan hitung ulang wajib beralasan |
| `stock_count.verify`, `stock_count.approve`, `stock_count.cancel` | |
| `stock_count.system_qty_viewed` | Admin atau Head melihat saldo sistem saat dokumen `COUNTING` |
| `adjustment.create`, `adjustment.approve`, `adjustment.reject` | Reject wajib beralasan |

### 3.6 Ekspor BigSeller

| Aksi | Keterangan |
|---|---|
| `export.job_create`, `export.item_add` | |
| `export.file_generate` | Nama berkas, jumlah baris, checksum |
| `export.file_download` | Setiap unduhan berkas |
| `export.job_complete`, `export.job_fail` | Pesan error BigSeller bila gagal |
| `export.item_released` | Pelepasan keterkaitan untuk ekspor ulang (dicatat otomatis oleh fungsi `release_export_item`, alasan wajib) |

### 3.7 Akses terhadap audit itu sendiri

| Aksi | Keterangan |
|---|---|
| `audit.view`, `audit.export` | Siapa membuka atau mengekspor audit log, filter yang dipakai |

---

## 4. Yang Tidak Dicatat

- Kata sandi, token, dan rahasia lain.
- Tampilan daftar atau pencarian biasa (kecuali yang disebut di bagian 3).
- Isi lengkap berkas lampiran (hanya metadata).
- Perubahan data yang sama sekali tidak berubah (update tanpa selisih).

---

## 5. Alasan Wajib

Aksi berikut **tidak boleh dilakukan tanpa alasan tertulis**; alasan disimpan
pada catatan audit:

| Aksi |
|---|
| Reject atau cancel receiving, issue, stock count, adjustment |
| Permintaan hitung ulang |
| Konfirmasi batch kedaluwarsa |
| Pelepasan keterkaitan ekspor (ekspor ulang) |
| Override struktur produk |
| Perubahan jadwal pada tanggal yang sudah lewat |
| Menonaktifkan user |
| Penerimaan barang dengan tanggal kedaluwarsa yang sudah lewat |

Alasan minimal 10 karakter dan tidak boleh hanya tanda baca atau angka
(validasi di aplikasi).

---

## 6. Perlindungan dan Integritas

| Lapisan | Mekanisme | Status |
|---|---|---|
| Trigger database | `audit_logs` dan `inventory_transactions` menolak UPDATE, DELETE, TRUNCATE | Ada (migration 002) |
| Hak akses database | `REVOKE UPDATE, DELETE, TRUNCATE` pada role aplikasi | Perlu dijalankan manual saat deployment |
| Akun database | Role aplikasi terpisah dari superuser; superuser tidak dipakai aplikasi | Prosedur deployment |
| Backup | `database/backups/` dan `scripts/backup/`; salinan di luar server | Perlu dibuat |
| Sinkron waktu | Server memakai NTP | Prosedur deployment |
| Tamper-evidence (opsional) | Rantai hash (`prev_hash`, `row_hash`) agar perubahan lewat akses langsung terdeteksi | Belum; lihat bagian 11 |

Catatan penting: trigger dapat dinonaktifkan oleh superuser database. Karena
itu hak akses (REVOKE), pembatasan akun superuser, dan backup luar server
adalah bagian dari kontrol audit, bukan pelengkap.

---

## 7. Akses dan Tampilan

| Kebutuhan | Role | Mekanisme |
|---|---|---|
| Melihat seluruh audit log gudang | Head | `audit.view`, difilter ke gudang yang ia pegang |
| Melihat audit global | System Admin | Belum diputuskan (bagian 11) |
| Melihat riwayat satu dokumen | Pembuat, Admin, Head | Garis waktu per dokumen di halaman dokumen; tidak sama dengan `audit.view` |
| Melihat riwayat dirinya sendiri | Semua | Opsional |
| Mengubah atau menghapus | Tidak ada | Tidak diizinkan untuk siapa pun |

**Garis waktu dokumen** menampilkan: dibuat oleh siapa, dikirim, diverifikasi
atau ditolak oleh siapa, kapan, dan alasannya. Role Admin tidak memiliki
`audit.view`, tetapi tetap perlu garis waktu dokumen yang ia verifikasi.

Penampil audit log menyediakan filter: rentang waktu, pengguna, gudang, shift,
jenis objek, kode aksi, dan nomor dokumen. Hasil dapat diekspor (`audit.export`,
hanya Head) dan ekspor itu sendiri dicatat.

---

## 8. Hubungan dengan Shift

Setiap catatan audit seharusnya membawa **shift_id dan shift_date** saat aksi
terjadi (lihat `04-shift-system.md`). Dengan begitu satu dokumen yang dibuat di
Shift 1 dan diverifikasi di Shift 2 terlihat jelas, dan rekap aktivitas per
shift dapat dibuat. Kolom ini belum ada di tabel (bagian 10).

---

## 9. Pemantauan dan Peringatan

Laporan atau peringatan yang diturunkan dari audit log dan data transaksi:

| Pola | Mengapa penting |
|---|---|
| Login gagal berulang atau dari asal tidak biasa | Percobaan akses tidak sah |
| Percobaan melanggar pemisahan tugas | Upaya menyetujui dokumen sendiri |
| User dengan banyak reject, cancel, atau reversal | Kemungkinan salah proses atau penyalahgunaan |
| Issue non-FEFO atau memilih batch kedaluwarsa berulang | Kontrol kualitas material |
| Transaksi di luar shift atau oleh user tidak terjadwal | Perbedaan jadwal dan aktual |
| Adjustment besar atau sering pada SKU yang sama | Kemungkinan kehilangan atau salah catat |
| Pelepasan ekspor (`export.item_released`) | Ekspor ulang harus jarang dan beralasan |
| Override struktur produk | Seharusnya sangat jarang |
| Admin atau Head membuka saldo sistem saat stock count `COUNTING` | Menjaga integritas blind count |
| Unduhan ekspor di luar jam kerja | Pemantauan akses sensitif |
| Dokumen Verified lama belum Exported | Stok BigSeller tertinggal |

Peringatan ditujukan kepada Head gudang terkait. Ambang tiap pola ditetapkan
saat implementasi laporan.

---

## 10. Retensi

| Data | Retensi usulan |
|---|---|
| `audit_logs` | Disimpan penuh minimal **5 tahun**, lalu diarsipkan, tidak dihapus |
| `inventory_transactions` | Permanen |
| Berkas lampiran | Selama dokumen terkait ada; ikuti kebijakan penyimpanan perusahaan |
| Berkas ekspor | Minimal selama periode audit yang sama |
| Backup | Harian, dengan salinan di luar server |

Untuk volume besar, `audit_logs` dipartisi per bulan agar kueri tetap cepat dan
arsip mudah dibuat. Angka retensi di atas adalah usulan dan perlu disesuaikan
dengan kebijakan perusahaan dan ketentuan yang berlaku.

---

## 11. Kebutuhan Skema (migration berikutnya)

| Kebutuhan | Keterangan |
|---|---|
| Kolom `reason` | Alasan terstruktur, bukan di dalam JSON |
| Kolom `shift_id`, `shift_date` | Label shift saat aksi (bagian 8) |
| Kolom `request_id` | ID korelasi permintaan agar beberapa baris dari satu aksi dapat dikelompokkan |
| Kolom `actor_role` | Role pelaku saat aksi (role bisa berubah kemudian) |
| Kolom `outcome` | Berhasil atau ditolak (untuk `security.*`) |
| Indeks | `(entity_type, entity_id, created_at)`, `(user_id, created_at)`, `(action, created_at)`, selain indeks gudang yang sudah ada |
| Partisi | Per bulan pada `created_at` |
| Rantai hash (opsional) | `prev_hash`, `row_hash` untuk deteksi manipulasi |
| Tabel kode aksi | Referensi `audit_actions` untuk menjaga daftar kode tetap konsisten |
| `attachments` | Saat ini punya `uploaded_by` dan `created_at` tetapi tidak ada catatan penghapusan; penghapusan harus lewat audit |
| Permission | `audit.export` belum ada di seed permission |

`audit_logs.user_id` sudah memiliki FK ke `users` dengan `ON DELETE RESTRICT`,
sehingga pengguna yang pernah mencatat audit tidak bisa dihapus. Pengguna
dinonaktifkan, bukan dihapus, agar riwayat tetap terbaca.

---

## 12. Keputusan Terbuka

1. **System Admin boleh `audit.view`?** Berguna untuk troubleshooting, tetapi
   System Admin sengaja tidak terlibat transaksi.
2. **Rantai hash:** apakah deteksi manipulasi di tingkat baris diperlukan, atau
   cukup dengan REVOKE, pembatasan superuser, dan backup luar server?
3. **Retensi:** angka final (usulan 5 tahun) sesuai kebijakan perusahaan.
4. **Apakah pengguna biasa boleh melihat riwayat aktivitasnya sendiri.**
5. **Pencatatan akses baca:** apakah melihat halaman inventori atau laporan
   perlu dicatat, atau cukup aksi sensitif yang disebut di bagian 3.
6. **Peringatan otomatis:** lewat apa (dalam aplikasi saja, atau juga email /
   pesan), dan siapa penerima cadangan bila Head tidak ada.
