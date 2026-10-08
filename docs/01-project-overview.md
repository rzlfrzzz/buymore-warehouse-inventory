> CURRENT REQUIREMENTS: The two-role Admin/User inspection workspace supersedes conflicting legacy role, blind-count, segregation-of-duties and entry-menu requirements in this historical document. See [current workflow and reviewable assumptions](two-role-workspace.md). Immutable posted history and audit protections still apply.

# 01 - Project Overview

Dokumen ini merangkum tujuan, ruang lingkup, konsep utama, dan keputusan yang
sudah final untuk **Buymore Warehouse Inventory**. Detail ada di dokumen 02
sampai 08 dan di folder `database/`.

---

## 1. Latar Belakang

Gudang Buymore menyimpan **material produksi** (kain, benang, aksesoris,
material penunjang seperti pelumas mesin). Stok dicatat di **BigSeller**
(ERP e-commerce). Saat barang datang dari supplier atau material dipakai untuk
produksi, data harus dimasukkan ke BigSeller, dan proses itu rawan salah,
sulit diaudit, dan tidak membedakan siapa yang mencatat, memeriksa, dan
menyetujui.

BigSeller sendiri hanya menyediakan **template impor** (Excel) untuk memasukkan
pesanan pembelian dan pengurangan stok secara massal. Template itu tidak
membawa lokasi rak, batch, alasan, atau jejak persetujuan.

## 2. Tujuan

Membangun aplikasi **kontrol gudang** yang berada di depan BigSeller:

1. Petugas gudang mencatat barang masuk dan keluar di aplikasi (utamanya lewat
   HP), bukan langsung di BigSeller.
2. Setiap transaksi melewati pemeriksaan bertingkat sebelum memengaruhi stok.
3. Aplikasi menjadi **sumber kebenaran stok** (per gudang, lokasi rak, dan batch).
4. Hasilnya diekspor ke BigSeller dalam format template impor resmi, tanpa input
   ulang manual.
5. Seluruh perubahan dapat diaudit: siapa, kapan, di gudang dan shift mana.

## 3. Bukan Tujuan (Non-Goals)

| Tidak dilakukan | Alasan |
|---|---|
| Menggantikan BigSeller untuk penjualan, pesanan marketplace, atau SKU toko | Tetap di BigSeller |
| Membaca balik stok dari BigSeller | Aliran data satu arah |
| Mengelola produksi (BOM, work order) | Di luar cakupan; pengeluaran material dicatat sebagai issue |
| Mencatat harga, biaya, dan nilai persediaan | Belum diputuskan (lihat `08-bigseller-export.md` bagian 10) |
| Pengurangan stok untuk barang jadi yang dijual | Pengurangan stok di sini khusus material (SKU "mati") |

## 4. Pengguna dan Peran

| Role | Cakupan | Peran singkat |
|---|---|---|
| **Checker** | Per gudang | Mencatat barang datang dari supplier dan barang keluar |
| **Staff** | Per gudang | Menghitung stok fisik (stock count, tanpa melihat saldo sistem) |
| **Admin** | Per gudang | Memverifikasi penerimaan, issue, dan hasil stock count |
| **Head** | Per gudang | Menyetujui, mengekspor ke BigSeller, mengelola master data dan shift |
| **System Admin** | Global | Mengelola user, role, dan gudang; tidak terlibat transaksi |

Role Supervisor **dihapus** dari desain. Satu user dapat memiliki role berbeda
di gudang berbeda. Detail: `03-role-permission.md`.

Perangkat: Checker dan Staff terutama memakai **HP** (`MobileLayout`).
Admin, Head, dan System Admin terutama memakai **desktop** (`DesktopLayout`).

## 5. Ruang Lingkup Fungsional

1. **Receiving:** penerimaan dari supplier, foto bukti, batch dan kedaluwarsa,
   nomor seri untuk produk tertentu.
2. **Issue:** pengeluaran material untuk produksi dan keperluan lain, dengan
   alasan wajib dan pemilihan batch bebas.
3. **Inventory:** saldo per gudang, lokasi rak, dan batch; riwayat mutasi.
4. **Stock count dan adjustment:** hitung fisik buta, verifikasi, persetujuan,
   penyesuaian stok.
5. **Ekspor BigSeller:** file impor pesanan pembelian dan pengurangan stok.
6. **Shift dan jadwal petugas:** pencatatan saja, tidak membatasi akses.
7. **Laporan dan audit log.**
8. **Master data:** produk, satuan, lokasi, supplier, pemetaan SKU BigSeller.

## 6. Konsep Kunci

