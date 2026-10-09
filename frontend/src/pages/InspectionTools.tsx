import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
type Photo = { mime: string; content: string } | null;
export function ReferencePhoto({
  product,
  warehouse,
  admin = false,
}: {
  product: string;
  warehouse: string;
  admin?: boolean;
}) {
  const [photo, setPhoto] = useState<Photo>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setPhoto(null);
    setError("");
    api<Photo>(
      `/workspace/reference-photos/${encodeURIComponent(product)}`,
      warehouse,
    )
      .then((p) => {
        if (live) setPhoto(p);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [product, warehouse, version]);
  async function save(file?: File) {
    setBusy(true);
    setError("");
    try {
      let input: Record<string, unknown> = { product, remove: true };
      if (file) {
        if (
          file.size > 2097152 ||
          !["image/jpeg", "image/png"].includes(file.type)
        )
          throw new Error("Gunakan JPEG / PNG maksimal 2 MB.");
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("File tidak dapat dibaca"));
          reader.readAsDataURL(file);
        });
        input = { product, mime: file.type, content };
      }
      await api(
        "/workspace/reference-photos",
        warehouse,
        input,
        crypto.randomUUID(),
      );
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Foto referensi" className="inspection-reference">
      <h3>Foto referensi sebelumnya</h3>
      {photo ? (
        <img
          className="inspection-evidence"
          src={`data:${photo.mime};base64,${photo.content}`}
          alt={`Foto referensi ${product}`}
        />
      ) : (
        <p>Belum ada foto referensi untuk gudang ini.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {admin && (
        <>
          <label>
            Unggah / ganti foto referensi
            <input
              disabled={busy}
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void save(file);
                e.target.value = "";
              }}
            />
          </label>
          <button disabled={busy || !photo} onClick={() => void save()}>
            Hapus foto referensi
          </button>
          <p>
            Foto referensi khusus gudang ini. Bukti inspeksi historis tidak
            diubah.
          </p>
        </>
      )}
    </section>
  );
}
export function ExportComposer({
  products,
  warehouse,
}: {
  products: { code: string; name: string }[];
  warehouse: string;
}) {
  const [type, setType] = useState("SR"),
    [supplier, setSupplier] = useState(""),
    [reference, setReference] = useState(""),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  const lines = Object.entries(quantities)
    .filter(([, q]) => q !== "")
    .map(([product, q]) => ({ product, quantity: Number(q) }));
  async function download(blank = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const input = blank
        ? { type, blank: true }
        : { type, supplier, reference, lines, confirmed };
      const fingerprint = JSON.stringify([warehouse, input]);
      if (receipt.current?.fingerprint !== fingerprint)
        receipt.current = { fingerprint, key: crypto.randomUUID() };
      const file = await api<{ filename: string; content: string }>(
        "/workspace/export",
        warehouse,
        input,
        receipt.current.key,
      );
      const blob = new Blob(
        [Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))],
        {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "File diunduh tanpa foto. Ini transfer manual, bukan sinkronisasi stok atau bukti impor BigSeller. Jangan impor file dua kali.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="inspection-card">
      <h2>Ekspor BigSeller PO / SR</h2>
      <p>
        Isi jumlah transaksi dalam PCS, bukan saldo stok teramati. PO adalah
        jumlah pembelian; SR adalah jumlah pengurangan. Ekspor tidak mengubah
        stok aplikasi, tidak mengambil selisih inspeksi otomatis, dan tidak
        menandai dokumen terverifikasi sebagai diekspor.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void download();
        }}
      >
        <label>
          Format
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setConfirmed(false);
            }}
          >
            <option value="PO">PO - Pesanan pembelian</option>
            <option value="SR">SR - Pengurangan stok</option>
          </select>
        </label>
        {type === "PO" && (
          <div className="inspection-fields">
            <label>
              Pemasok
              <input
                required
                maxLength={200}
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            </label>
            <label>
              Nomor pembelian sementara
              <input
                required
                maxLength={64}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="inspection-table">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Nama</th>
                <th>Jumlah transaksi (PCS)</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.code}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>
                    <input
                      aria-label={`Jumlah ${p.code}`}
                      type="number"
                      min="1"
                      max="2147483647"
                      step="1"
                      placeholder="Tidak diekspor"
                      value={quantities[p.code] || ""}
                      onChange={(e) => {
                        setQuantities({
                          ...quantities,
                          [p.code]: e.target.value,
                        });
                        setConfirmed(false);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Pratinjau: {lines.length} SKU /{" "}
          {lines.reduce((sum, l) => sum + l.quantity, 0)} PCS. Hanya baris
          berisi jumlah yang diekspor. Header mengikuti template resmi, tanpa
          kolom atau media foto.
        </p>
        <label className="inspection-check">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Saya telah memeriksa jumlah transaksi dan akan menghindari impor
          ganda; ini bukan sinkronisasi saldo.
        </label>
        <button disabled={busy || !lines.length || !confirmed}>
          Unduh {type} terisi
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void download(true)}
        >
          Unduh template kosong
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
