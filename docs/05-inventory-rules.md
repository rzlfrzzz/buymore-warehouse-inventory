# 05 - Inventory Rules

Dokumen ini mengatur bagaimana stok dicatat, dihitung, dan dikeluarkan.
Aplikasi ini adalah **sumber kebenaran stok**; BigSeller hanya menerima hasil
ekspor satu arah.

---

## 1. Prinsip Dasar

1. **Stok berbasis ledger.** Saldo tidak pernah diedit langsung. Setiap
   perubahan stok adalah satu baris mutasi pada `inventory_ledger`, dan saldo
   adalah hasil penjumlahan mutasi.
2. **Ledger bersifat append-only.** Baris ledger tidak boleh diubah atau
   dihapus. Kesalahan dikoreksi dengan mutasi pembalik (reversal) atau
   adjustment yang di-approve.
3. **Semua kuantitas disimpan dalam satuan dasar** (satuan terkecil). Satuan
   lain hanya untuk input dan tampilan.
4. **Stok diidentifikasi oleh kombinasi:**
   `produk x gudang x lokasi rak x batch` (batch hanya jika produk melacak batch).
5. **Material produksi:** barang keluar adalah pemakaian material, bukan
   penjualan. Setiap issue wajib punya alasan/tujuan.

---

## 2. Multi Satuan (UoM)

Setiap produk memiliki satu **satuan dasar** dan nol atau lebih satuan turunan
dengan faktor konversi ke satuan dasar.

Contoh produk X: Pcs (dasar), 1 Kotak = 10 Pcs, 1 Dus = 12 Kotak = 120 Pcs.

| Tabel `product_uoms` | Keterangan |
|---|---|
| `product_id` | Produk |
| `uom_name` | Nama satuan, **harus persis sama dengan nama satuan di BigSeller** |
| `factor_to_base` | Berapa satuan dasar dalam 1 satuan ini |
| `is_base` | Penanda satuan dasar |

Aturan:

1. Input boleh multi satuan (contoh: 4 Dus + 3 Kotak + 1 Pcs). Backend
   mengonversi ke satuan dasar sebelum masuk ledger.
2. Kuantitas pada ledger adalah **bilangan bulat satuan dasar**. Jika ada
   material yang dihitung pecahan (kg, meter), satuan dasarnya harus dipilih
   cukup kecil (gram, cm) atau dibuat tipe desimal. Lihat bagian 11.
3. Konversi satuan pada produk yang **sudah punya riwayat transaksi tidak boleh
   diubah** tanpa persetujuan khusus Head.
4. Satuan nonaktif tidak bisa dipakai untuk transaksi baru, tetapi riwayat lama
   tetap terbaca.

---

## 3. Flag Pelacakan per Produk

Tidak semua produk melacak batch dan serial. Pelacakan ditentukan oleh flag
pada master produk (dikelola Head lewat `master.manage`).

| Flag | Efek |
|---|---|
| `track_batch` | Penerimaan dan issue wajib mencantumkan nomor batch. Stok dipisah per batch. |
| `track_expiry` | Penerimaan wajib mencantumkan tanggal kedaluwarsa (dan opsional tanggal produksi). Hanya boleh aktif jika `track_batch` aktif. |
| `track_serial` | Setiap unit memiliki nomor seri unik. Kuantitas = jumlah nomor seri. |

Aturan:

1. UI hanya menampilkan field batch/ED/serial pada produk yang flag-nya aktif.
2. **Flag tidak boleh diubah** jika produk sudah punya saldo atau riwayat
   transaksi, kecuali lewat prosedur migrasi yang disetujui Head.
3. Pada produk `track_serial`, nomor seri **unik per produk** dan satu nomor
   seri hanya bisa berstatus: `in_stock`, `issued`.
4. Kombinasi `track_serial` dan `track_batch` diperbolehkan.

---

## 4. Lokasi Rak