| Istilah | Arti |
|---|---|
| **Ledger** | Catatan mutasi stok yang hanya bisa ditambah (append-only). Saldo adalah hasil penjumlahannya |
| **Satuan dasar** | Satuan terkecil per produk (Cm, Gram, Ml, Pcs). Semua kuantitas tersimpan sebagai bilangan bulat dalam satuan ini |
| **Satuan turunan** | Satuan input yang lebih besar (Meter, Kg, Liter, Kotak, Dus) dengan faktor konversi tetap |
| **Batch / ED** | Nomor batch dan tanggal kedaluwarsa, hanya untuk produk yang melacaknya |
| **Serial** | Nomor seri unik per unit, hanya untuk produk yang melacaknya |
| **Lokasi rak** | Posisi fisik di gudang. Hanya ada di aplikasi, tidak diekspor |
| **Blind count** | Penghitung tidak melihat saldo sistem |
| **Export job** | Satu kali pembuatan file impor untuk satu gudang dan satu jenis ekspor |
| **SKU mati** | SKU material yang tidak dijual, hanya dipakai produksi |

## 7. Keputusan Final

| # | Keputusan | Dokumen |
|---|---|---|
| 1 | Aplikasi adalah sumber kebenaran stok; BigSeller hanya menerima ekspor satu arah | 05, 08 |
| 2 | Stok berbasis ledger append-only, saldo hanya berubah lewat ledger | 05, `002_*.sql` |
| 3 | Multi satuan: satuan dasar kecil dan bilangan bulat (Opsi A), konversi satu faktor per satuan | 05 |
| 4 | Kain dan benang dilacak sebagai total per SKU per lokasi, bukan per roll atau cone | 05 |
| 5 | Batch/ED dan serial hanya untuk produk tertentu (flag per produk) | 05 |
| 6 | Checker bebas memilih batch saat issue; sistem hanya menyarankan | 05 |
| 7 | Lokasi rak hanya di aplikasi dan tidak diekspor | 05, 08 |
| 8 | Beberapa gudang; role dan jadwal per gudang | 03, `002_*.sql` |
| 9 | Pemisahan tugas: verifier dan penyetuju tidak boleh sama dengan pembuat, ditegakkan di database | 03, `002_*.sql` |
| 10 | Hanya Head yang mengekspor; satu dokumen hanya terekspor sekali | 03, 08 |
| 11 | Shift murni pencatatan; jadwal petugas berupa rentang tanggal per gudang | 04 |
| 12 | Head mengelola master data; System Admin mengelola user dan gudang | 03 |
| 13 | Stock count blind, tiga tingkat (Staff, Admin, Head), lokasi dibekukan selama hitung | 06 |
| 14 | Dokumen berstatus `EXPORTED` terkunci; koreksi lewat dokumen baru | 03, 08 |

## 8. Keputusan Terbuka Terpenting

Daftar lengkap ada di bagian terakhir tiap dokumen. Yang paling memengaruhi
pembangunan:

1. **Kapan ledger diposting:** saat `Verified` (rekomendasi) atau `Submitted`.
2. **Jalur BigSeller untuk stok lebih** hasil stock count (template pengurangan
   stok tidak bisa menambah).
3. **Hasil uji impor BigSeller** (CSV, SKU baru, harga, nomor pembelian unik,
   format tanggal), lihat `08-bigseller-export.md` bagian 9.
4. **Penjadwalan stock count:** kebijakan harian kritis/pergerakan tinggi, sampling mingguan, bulanan penuh/parsial dan ad-hoc disepakati; kalender rinci menyusul (06).
5. **Ambang investigasi tambahan:** semua adjustment tetap membutuhkan Head; tidak ada auto-approval selisih kecil.
6. **Perlukah menyimpan harga** pada penerimaan.
7. **Teknologi aplikasi:** hanya PostgreSQL dan Docker yang sudah pasti (dari
   struktur folder dan migration); bahasa dan framework frontend/backend belum
   ditentukan.

## 9. Arsitektur Tingkat Tinggi

```
Browser/HP  ->  Frontend (desktop + mobile layout)
                    |
                    v
              Backend API (modul per domain)
                    |
         +----------+-----------+
         v                      v
   PostgreSQL            storage/ (foto bukti, file ekspor)
   (ledger, dokumen,
    audit, master)

Head mengunduh file ekspor  ->  mengimpor manual ke BigSeller
```

Pemetaan struktur folder ke domain (usulan penyesuaian dari kerangka awal):

