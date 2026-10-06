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

Jadwal petugas adalah **komponen inti** sistem shift. Jadwal mencatat siapa
yang bertugas pada shift tertentu di tanggal tertentu.

| Field | Keterangan |
|---|---|
| `id` | Primary key |
| `warehouse_id` | Gudang |
| `shift_id` | Shift yang dijadwalkan |
| `user_id` | Petugas |
| `date` | Tanggal shift (`shift_date`, tanggal mulai shift) |
| `role_on_shift` | Peran saat bertugas (Checker, Staff, Admin, Head), diambil dari role user di gudang tersebut |
| `created_by` | Yang menyusun jadwal |

Aturan:

1. **Satu user hanya boleh dijadwalkan di satu shift pada tanggal yang sama**
   dalam satu gudang. Jadwal di gudang berbeda boleh, selama jam shift-nya tidak
   bertabrakan.
2. **User hanya bisa dijadwalkan di gudang tempat ia punya role** (lihat
   `user_warehouse_roles` di `03-role-permission.md`).
3. **Jadwal tidak membatasi akses.** User yang tidak terjadwal tetap bisa
   membuat transaksi. Jadwal tidak menentukan siapa yang boleh bekerja.
4. **Jadwal yang sudah lewat tidak boleh diubah diam-diam.** Perubahan pada
   tanggal yang sudah berlalu wajib mencatat alasan di audit log, supaya
   perbandingan jadwal dan aktual tetap dapat dipercaya.

Fitur penyusunan jadwal yang direkomendasikan:

- Tampilan kalender mingguan per gudang (shift x hari x petugas).
- **Salin jadwal minggu lalu** untuk mengisi minggu berikutnya dengan cepat.
- Peringatan (bukan blokir) jika suatu shift tidak punya Checker atau Admin
  yang dijadwalkan.

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
- **Jadwal vs aktual:** membandingkan petugas terjadwal (`shift_assignments`)
  dengan pembuat transaksi aktual pada shift yang sama. Hasilnya informasi,
  bukan pelanggaran.
- Transaksi yang dibuat oleh user yang **tidak terjadwal** pada shift itu.
- Petugas terjadwal yang **tidak membuat aktivitas apa pun** pada shift-nya.
- Rekap aktivitas per petugas per shift (jumlah penerimaan, issue, stock count).
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

1. **Siapa yang menyusun jadwal petugas:** Head saja, atau Admin juga?
2. **Apakah satu user boleh dijadwalkan dua shift berurutan** pada hari yang
   sama (lembur), atau harus dicatat sebagai pengecualian?
3. **Zona waktu:** apakah semua gudang berada di zona waktu yang sama?
4. **Perubahan definisi shift** hanya berlaku untuk transaksi baru
   (direkomendasikan), tanpa mengubah data lama.

Keputusan yang sudah final: shift murni pencatatan, dan jadwal petugas
**diperlukan**.
