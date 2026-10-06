# 03 - Role & Permission

Dokumen ini mendefinisikan role, permission, dan aturan pemisahan tugas
(segregation of duties) pada aplikasi Buymore Warehouse Inventory.

Prinsip utama: **Checker mencatat, Staff menghitung, Admin memverifikasi,
Head menyetujui dan mengekspor.** Satu-satunya pintu keluar data ke BigSeller
adalah Head.

---

## 1. Daftar Role

| Role | Tingkat | Tanggung jawab |
|---|---|---|
| **System Admin** | Global (semua gudang) | Mengelola user, role, dan gudang. Tidak terlibat transaksi gudang. |
| **Warehouse Head** | Per gudang | Menyetujui, mengekspor ke BigSeller, mengelola master data gudang. Pemegang akun BigSeller. |
| **Warehouse Admin** | Per gudang | Memverifikasi penerimaan, issue, dan stock count. Melihat inventori dan laporan. |
| **Warehouse Staff** | Per gudang | Melakukan stock count (blind count). |
| **Warehouse Checker** | Per gudang | Menginput barang datang dari supplier dan barang keluar (issue material). |

Role **Supervisor** dihapus dari desain.

### Scope per gudang

Satu user dapat memiliki role berbeda di gudang berbeda
(contoh: Head di Gudang A, Staff di Gudang B). Penetapan role disimpan di tabel
`user_warehouse_roles` (user x gudang x role). Pengecualian: **System Admin**
bersifat global dan tidak terikat gudang.

---

## 2. Matriks Permission

Keterangan: ✓ = diizinkan, kosong = tidak diizinkan.

### 2.1 Transaksi

| Permission | Checker | Staff | Admin | Head |
|---|:-:|:-:|:-:|:-:|
| `receiving.create` | ✓ | | | |
| `receiving.verify` | | | ✓ | ✓ |
| `issue.create` | ✓ | | | |
| `issue.verify` | | | ✓ | |
| `stock_count.create` | | ✓ | | |
| `stock_count.verify` | | | ✓ | |
| `stock_count.approve` | | | | ✓ |
| `adjustment.approve` | | | | ✓ |
| `attachment.upload` | ✓ | ✓ | ✓ | |

### 2.2 Tampilan dan laporan

| Permission | Checker | Staff | Admin | Head |
|---|:-:|:-:|:-:|:-:|
| `inventory.lookup` (cari saldo SKU saat input issue) | ✓ | | ✓ | ✓ |
| `inventory.view` (halaman inventori penuh) | | | ✓ | ✓ |
| `report.view` | | | ✓ | ✓ |
| `audit.view` | | | | ✓ |
| `master.view` (baca produk, satuan, lokasi, supplier) | ✓ | ✓ | ✓ | ✓ |
| `shift.view` (lihat jadwal dan shift) | ✓ | ✓ | ✓ | ✓ |

### 2.3 Ekspor BigSeller

| Permission | Checker | Staff | Admin | Head |
|---|:-:|:-:|:-:|:-:|
| `export.purchase_order` (impor_pesanan_pembelian) | | | | ✓ |
| `export.stock_reduction` (impor_daftar_pengurangan_stok) | | | | ✓ |

### 2.4 Master data dan administrasi

| Permission | Head | System Admin |
|---|:-:|:-:|
| `master.manage` (produk/SKU, satuan dan konversi, lokasi rak, supplier) | ✓ | |
| `shift.manage` (definisi shift dan jadwal petugas, lihat `04-shift-system.md`) | ✓ | |
| `user.manage` | | ✓ |
| `role.assign` | | ✓ |
| `warehouse.manage` | | ✓ |

> Catatan: System Admin tidak memiliki permission transaksi sama sekali.
> Hak lihat audit untuk System Admin (jika diperlukan untuk troubleshooting)
> belum diputuskan, lihat bagian 6.

---

## 3. Aturan Pemisahan Tugas (Wajib di Backend)

1. **Verifier tidak boleh sama dengan pembuat dokumen.** Berlaku untuk
   receiving, issue, dan stock count. Dicek di backend, bukan hanya disembunyikan
   di UI.
2. **Penyetuju stock count tidak boleh orang yang menghitung** (`approved_by`
   harus berbeda dari `counted_by`).
3. **Blind count:** Staff tidak melihat saldo sistem saat stock count. Role
   Staff tidak memiliki `inventory.view` maupun `inventory.lookup`.
4. **Checker hanya melihat saldo lewat pencarian** saat input issue, tanpa akses
   ke halaman inventori penuh.
5. **Hanya dokumen berstatus `Verified` (atau `Approved` untuk stock count)
   yang boleh diekspor.**
6. **Satu dokumen tidak boleh terekspor dua kali.** Setiap ekspor dicatat
   sebagai export batch (siapa, kapan, file, daftar dokumen). Ekspor ulang
   hanya lewat aksi eksplisit dan tercatat di audit log.
7. **Issue tidak boleh membuat saldo minus.** Selisih hanya boleh diselesaikan
   lewat adjustment yang di-approve Head.
8. **Setiap aksi sensitif masuk audit log:** siapa, kapan, gudang, shift,
   perangkat, nilai sebelum dan sesudah.

---

## 4. Alur Status Dokumen

```
Receiving / Issue
  Draft -> Submitted (Checker) -> Verified (Admin / Head) -> Exported (Head)

Stock Count
  Draft -> Counted (Staff) -> Verified (Admin) -> Approved (Head)
        -> Adjustment dibuat -> Adjustment Approved (Head) -> Exported (Head)

Pembatalan: dokumen dapat dibatalkan (Cancelled) sebelum Exported,
oleh pembuat (saat Draft) atau Admin/Head (setelah Submitted), dengan alasan wajib.
```

Dokumen yang sudah `Exported` bersifat terkunci. Koreksi dilakukan lewat
dokumen baru (adjustment), bukan dengan mengubah dokumen lama.

---

## 5. Implementasi

- Permission berbasis **matriks role x aksi x gudang**, bukan pengecekan role
  yang di-hardcode per halaman.
- Backend: middleware `requirePermission('receiving.verify', warehouseId)`
  pada setiap endpoint.
- Frontend: folder `permissions/` hanya menyembunyikan menu/tombol sesuai
  permission. Keamanan sebenarnya tetap di backend.
- Seed awal (`database/seeds/`): 5 role beserta permission pada matriks di atas.

---

## 6. Keputusan yang Masih Terbuka

1. **Ambang adjustment:** apakah `adjustment.approve` selalu wajib, atau selisih
   kecil (di bawah nilai/persentase tertentu) otomatis lolos setelah
   `stock_count.approve`?
2. **Verifikasi receiving oleh Head:** Head boleh `receiving.verify`. Apakah
   Head tetap harus berbeda dari pembuat dokumen? (Direkomendasikan: ya, sudah
   tercakup aturan 1.)
3. **Hak audit System Admin:** apakah System Admin boleh `audit.view` untuk
   troubleshooting?
4. **Role ganda dalam satu gudang:** apakah satu user boleh memiliki lebih dari
   satu role di gudang yang sama? (Direkomendasikan: tidak.)
5. **Cakupan `master.manage`:** apakah perubahan konversi satuan pada SKU yang
   sudah punya riwayat transaksi perlu dikunci atau butuh persetujuan khusus?
