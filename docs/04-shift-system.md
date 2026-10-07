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

### 2.2 Jadwal petugas (`user_shifts`)

Jadwal petugas adalah **komponen inti** sistem shift. Jadwal memakai
**rentang tanggal** (`effective_from` sampai `effective_to`), bukan satu baris
per hari. Penugasan berlaku terus sampai diakhiri atau diganti.

| Field | Keterangan |
|---|---|
| `id` | Primary key |
| `user_id` | Petugas |
| `shift_id` | Shift yang dijadwalkan |
| `warehouse_id` | Gudang. Harus sama dengan gudang milik `shift_id` (dijaga FK komposit) |
| `effective_from` | Tanggal mulai berlaku |
| `effective_to` | Tanggal terakhir berlaku. `NULL` = berlaku seterusnya |

Aturan (semua ditegakkan di database, lihat `002_warehouse_batch_export_integrity.sql`):

1. **Satu user hanya satu shift pada rentang yang sama per gudang.** Rentang
   yang tumpang tindih ditolak (exclusion constraint).
2. **User hanya bisa dijadwalkan di gudang tempat ia punya role** pada periode
   tersebut (lihat `user_roles` di `03-role-permission.md`).
3. **Jadwal tidak membatasi akses.** User yang tidak terjadwal tetap bisa
   membuat transaksi. Jadwal tidak menentukan siapa yang boleh bekerja.
4. **Pindah shift = akhiri rentang lama, buat rentang baru.** Contoh: shift 1
   sampai 31 Okt, shift 2 mulai 1 Nov. Rentang tidak boleh dihapus untuk
   menyembunyikan riwayat; perubahan pada tanggal yang sudah lewat wajib
   dicatat di audit log beserta alasan (ditegakkan di aplikasi).
5. Jadwal di gudang berbeda boleh dimiliki satu user, masing-masing dengan
   rentangnya sendiri.

Fitur penyusunan jadwal yang direkomendasikan:

- Tampilan kalender per gudang (shift x tanggal x petugas) yang dibaca dari
  rentang tanggal.
- Peringatan (bukan blokir) jika suatu shift tidak punya Checker atau Admin
  yang dijadwalkan pada tanggal tertentu.

### 2.3 Label pada transaksi

Tabel berikut akan memiliki kolom `shift_id` dan `shift_date` (belum ada di
migration 002; direncanakan di migration berikutnya):

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
2. **Lembur dan tukar shift satu hari:** dengan rentang tanggal, satu user tidak
   bisa punya dua shift pada tanggal yang sama. Usulan: pengecualian satu hari
   dicatat dengan memecah rentang lama (rentang 1 hari untuk shift pengganti),
   atau ditambahkan tabel `shift_overrides` pada migration berikutnya.
3. **Zona waktu:** apakah semua gudang berada di zona waktu yang sama?
4. **Perubahan definisi shift** hanya berlaku untuk transaksi baru
   (direkomendasikan), tanpa mengubah data lama.

Keputusan yang sudah final: shift murni pencatatan, dan jadwal petugas
**diperlukan**.
