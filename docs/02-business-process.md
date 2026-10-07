# 02 - Business Process

Dokumen ini menjelaskan alur kerja harian di gudang dari sisi bisnis: siapa
melakukan apa, kapan, dan kontrol apa yang berlaku. Aturan teknis dan angka
detail ada di dokumen 03 sampai 08.

Istilah status dokumen:

| Istilah di dokumen | Status di database | Arti |
|---|---|---|
| Draft | `DRAFT` | Sedang diisi pembuat, belum berpengaruh apa pun |
| Submitted | `PENDING` | Dikirim, menunggu verifikasi |
| Verified | `VERIFIED` | Sah, stok berubah (lihat bagian 2) |
| Exported | `EXPORTED` | Sudah masuk file impor BigSeller, terkunci |
| Rejected | `REJECTED` | Ditolak verifikator dengan alasan |
| Cancelled | `CANCELLED` | Dibatalkan dengan alasan |

---

## 1. Gambaran Seluruh Proses

```
 Supplier ---> [Penerimaan]  Checker input -> Admin/Head verifikasi --+
                                                                       |
 Produksi <--- [Issue]       Checker input -> Admin verifikasi -------+--> LEDGER / SALDO
                                                                       |      (per gudang,
 Rak fisik --> [Stock count] Staff hitung -> Admin verifikasi          |       lokasi, batch)
                              -> Head approve -> Adjustment ----------+
                                                                       |
                                                                       v
                                           Head: Ekspor file impor ke BigSeller
                                           (PO untuk penerimaan, pengurangan stok
                                            untuk issue dan selisih minus)
```

Semua langkah dicatat di audit log (lihat `07-audit-rules.md`).

---

## 2. Kapan Stok Berubah

Stok di aplikasi berubah **saat dokumen diverifikasi** (receiving dan issue)
atau **saat adjustment disetujui** (hasil stock count). Dokumen Draft,
Submitted, Rejected, dan Cancelled tidak mengubah saldo.

Agar dua Checker tidak mengeluarkan stok yang sama, saldo yang **tersedia** untuk
issue baru adalah saldo fisik dikurangi issue yang sudah Submitted tetapi belum
Verified.

> Posting saat Verified adalah rekomendasi; alternatifnya posting saat
> Submitted. Keputusan ini masih terbuka (`05-inventory-rules.md` bagian 11).

---

## 3. Persiapan: Master Data

**Pelaku:** Head (`master.manage`), System Admin (user, role, gudang).

| Langkah | Pelaku | Keterangan |
|---|---|---|
| 1. Buat gudang | System Admin | Kode dan nama gudang |
| 2. Buat user dan tetapkan role per gudang | System Admin | Satu user, satu role aktif per gudang |
| 3. Definisikan shift dan jadwal petugas | Head | Rentang tanggal per gudang |
| 4. Buat lokasi rak | Head | Kode lokasi unik per gudang |
| 5. Daftarkan satuan dan nama satuan BigSeller | Head | Nama harus persis sama dengan BigSeller |
| 6. Buat produk | Head | Satuan dasar, satuan turunan dan faktor, presisi, flag batch/ED/serial |
| 7. Petakan SKU ke BigSeller | Head | `bigseller_sku` dan status terdaftar |
| 8. Daftarkan supplier | Head | Nama sama dengan pemasok di BigSeller |

Kontrol: struktur produk (flag pelacakan, satuan dasar, presisi, faktor
konversi) **terkunci setelah ada riwayat transaksi**. Perubahan memerlukan
prosedur override yang disetujui Head dan tercatat di audit.

---

## 4. Proses Penerimaan Barang dari Supplier

**Pelaku:** Checker (input), Admin atau Head (verifikasi).
**Hasil:** stok bertambah; dokumen siap diekspor sebagai **pesanan pembelian**.

| # | Langkah | Pelaku |
|---|---|---|
| 1 | Barang tiba. Checker membuat dokumen penerimaan: pilih supplier, isi nomor surat jalan dan tanggal | Checker |
| 2 | Per item: pilih SKU, **kuantitas menurut surat jalan** dan **kuantitas aktual hasil hitung**, satuan (boleh multi satuan), lokasi rak tujuan | Checker |
| 3 | Untuk produk melacak batch/ED: isi nomor batch dan tanggal. Untuk produk bernomor seri: pindai atau ketik semua nomor seri | Checker |
| 4 | Unggah foto bukti (surat jalan, kondisi barang) | Checker |
| 5 | Kirim dokumen (Submitted) | Checker |
| 6 | Admin atau Head memeriksa: kesesuaian surat jalan dan aktual, foto, batch/ED, nomor seri. Selisih antara surat jalan dan aktual dicatat | Admin / Head |
| 7 | Verifikasi (Verified) atau tolak dengan alasan. **Verifier tidak boleh pembuat dokumen** | Admin / Head |
| 8 | Saldo bertambah per lokasi dan batch | Sistem |
| 9 | Dokumen masuk antrean ekspor PO (bagian 9) | Head |