1. Lokasi adalah master data per gudang (kode, nama, status aktif).
2. Setiap penerimaan **wajib** menentukan lokasi tujuan. Setiap issue wajib
   menentukan lokasi asal.
3. Satu produk boleh berada di banyak lokasi dalam satu gudang.
4. Perpindahan antar lokasi dalam gudang yang sama dicatat sebagai
   **mutasi pindah lokasi** (dua baris ledger: keluar dan masuk) dan tidak
   memengaruhi ekspor ke BigSeller karena total stok per SKU tidak berubah.
5. Lokasi **hanya ada di aplikasi** dan tidak ikut diekspor.

---

## 5. Jenis Mutasi Ledger

| Tipe | Arah | Sumber | Masuk ekspor |
|---|---|---|---|
| `RECEIVE` | + | Penerimaan dari supplier | Ya, PO import |
| `ISSUE` | - | Pemakaian material | Ya, pengurangan stok |
| `COUNT_ADJ_MINUS` | - | Adjustment minus dari stock count | Ya, pengurangan stok |
| `COUNT_ADJ_PLUS` | + | Adjustment plus dari stock count | Lihat bagian 9 |
| `MOVE_OUT` / `MOVE_IN` | -/+ | Pindah lokasi dalam gudang | Tidak |
| `REVERSAL` | +/- | Pembalik dokumen yang dibatalkan | Mengikuti dokumen asal |

Setiap baris ledger menyimpan: produk, gudang, lokasi, batch, kuantitas (satuan
dasar), tipe, dokumen sumber, pembuat, `shift_id`, `shift_date`, dan waktu.

---

## 6. Aturan Penerimaan (Receiving)

1. Satu dokumen penerimaan = satu "Nomor Pembelian Sementara" pada ekspor PO.
2. Satu baris dokumen = satu SKU dengan kuantitas, lokasi tujuan, dan jika
   berlaku batch, tanggal produksi, tanggal kedaluwarsa.
3. SKU yang sama dengan batch/ED berbeda dicatat sebagai **baris terpisah**.
4. Foto bukti (surat jalan, kondisi barang) diunggah sebagai attachment.
5. Tanggal kedaluwarsa tidak boleh lebih awal dari tanggal produksi, dan
   tidak boleh sudah lewat saat penerimaan (jika sudah lewat, wajib alasan
   dan verifikasi Admin atau Head).
6. SKU harus sudah ada di master produk. SKU baru dibuat dulu oleh Head.

---

## 7. Aturan Issue (Pengeluaran Material)

1. Setiap dokumen issue wajib memiliki **alasan/tujuan**: Produksi, Rusak,
   Sampel, Lainnya (daftar dikelola Head), plus catatan bebas.
2. Checker hanya melihat saldo lewat pencarian (`inventory.lookup`).
3. Issue tidak boleh melebihi saldo yang tersedia (lihat bagian 8).

### Pemilihan batch: bebas

Untuk produk `track_batch`, **Checker bebas memilih batch** mana yang
dikeluarkan. Tidak ada urutan paksa (FEFO/FIFO).

Agar tetap terkontrol:

1. UI **menyarankan** batch dengan kedaluwarsa terdekat (FEFO) sebagai urutan
   tampilan default, tetapi tidak memaksa.
2. Batch yang dipilih harus punya saldo cukup di lokasi yang dipilih.
3. **Batch yang sudah kedaluwarsa** ditandai merah dan butuh konfirmasi
   tambahan serta alasan.
4. Pilihan batch **tercatat di ledger dan audit log**, sehingga laporan dapat
   menampilkan issue yang tidak mengikuti FEFO bila diperlukan.
5. Admin melihat pilihan batch saat `issue.verify`.

### Nomor seri

Untuk produk `track_serial`, Checker memilih atau memindai nomor seri yang
dikeluarkan. Jumlah nomor seri harus sama dengan kuantitas issue, dan nomor
seri harus berstatus `in_stock`.

---

