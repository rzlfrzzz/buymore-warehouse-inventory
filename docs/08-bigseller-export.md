# 08 - BigSeller Export

Dokumen ini mendefinisikan bagaimana data di aplikasi diekspor ke BigSeller:
file apa, kolom apa, aturan pengelompokan, validasi, alur ekspor, dan hal-hal
yang **harus diuji di BigSeller** sebelum fitur ekspor dianggap selesai.

Sumber pemetaan adalah dua template yang diunggah ke project:

| Template | Sheet | Dipakai untuk |
|---|---|---|
| `impor_pesanan_pembelian_in.xlsx` | `SKU` (data), `Sheet1` (daftar pilihan dropdown) | Barang masuk dari supplier (`PURCHASE_ORDER`) |
| `impor_daftar_pengurangan_stok_in.xlsx` | `SKU` | Pengurangan stok material (`STOCK_REDUCTION`) |

> Penanda dalam dokumen ini: **[Terkonfirmasi]** = terbaca langsung dari file
> template. **[Uji]** = asumsi yang belum bisa dipastikan dari template dan harus
> diuji dengan file kecil di BigSeller (daftar lengkap di bagian 9).

---

## 1. Prinsip

1. **Satu arah.** Aplikasi adalah sumber kebenaran stok. Data hanya mengalir ke
   BigSeller lewat file impor. Aplikasi tidak membaca balik dari BigSeller.
2. **Hanya Head yang mengekspor** (`export.purchase_order`,
   `export.stock_reduction`). Head adalah pemegang akun BigSeller.
3. **Hanya dokumen yang sudah disetujui:** receiving dan issue berstatus
   `VERIFIED`, adjustment berstatus `APPROVED`.
4. **Satu dokumen hanya terekspor sekali.** Ditegakkan di database lewat
   `export_job_items` (migration 002). Ekspor ulang hanya lewat pelepasan
   terkontrol dengan alasan dan tercatat di audit log.
5. **Satu file per gudang.** Template tidak punya kolom gudang. Gudang tujuan
   dipilih saat impor di BigSeller **[Uji]**.
6. **Header template tidak boleh diubah.** Teks header (termasuk tanda `*` dan
   huruf besar-kecil) dipakai persis seperti di template.
7. **Data yang tidak ada di template tetap hanya di aplikasi** (lokasi rak,
   batch, alasan issue, foto bukti). Lihat bagian 8.

---

## 2. Format File

Kedua template berformat **`.xlsx`**, bukan CSV. Rencana awal menyebut keluaran
CSV, jadi aplikasi mendukung keduanya:

| Format | Cara membuat | Catatan |
|---|---|---|
| **XLSX (default)** | Isi dari file template asli (disimpan di repo) agar sheet, header, dan dropdown ikut | Aman, sama seperti yang diunduh dari BigSeller |
| **CSV (opsional)** | Hanya sheet `SKU`, UTF-8 dengan BOM, pemisah koma | Hanya dipakai jika BigSeller terbukti menerima CSV **[Uji]** |

Aturan tipe data sel:

- **Nomor SKU** selalu ditulis sebagai **teks** (contoh template memakai angka
  `12345` dan teks `abcde`; angka berawalan nol atau panjang akan rusak jika
  disimpan sebagai angka).
- **Jumlah** ditulis sebagai bilangan bulat (angka), tanpa pemisah ribuan.
- **Tanggal** ditulis `YYYY-MM-DD` sebagai teks **[Uji]**; format tanggal tidak
  terbaca dari template (format sel `General`).
- Salinan template asli disimpan di `backend/src/modules/export/templates/`
  dan tidak diedit.

Nama file:

```
PO_{KODE_GUDANG}_{YYYYMMDD-HHmm}_{NOMOR_JOB}.xlsx
SR_{KODE_GUDANG}_{YYYYMMDD-HHmm}_{NOMOR_JOB}.xlsx
```

File disimpan di `storage/exports/{kode_gudang}/{YYYY}/{MM}/`, lengkap dengan
checksum (SHA-256) dan jumlah baris, sehingga file yang sama dapat diunduh ulang
dan dibuktikan tidak berubah.

---

## 3. Template 1: Impor Pesanan Pembelian (51 kolom)