Kontrol:

- Produk pelacak batch tidak bisa disimpan tanpa batch; produk non-batch tidak
  boleh memakai batch.
- Jumlah nomor seri harus sama dengan kuantitas sebelum dokumen bisa Verified.
- Kuantitas di BigSeller memakai **kuantitas aktual**, bukan surat jalan.
- Tanggal kedaluwarsa yang sudah lewat saat penerimaan memerlukan alasan.
- Kain dan benang: Checker memasukkan **total panjang atau berat aktual**
  seluruh kiriman; jumlah roll atau cone hanya catatan.

Pengecualian:

| Situasi | Penanganan |
|---|---|
| Aktual berbeda dari surat jalan | Catat kedua angka; stok mengikuti aktual; selisih terlihat di laporan |
| Barang ditolak karena rusak | Tidak diterima (tidak masuk item) atau item dengan kuantitas aktual 0 dan catatan |
| SKU belum ada di master | Checker tidak bisa menambah; Head menambahkan produk dulu |
| Salah input setelah Submitted | Verifier menolak; Checker membuat dokumen baru (lihat bagian 10) |

---

## 5. Proses Pengeluaran Material (Issue)

**Pelaku:** Checker (input), Admin (verifikasi).
**Hasil:** stok berkurang; dokumen siap diekspor sebagai **pengurangan stok**.

| # | Langkah | Pelaku |
|---|---|---|
| 1 | Material diminta produksi. Checker membuat dokumen issue dan memilih **alasan/tujuan** (Produksi, Rusak, Sampel, Lainnya) | Checker |
| 2 | Per item: cari SKU, lihat **saldo tersedia** lewat pencarian (tanpa halaman inventori penuh), isi kuantitas dan satuan, pilih lokasi asal | Checker |
| 3 | Untuk produk batch: pilih batch yang diambil. **Checker bebas memilih**; sistem menyarankan batch kedaluwarsa terdekat | Checker |
| 4 | Untuk produk bernomor seri: pilih atau pindai nomor seri yang keluar | Checker |
| 5 | Unggah foto bila perlu dan kirim (Submitted) | Checker |
| 6 | Admin memeriksa: kuantitas, batch yang dipilih, alasan, nomor seri | Admin |
| 7 | Verifikasi atau tolak dengan alasan. **Verifier tidak boleh pembuat** | Admin |
| 8 | Saldo berkurang. Issue yang melebihi saldo tidak bisa diverifikasi | Sistem |
| 9 | Dokumen masuk antrean ekspor pengurangan stok | Head |

Kontrol:

- Saldo tidak boleh minus pada lokasi atau batch mana pun.
- Batch kedaluwarsa dapat dipilih hanya dengan konfirmasi tambahan dan alasan.
- Pilihan batch yang tidak mengikuti urutan kedaluwarsa tercatat dan muncul di
  laporan, bukan sebagai pelanggaran otomatis.
- Alasan issue hanya ada di aplikasi (template BigSeller tidak punya kolomnya).

---

## 6. Proses Pindah Lokasi

Perpindahan barang antar rak dalam gudang yang sama dicatat sebagai dua mutasi
(keluar dan masuk). Total stok per SKU tidak berubah sehingga **tidak diekspor**
ke BigSeller.

> Permission untuk pindah lokasi (siapa yang membuat dan siapa yang
> memverifikasi) belum didefinisikan di `03-role-permission.md`.
> Usulan: dibuat Checker, diverifikasi Admin. Perlu diputuskan.

Perpindahan antar **gudang** tidak tercakup pada versi ini.

---

## 7. Proses Stock Count dan Adjustment

**Pelaku:** Staff, Admin, Head. Detail penuh di `06-stock-count-rules.md`.

| # | Langkah | Pelaku |
|---|---|---|
| 1 | Staff membuat dokumen untuk satu lokasi. Saat dimulai, saldo sistem di-snapshot, disembunyikan dari Staff, dan lokasi dibekukan | Staff |
| 2 | Staff menghitung fisik: per batch, per nomor seri untuk produk bernomor seri, tanpa melihat saldo sistem | Staff |
| 3 | Kirim hasil (Pending Verification) | Staff |
| 4 | Admin melihat selisih, meminta hitung ulang untuk item tertentu bila perlu, mengisi alasan selisih | Admin |
| 5 | Verifikasi hasil (Verified). **Admin tidak boleh pembuat dokumen** | Admin |
| 6 | Head menyetujui (Approved). **Head tidak boleh pembuat atau penghitung** | Head |
| 7 | Sistem membuat adjustment per item selisih | Sistem |
| 8 | Head menyetujui atau menolak adjustment. Yang disetujui mengubah saldo lewat ledger | Head |
| 9 | Adjustment minus masuk antrean ekspor pengurangan stok. Adjustment plus **belum punya jalur BigSeller** | Head |

---

## 8. Proses Shift

Shift hanya pencatatan:

