# 04 - Shift System

Shift pada aplikasi ini **murni pencatatan**. Shift tidak membatasi login,
tidak memblokir aksi, dan tidak mengubah alur approval. Fungsinya hanya
memberi label "transaksi ini terjadi pada shift apa" untuk keperluan
audit dan laporan.

---

## 1. Prinsip

1. **Tidak ada pembatasan akses berbasis shift.** User dapat login dan bekerja
   kapan saja sesuai role-nya.
2. **Shift dicatat otomatis**, bukan dipilih manual oleh user, agar tidak bisa
   salah input atau dimanipulasi.
3. **Shift pada transaksi bersifat snapshot.** Setelah tersimpan, `shift_id`
   tidak berubah meskipun definisi shift diubah kemudian.
4. **Shift berlaku per gudang.** Setiap gudang boleh punya definisi jam yang
   berbeda.
5. **Tidak ada serah terima shift (handover)** dan tidak ada kewajiban stock
   count di akhir shift.

---

## 2. Data

### 2.1 Definisi shift (`shifts`)

| Field | Keterangan |
|---|---|
| `id` | Primary key |
| `warehouse_id` | Gudang pemilik shift |
| `name` | Contoh: Shift 1, Shift 2, Malam |
| `start_time` | Jam mulai (contoh 07:00) |
| `end_time` | Jam selesai (contoh 15:00) |
| `is_active` | Shift nonaktif tidak dipakai untuk transaksi baru |

Shift boleh **melewati tengah malam** (contoh 22:00 sampai 06:00). Untuk shift
seperti ini, `shift_date` mengikuti **tanggal mulai shift**, bukan tanggal
kalender saat transaksi terjadi.

### 2.2 Jadwal petugas (`shift_assignments`)

| Field | Keterangan |
|---|---|
| `id` | Primary key |
| `shift_id` | Shift yang dijadwalkan |
| `user_id` | Petugas |
| `date` | Tanggal shift |

Jadwal hanya untuk pencatatan siapa yang seharusnya bertugas. Jadwal **tidak**
menentukan siapa yang boleh membuat transaksi.

### 2.3 Label pada transaksi

Tabel berikut memiliki kolom `shift_id` dan `shift_date`:

- `receiving`, `issue`, `stock_count`, `adjustment`
- `export_batches`
- `audit_logs`

---

## 3. Cara Shift Ditentukan

Saat transaksi dibuat (status Draft pertama kali disimpan), backend:

1. Mengambil waktu server saat itu dan gudang transaksi.
2. Mencari shift aktif pada gudang tersebut yang rentang jamnya mencakup waktu
   itu (termasuk shift lintas tengah malam).
3. Menyimpan `shift_id` dan `shift_date` pada dokumen.

Perubahan status berikutnya (Submitted, Verified, Approved, Exported) **mencatat
shift masing-masing** di audit log. Jadi satu dokumen bisa dibuat pada Shift 1
dan diverifikasi pada Shift 2, dan keduanya terlihat.

**Waktu memakai waktu server** (zona waktu gudang), bukan jam perangkat user.

### Jika tidak ada shift yang cocok

Transaksi **tidak ditolak**. `shift_id` diisi `NULL` dan ditandai
"Di luar shift" pada laporan. Ini mencegah pekerjaan terhenti hanya karena
jadwal shift belum lengkap.

---

## 4. Pemakaian di Laporan

- Rekap penerimaan dan issue per shift per hari.
- Daftar transaksi "Di luar shift".
- Perbandingan petugas terjadwal (`shift_assignments`) dengan pembuat
  transaksi aktual, sebagai informasi, bukan pelanggaran.
- Filter shift pada tampilan audit log.

---

## 5. Permission

| Permission | Head | System Admin |
|---|:-:|:-:|
| `shift.manage` (definisi shift dan jadwal petugas) | ✓ | |
| `shift.view` | semua role gudang | |

> Catatan: `shift.manage` perlu ditambahkan ke matriks di
> `03-role-permission.md` (bagian 2.4) sebagai hak Head.

---

## 6. Keputusan yang Masih Terbuka

1. **Siapa yang mengisi jadwal petugas:** Head saja, atau Admin juga?
2. **Apakah jadwal petugas benar-benar diperlukan**, atau cukup mencatat shift
   dari jam transaksi saja? (Bisa ditunda ke versi berikutnya.)
3. **Zona waktu:** apakah semua gudang berada di zona waktu yang sama?
4. **Perubahan definisi shift** hanya berlaku untuk transaksi baru
   (direkomendasikan), tanpa mengubah data lama.