Sheet `SKU`, kolom A sampai AY **[Terkonfirmasi]**. Hanya kolom A, B, dan C yang
wajib. Kolom F punya dropdown mata uang, dan kolom metode pembagian biaya punya
dropdown `Price / Quantity / Volume / Weight`, keduanya dari `Sheet1`.

### 3.1 Kolom yang diisi aplikasi

| Kol | Header template | Sumber di aplikasi | Aturan |
|---|---|---|---|
| A | `*Nomor Pembelian Sementara (Wajib Diisi)` | `receivings.receiving_number` | Diulang pada setiap baris item dokumen yang sama. Harus unik di BigSeller **[Uji]** |
| B | `*Nomor SKU (Wajib Diisi)` | `bigseller_mappings.bigseller_sku` | Wajib terpetakan dan `is_registered = true`. Lihat bagian 5 |
| C | `*Jumlah Pembelian (Wajib Diisi)` | `receiving_items.actual_base_qty` | Bilangan bulat dalam **satuan dasar**. Kuantitas aktual, bukan `document_qty` **[Uji]** untuk asumsi satuan |
| D | `Tanggal Produksi` | `batches.production_date` | Kosong jika produk tidak melacak batch |
| E | `Tanggal Kedaluwarsa` | `batches.expiry_date` | Kosong jika produk tidak melacak ED |
| I | `Pemasok` | `suppliers.name` | Nama harus sama persis dengan pemasok di BigSeller **[Uji]** |
| M | `Catatan` | `receivings.document_number` + `receivings.notes` | Contoh: `SJ 0123 / catatan penerimaan`. Nomor surat jalan supplier membantu pencocokan |

### 3.2 Kolom yang dikosongkan secara default

Aplikasi tidak mencatat harga, ongkos kirim, atau biaya, jadi kolom berikut
kosong:

| Kol | Header | Alasan kosong |
|---|---|---|
| F | `Mata Uang Pembelian (Harap Pilih dari Opsi)` | Aplikasi tidak mencatat harga. Pilihan: USD, CNY, IDR, PHP, THB, SGD, VND, MYR, TWD |
| G | `Kurs` | Sama |
| H | `Harga Satuan` | Aplikasi tidak mencatat harga |
| J | `Metode Pengiriman` | Tidak dicatat saat penerimaan |
| K | `Nomor Resi` | Tidak dicatat saat penerimaan |
| L | `Perkiraan Waktu Tiba` | Barang sudah tiba |
| N, O | `Ongkos Kirim` + metode pembagian | Tidak dicatat |
| P, Q | `Biaya Lainnya` + metode | Tidak dicatat |
| R, S | `Biaya Pajak` + metode | Tidak dicatat |
| T, U | `Biaya Pengiriman Internasional` + metode | Tidak dicatat |
| V sampai AY | 10 grup `Nama / Jumlah / Metode Kustomisasi Biaya` 1 sampai 10 | Tidak dicatat |

Pengaruh kosongnya harga terhadap nilai persediaan dan biaya di BigSeller harus
dipastikan **[Uji]**. Jika BigSeller mewajibkan harga untuk modal persediaan,
aplikasi perlu menyimpan harga satuan di item penerimaan (keputusan di bagian 10).

### 3.3 Aturan pengelompokan baris

1. Satu baris = satu kombinasi **(receiving, SKU, batch)**. Tanggal produksi dan
   kedaluwarsa ada di tingkat baris, sehingga SKU yang sama dengan batch
   berbeda menjadi baris terpisah.
2. Item dengan SKU dan batch yang sama dalam satu receiving dijumlahkan.
3. Seluruh baris satu receiving memakai **Nomor Pembelian Sementara yang sama**.
4. **Satu receiving tidak boleh dipecah ke dua file.** Jika jumlah baris melebihi
   batas file (bagian 9), receiving yang melewati batas dipindahkan ke job
   berikutnya.
5. Urutan baris: nomor receiving, lalu SKU.

---

## 4. Template 2: Impor Daftar Pengurangan Stok (3 kolom)

Sheet `SKU`, kolom A sampai C **[Terkonfirmasi]**.

| Kol | Header template | Sumber di aplikasi | Aturan |
|---|---|---|---|
| A | `*Nomor SKU` | `bigseller_mappings.bigseller_sku` | Teks. Wajib terpetakan dan terdaftar |
| B | `*Jumlah Pengurangan Stok` | Jumlah `issue_items.base_qty` (issue `VERIFIED`) dan selisih minus (adjustment `APPROVED`) | Lihat format kuantitas di 4.2 |
| C | `Nomor Seri` | `serial_numbers.serial_no` | Hanya untuk produk `track_serial`. Format banyak serial **[Uji]** |