1. Head mendefinisikan shift per gudang (nama, jam mulai, jam selesai).
2. Head menetapkan jadwal petugas dengan rentang tanggal.
3. Setiap transaksi diberi label shift dari **waktu server saat dibuat**; user
   tidak memilih shift sendiri.
4. Transaksi di luar jam shift tidak ditolak, hanya ditandai "Di luar shift".
5. User yang tidak terjadwal tetap bisa bekerja; laporan menampilkan
   perbedaan jadwal dan aktual.

---

## 9. Proses Ekspor ke BigSeller

**Pelaku:** Head. Detail penuh di `08-bigseller-export.md`.

| # | Langkah |
|---|---|
| 1 | Head memilih gudang dan jenis ekspor (PO atau pengurangan stok) |
| 2 | Sistem menampilkan dokumen yang siap diekspor (Verified atau Approved dan belum Exported) |
| 3 | Pratinjau dan pemeriksaan: SKU terpetakan, satuan, kuantitas, pemasok. Error memblokir |
| 4 | Dokumen dikunci ke job, file dibuat dan disimpan beserta checksum |
| 5 | Head mengunduh file dan mengimpornya di BigSeller (gudang dipilih saat impor) |
| 6 | Impor berhasil: Head menandai job selesai, dokumen menjadi Exported dan terkunci |
| 7 | Impor gagal: Head menandai gagal, keterkaitan dokumen dilepas, perbaiki, buat job baru |

Kebijakan operasional yang disarankan:

- **Stok bahan hanya diubah lewat aplikasi.** Penyesuaian langsung di BigSeller
  tidak akan terlihat di aplikasi dan akan menimbulkan selisih.
- Ekspor dilakukan rutin (misalnya akhir shift atau akhir hari) agar BigSeller
  tidak tertinggal jauh.
- Dokumen yang tertunda ekspor melewati batas hari tertentu memunculkan
  peringatan ke Head.

---

## 10. Pembatalan, Penolakan, dan Koreksi

| Situasi | Penanganan | Siapa |
|---|---|---|
| Draft salah | Dibatalkan atau dihapus oleh pembuat | Pembuat |
| Submitted salah | Ditolak verifikator dengan alasan, atau dibatalkan dengan alasan | Admin / Head |
| Verified tetapi ternyata salah, belum diekspor | Dibatalkan dengan alasan; ledger dibalik lewat mutasi pembalik, bukan dihapus | Head |
| Sudah Exported tetapi ternyata salah | Dokumen terkunci. Koreksi lewat dokumen baru (issue atau adjustment) dan, jika perlu, penyesuaian di BigSeller oleh Head | Head |
| Selisih fisik dan sistem | Stock count dan adjustment, bukan edit saldo | Staff, Admin, Head |

Aturan umum:

1. Tidak ada penghapusan data yang sudah memengaruhi stok.
2. Setiap pembatalan, penolakan, dan pembalikan **wajib beralasan**.
3. Dokumen yang ditolak dikoreksi dengan **membuat dokumen baru** (fitur "salin
   ke dokumen baru" direkomendasikan). Alternatif mengembalikan ke Draft untuk
   diperbaiki belum diputuskan.

---

## 11. Rutinitas Harian

| Waktu | Pelaku | Kegiatan |
|---|---|---|
| Awal shift | Semua | Login dengan akun pribadi; Head memeriksa jadwal |
| Sepanjang shift | Checker | Input penerimaan dan issue segera saat kejadian, jangan menumpuk |
| Sepanjang shift | Admin | Verifikasi dokumen Submitted; tolak dengan alasan jika ada kejanggalan |
| Terjadwal | Staff | Stock count lokasi yang ditugaskan |
| Akhir shift atau hari | Head | Tinjau dokumen belum diverifikasi, jalankan ekspor, tinjau adjustment menunggu |
| Berkala | Head | Tinjau laporan: selisih, issue non-FEFO, transaksi di luar shift, dokumen tertunda ekspor |

---

## 12. Ringkasan Pemisahan Tugas

| Aktivitas | Checker | Staff | Admin | Head |
|---|:-:|:-:|:-:|:-:|
| Input penerimaan dan issue | ✓ | | | |
| Verifikasi penerimaan | | | ✓ | ✓ |
| Verifikasi issue | | | ✓ | |
| Hitung stock count | | ✓ | | |
| Verifikasi stock count | | | ✓ | |
| Setujui stock count dan adjustment | | | | ✓ |
| Ekspor ke BigSeller | | | | ✓ |
| Kelola master data dan shift | | | | ✓ |

Aturan yang selalu berlaku: orang yang membuat dokumen tidak boleh
memverifikasi atau menyetujui dokumen yang sama.

---

## 13. Keputusan Terbuka

1. Kapan ledger diposting (Verified atau Submitted).
2. Permission dan alur pindah lokasi.
3. Dokumen ditolak: final dan diganti dokumen baru, atau dikembalikan ke Draft.
4. Jalur BigSeller untuk adjustment plus.
5. Batas hari sebelum dokumen tertunda ekspor memicu peringatan.
6. Apakah perpindahan antar gudang diperlukan.