## 8. Saldo dan Larangan Minus

1. **Saldo tidak boleh negatif** pada level mana pun (produk, lokasi, batch).
2. Saldo tersedia = saldo fisik dikurangi issue yang sudah `Submitted` tetapi
   belum `Verified`, supaya dua Checker tidak mengeluarkan stok yang sama.
3. Cek saldo dilakukan di backend dalam transaksi database (dengan locking),
   bukan hanya di UI.
4. Selisih antara sistem dan fisik **hanya** diselesaikan lewat stock count
   dan adjustment yang di-approve Head.

### Kapan ledger diposting

| Dokumen | Ledger diposting saat status |
|---|---|
| Receiving | `Verified` |
| Issue | `Verified` |
| Adjustment | `Approved` |

Dokumen `Draft`, `Submitted`, dan `Cancelled` tidak memengaruhi saldo fisik.
Dokumen `Exported` terkunci.

---

## 9. Hubungan dengan Template BigSeller

Batasan format template menentukan apa yang hilang saat ekspor:

| Data di aplikasi | Template PO | Template pengurangan stok |
|---|---|---|
| SKU | Ya | Ya |
| Kuantitas | Ya, satuan dasar atau multi satuan | Ya, format multi satuan (contoh `4 Dus 3 Kotak 1 Pcs`) |
| Tanggal produksi / kedaluwarsa | Ya | **Tidak ada** |
| Nomor batch | **Tidak ada kolom khusus** | **Tidak ada** |
| Nomor seri | **Tidak ada** | Ya |
| Lokasi rak | Tidak | Tidak |
| Alasan issue | Tidak | Tidak |
| Gudang | Tidak (dipilih saat impor di BigSeller) | Tidak |

Konsekuensi:

1. **Pilihan batch saat issue tidak terkirim ke BigSeller.** Informasi batch
   pada pengurangan stok hanya hidup di aplikasi ini.
2. Ekspor dikelompokkan per SKU: kuantitas dari banyak lokasi dan batch dijumlah.
3. Ekspor dibuat **satu file per gudang**.
4. Nomor pembelian sementara pada ekspor PO diambil dari nomor dokumen
   penerimaan agar mudah dicocokkan.
5. Detail kolom dan pemetaan dibahas di `08-bigseller-export.md`.

---

## 10. Validasi Umum

- Kuantitas harus lebih dari 0.
- SKU, satuan, lokasi, dan gudang harus aktif.
- Produk `track_batch` tidak boleh disimpan tanpa batch.
- Produk `track_serial` tidak boleh disimpan jika jumlah nomor seri tidak sama
  dengan kuantitas.
- Dokumen yang melewati batas validasi ditolak di backend, bukan hanya di UI.

---

## 11. Keputusan yang Masih Terbuka

1. **Material pecahan:** apakah ada material yang dihitung desimal (kg, meter,
   liter)? Jika ya, tentukan kuantitas desimal (misal 3 angka di belakang
   koma) atau satuan dasar yang lebih kecil.
2. **Waktu posting ledger:** rekomendasi di atas adalah saat `Verified`.
   Alternatifnya posting saat `Submitted` agar stok langsung berkurang.
3. **Penanganan `COUNT_ADJ_PLUS`:** template pengurangan stok tidak bisa
   menambah stok. Kelebihan stok dari stock count perlu jalur lain (misalnya
   PO import terpisah atau penyesuaian manual di BigSeller).
4. **Transfer antar gudang:** apakah diperlukan, dan bagaimana mencatatnya ke
   BigSeller?
5. **Batch kedaluwarsa:** boleh di-issue dengan konfirmasi (usulan di atas),
   atau diblokir total?
6. **Reservasi untuk produksi:** apakah material perlu "dipesan" sebelum
   dikeluarkan, atau issue langsung saat pemakaian?
7. **Nomor batch dari supplier** apakah selalu ada, atau Checker perlu
   membuat kode batch internal?