### 4.1 Aturan pengelompokan baris

1. **Satu baris per SKU per job** untuk produk tanpa serial. Kuantitas dari semua
   issue, lokasi, dan batch dijumlahkan, begitu juga adjustment minus.
2. **Issue dan adjustment minus boleh berada di file yang sama.** Template tidak
   punya kolom alasan sehingga keduanya tidak terbedakan di BigSeller.
3. **Produk `track_serial`:** satu baris per nomor seri dengan jumlah `1` dan
   nomor seri di kolom C (usulan, **[Uji]**).
4. Karena kuantitas dijumlahkan, aplikasi **menyimpan rincian tiap baris yang
   diekspor** (dokumen mana saja yang membentuk baris itu) pada
   `export_job_lines` (lihat bagian 11). Tanpa itu, selisih dengan BigSeller
   tidak bisa dilacak ke dokumen asal.
5. Jumlah total tidak boleh nol atau negatif. Jika issue dan adjustment pada SKU
   yang sama saling meniadakan, tidak ada baris untuk SKU itu.

### 4.2 Format kuantitas

Contoh di template menunjukkan dua bentuk **[Terkonfirmasi]**:

- Angka biasa: `100`
- Multi satuan, urut dari besar ke kecil: `4 Dus 3 Kotak 1 Pcs`

Aplikasi mendukung keduanya lewat pengaturan `export.quantity_format`:

| Nilai | Contoh (250 Cm kain) | Kapan dipakai |
|---|---|---|
| `BASE_ONLY` (**default**) | `250` | Selalu aman; tidak bergantung nama satuan di BigSeller |
| `MULTI_UNIT` | `2 Meter 50 Cm` | Hanya setelah terbukti konversi satuan SKU berlaku saat impor **[Uji]** |

`MULTI_UNIT` mensyaratkan `units.bigseller_uom_name` terisi persis seperti di
BigSeller untuk semua satuan yang dipakai. Jika ada yang kosong, ekspor ditolak
dengan pesan yang menyebut produk dan satuannya.

---

## 5. Pemetaan SKU

1. `products.internal_sku` adalah SKU di aplikasi. `bigseller_mappings.bigseller_sku`
   adalah SKU yang dikirim ke BigSeller. Keduanya boleh sama, tetapi file ekspor
   selalu memakai `bigseller_sku`.
2. `is_registered = true` berarti SKU sudah ada di BigSeller dan boleh diekspor.
3. SKU yang `is_registered = false` **memblokir ekspor** untuk dokumen yang
   memuatnya. Dokumen tersebut tidak dilewati diam-diam; Head melihat daftarnya.
4. Template impor SKU Merchant adalah template ketiga di BigSeller (menu
   Inventaris, Import & Export) dan **belum ada di project**. Jika PO import
   menolak SKU baru, SKU harus didaftarkan dulu. Template itu perlu diunggah agar
   ekspor `MERCHANT_SKU` bisa dipetakan **[Uji]**.
5. Perubahan `bigseller_sku` pada produk yang sudah pernah diekspor harus
   tercatat di audit log.

---

## 6. Alur Ekspor

```
Head memilih gudang + jenis ekspor
        |
        v
Daftar dokumen siap ekspor (VERIFIED / APPROVED, belum EXPORTED)
        |
        v
Pratinjau: baris, total per SKU, peringatan dan error validasi
        |  (error memblokir; peringatan tidak)
        v
Dokumen dimasukkan ke export_job_items  -> job PENDING
        |
        v
Generate file -> job PROCESSING -> file tersimpan + checksum
        |
        v
Head mengunduh file dan mengimpornya di BigSeller
        |
        +-- Impor berhasil -> Head tandai selesai -> job COMPLETED
        |                       -> dokumen menjadi EXPORTED dan terkunci
        |
        +-- Impor gagal    -> Head tandai gagal  -> job FAILED
                                -> keterkaitan dokumen dilepas otomatis
                                -> perbaiki, buat job baru
```

Poin penting:

1. **Dokumen "dikunci" ke job sejak masuk `export_job_items`**, sebelum Head
   selesai mengimpor. Dokumen itu tidak bisa dimasukkan ke job lain, sehingga
   tidak ada ekspor ganda saat file sedang diproses di BigSeller.