| Domain | Folder backend | Catatan |
|---|---|---|
| Autentikasi, user, role | `auth`, `users`, `roles`, `permissions` | Role per gudang |
| Gudang dan master | `warehouses`, `locations`, `products`, `units`, `suppliers` | `warehouses`, `units`, `suppliers` perlu ditambahkan |
| Penerimaan dan issue | `receiving`, `issue` | `issue` sebaiknya dinamai `material-issue` |
| Batch dan serial | `batches`, `serials` | Perlu ditambahkan |
| Stok | `inventory` | Ledger dan saldo |
| Stock count | `stock-count`, `adjustment` | |
| Ekspor | `export` | Termasuk export job dan item |
| Shift | `shifts` | Definisi dan jadwal |
| Audit dan laporan | `audit-log`, `reports` | |

Folder `database/migrations` memuat `001_initial_schema.sql` dan
`002_warehouse_batch_export_integrity.sql`. Semua perubahan skema dilakukan lewat
migration baru, bukan dengan mengedit migration lama.

## 10. Tahapan Pembangunan yang Disarankan

| Fase | Isi | Prasyarat |
|---|---|---|
| 0 | Uji impor BigSeller dengan file kecil (daftar di `08`), putuskan keputusan terbuka nomor 1 sampai 3 | Akun BigSeller |
| 1 | Migration 003 (role, permission, seed), autentikasi, master data, gudang, shift | Fase 0 |
| 2 | Receiving + ledger + saldo + foto bukti | Fase 1 |
| 3 | Issue (batch, serial, alasan) | Fase 2 |
| 4 | Ekspor BigSeller (PO dan pengurangan stok) | Fase 2, 3 dan hasil uji |
| 5 | Stock count dan adjustment | Fase 2, 3 |
| 6 | Laporan, audit viewer, rekonsiliasi dengan BigSeller | Fase 2 sampai 5 |

Ekspor (fase 4) sengaja didahulukan sebelum stock count karena nilai bisnis
utamanya (menghapus input ulang ke BigSeller) ada di sana.

## 11. Risiko

| Risiko | Mitigasi |
|---|---|
| Asumsi format BigSeller salah (SKU, harga, tanggal, nomor serial) | Fase 0: uji dengan file kecil sebelum membangun ekspor |
| Stok aplikasi dan BigSeller berbeda (batch, adjustment plus, input manual di BigSeller) | Laporan rekonsiliasi; kebijakan bahwa stok bahan hanya diubah lewat aplikasi |
| Konversi satuan SKU lama di BigSeller tidak cocok dengan satuan dasar kecil | Rapikan SKU di BigSeller sebelum data awal diimpor |
| Pengguna menghindari prosedur (mencatat belakangan, menyalahgunakan akun bersama) | Audit log, label shift, akun pribadi per orang |
| Pembekuan lokasi saat stock count mengganggu operasi | Jadwalkan hitung per rak kecil di luar jam sibuk |
| Superuser database dapat menonaktifkan trigger | REVOKE hak pada role aplikasi, akses superuser dibatasi dan dicatat |

## 12. Peta Dokumen

| Dokumen | Isi | Status |
|---|---|---|
| `01-project-overview.md` | Dokumen ini | Draf |
| `02-business-process.md` | Alur proses bisnis | Draf |
| `03-role-permission.md` | Role, permission, pemisahan tugas | Perlu sinkron (lihat bagian 13) |
| `04-shift-system.md` | Shift dan jadwal petugas | Draf |
| `05-inventory-rules.md` | Ledger, satuan, batch, serial, lokasi | Draf |
| `06-stock-count-rules.md` | Stock count dan adjustment | Draf |
| `07-audit-rules.md` | Audit log | Draf |
| `08-bigseller-export.md` | Pemetaan ekspor dan daftar uji | Draf |
| `database/migrations/001_*.sql`, `002_*.sql` | Skema | 002 diuji di PostgreSQL 16 |
| `database/tests/002_behavior_test.sql` | Uji perilaku skema | Tersedia |

## 13. Ketidakselarasan yang Diketahui

Hal yang perlu dirapikan agar dokumen dan skema konsisten:

1. **`03-role-permission.md` memakai `bigseller.export` dan istilah "Submitted".**
   Skema memakai `export.purchase_order` dan `export.stock_reduction`, serta
   status `PENDING` untuk "Submitted". Seed permission di `001` juga masih
   berbeda dari matriks `03` dan belum memuat role Checker.
2. **Permission pindah lokasi** (perpindahan antar rak dalam gudang) belum
   didefinisikan di `03`, padahal `05` mengatur mutasinya.
3. **Makna `REJECTED`** pada receiving dan issue: dikembalikan untuk diperbaiki
   atau final (lihat `02-business-process.md` bagian 10).
4. **`shift_id` dan `shift_date`** pada dokumen belum ada di skema; baru
   direncanakan.