2. Status dokumen menjadi `EXPORTED` hanya ketika Head menandai job
   `COMPLETED`, yaitu setelah ia memastikan impor di BigSeller berhasil.
3. Jika impor gagal, pesan error dari BigSeller disimpan di
   `export_jobs.error_details` agar dapat dibaca ulang.
4. File dapat diunduh ulang selama job belum `FAILED`. Checksum ditampilkan.
5. **Ekspor ulang yang disengaja** (misalnya file hilang setelah `COMPLETED`)
   memakai `release_export_item(...)` dengan alasan wajib. Karena Nomor Pembelian
   Sementara mungkin harus unik di BigSeller, ekspor ulang PO memakai akhiran
   revisi, contoh `R-0123-R1` **[Uji]**.

---

## 7. Validasi Sebelum Ekspor

**Error (memblokir job):**

| Validasi | Berlaku untuk |
|---|---|
| Dokumen berstatus `VERIFIED` (receiving, issue) atau `APPROVED` (adjustment) | Semua |
| Dokumen belum punya keterkaitan ekspor aktif | Semua |
| Dokumen dan job berada di gudang yang sama | Semua |
| SKU terpetakan dan `is_registered = true` | Semua |
| Jumlah bilangan bulat dan lebih dari nol | Semua |
| `bigseller_uom_name` terisi untuk semua satuan | `MULTI_UNIT` |
| Pemasok terisi | PO |
| Jumlah nomor seri sama dengan kuantitas | Produk `track_serial` |
| Nomor SKU, kuantitas, dan nomor pembelian tidak kosong dan tidak melewati panjang maksimum **[Uji]** | Semua |

**Peringatan (tidak memblokir):**

| Peringatan | Keterangan |
|---|---|
| Harga kosong | Menjelaskan bahwa nilai persediaan di BigSeller tidak terisi dari ekspor ini |
| Jumlah baris mendekati batas file | Job dipecah |
| Dokumen berusia lebih dari N hari belum diekspor | Mengingatkan agar stok BigSeller tidak tertinggal |
| Total pengurangan suatu SKU lebih besar dari stok terakhir yang diketahui di BigSeller | Hanya jika stok BigSeller pernah dimasukkan ke aplikasi |

---

## 8. Yang Tidak Ikut Terkirim ke BigSeller

| Data di aplikasi | PO | Pengurangan stok | Akibat |
|---|:-:|:-:|---|
| Lokasi rak | tidak | tidak | Hanya di aplikasi (keputusan awal) |
| Nomor batch | tidak | tidak | Stok per batch tidak sinkron dengan BigSeller |
| Tanggal produksi dan kedaluwarsa | **ya** | tidak | Pengurangan stok tidak menyebut batch mana yang dikeluarkan |
| Nomor seri | tidak | **ya** | Serial hanya terlihat saat pengurangan |
| Alasan issue atau selisih | tidak | tidak | Hanya di aplikasi dan audit log |
| Foto bukti | tidak | tidak | Hanya di `storage/` |
| Harga dan biaya | kolom ada, kosong | tidak ada | Lihat 3.2 |
| Stok lebih dari stock count (adjustment plus) | **belum ada jalur** | tidak bisa | Lihat doc 06 bagian 8 |

Konsekuensi untuk produk yang melacak batch dengan kedaluwarsa: BigSeller menerima
tanggal kedaluwarsa pada PO tetapi pengurangan stok tidak menentukan batch. Cara
BigSeller memilih batch yang dikurangi **[Uji]** dan tidak dapat dikendalikan dari
aplikasi. Karena Checker bebas memilih batch (doc 05), saldo per batch di
aplikasi bisa berbeda dengan BigSeller. Perbedaan ini wajar dan harus diterima
sebagai bagian dari desain.

---

## 9. Daftar Uji di BigSeller (wajib sebelum rilis)

Uji dengan file kecil (1 sampai 3 baris) di akun BigSeller. Catat hasil dan
perbarui dokumen ini.

| # | Yang diuji | Cara uji | Dampak jika berbeda |
|---|---|---|---|
| 1 | Apakah CSV diterima selain XLSX | Unggah sheet `SKU` sebagai CSV | Menentukan apakah CSV ditawarkan |
| 2 | Apakah PO import menolak SKU yang belum ada | Impor SKU fiktif | Menentukan perlunya ekspor Merchant SKU |
| 3 | Format tanggal D dan E | Coba `2026-10-07`, `07/10/2026` | Format penulisan tanggal |
| 4 | Apakah harga (H) wajib bila kosong | Impor tanpa harga dan mata uang | Perlu menyimpan harga atau tidak |
| 5 | Satuan kolom C PO | Impor SKU multi satuan dengan angka biasa; cek hasil stok | Memastikan asumsi satuan dasar |
| 6 | Duplikat Nomor Pembelian Sementara | Impor nomor yang sama dua kali | Aturan revisi `-R1` |
| 7 | Batas jumlah baris per file | Naikkan bertahap atau cek pesan error | Nilai `max_rows_per_file` |
| 8 | Nama pemasok yang belum ada | Impor pemasok baru | Apakah dibuat otomatis atau error |
| 9 | Pilihan gudang saat impor | Lihat layar impor | Aturan satu file per gudang |
| 10 | Multi satuan di pengurangan stok | `1 Dus 2 Pcs` pada SKU dengan konversi | Mengaktifkan `MULTI_UNIT` |
| 11 | Format banyak nomor seri (kolom C) | Satu baris per serial vs dipisah koma | Aturan baris produk `track_serial` |
| 12 | Pengurangan melebihi stok BigSeller | Kurangi lebih dari stok | Perilaku error/stok negatif |
| 13 | Pengurangan stok untuk SKU yang punya batch di BigSeller | Lihat batch mana yang berkurang | Penjelasan perbedaan batch (bagian 8) |
| 14 | Panjang maksimum Nomor SKU, nomor pembelian, catatan | Coba nilai panjang | Validasi bagian 7 |
| 15 | Header template harus persis | Ubah satu karakter header | Kepatuhan pada template asli |

---

## 10. Keputusan yang Masih Terbuka

1. **Harga di PO:** apakah BigSeller dipakai untuk menghitung modal persediaan?
   Jika ya, aplikasi perlu mencatat harga satuan (dan mata uang) pada item
   penerimaan, serta kolom F, G, H diisi.
2. **Format keluaran default:** XLSX default dengan CSV opsional (usulan di atas),
   atau CSV saja sesuai rencana awal? Bergantung pada uji nomor 1.
3. **Cara mengisi daftar pemetaan SKU awal:** diimpor dari ekspor Merchant SKU
   BigSeller, dibuat manual oleh Head, atau dibuat dari template Merchant SKU?
4. **Siapa yang menandai job `COMPLETED`/`FAILED`:** Head saja (usulan).
5. **Pengingat dokumen tertunda ekspor:** berapa hari batas sebelum peringatan?
6. **Jalur adjustment plus** (belum ada, doc 06 bagian 11 nomor 5).
7. **Rekonsiliasi stok dengan BigSeller:** apakah Head akan mengunggah laporan
   stok BigSeller secara berkala ke aplikasi untuk dibandingkan?

---

## 11. Kebutuhan Skema (untuk migration berikutnya)

Skema `001` + `002` sudah memiliki `export_jobs` (tipe, status, gudang,
`file_path`, `record_count`, `error_count`, `error_details`), `export_job_items`
(keterkaitan dokumen, anti ekspor ganda, pelepasan), `bigseller_mappings`, dan
`units.bigseller_uom_name`. Yang belum ada:

| Kebutuhan | Keterangan |
|---|---|
| `export_job_lines` | Snapshot tiap baris file (SKU, kuantitas, serial) dan dokumen asal yang membentuknya |
| Metadata file | `file_name`, `file_checksum`, `file_format`, `row_count` pada `export_jobs` |
| Nomor job | `job_number` yang dapat dibaca manusia untuk nama file |
| Revisi ekspor | `revision_no` pada keterkaitan dokumen atau pada nomor pembelian |
| Pengaturan | `export.quantity_format`, `export.max_rows_per_file`, `export.date_format` |
| Harga penerimaan | `unit_price`, `currency` pada `receiving_items` (jika keputusan nomor 1 = ya) |
| Pelacakan stok BigSeller | Tabel snapshot stok BigSeller per SKU (jika keputusan nomor 7 = ya) |
| Template Merchant SKU | Jenis ekspor `MERCHANT_SKU` pada `export_type` (jika diperlukan) |
