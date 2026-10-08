import { useState } from "react";

type Product = { id: string; name?: string; trackBatch?: boolean };
export function MasterEntry({
  products,
  busy,
  save,
}: {
  products: Product[];
  busy: boolean;
  save: (kind: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const [product, setProduct] = useState({
    code: "",
    name: "",
    uom: "PCS",
    uomFactor: 1,
    trackBatch: false,
    trackExpiry: false,
  });
  const [location, setLocation] = useState("");
  const [batch, setBatch] = useState({ product: "", batch: "", expiry: "" });
  return (
    <section className="connected-card">
      <h2>Master data awal</h2>
      <p>
        Head: buat produk, lokasi gudang, batch dan supplier. Checker kemudian
        mengisi Penerimaan; Staff mengisi Stock count. Produk dan batch berlaku
        lintas gudang; lokasi dan supplier hanya untuk gudang aktif.
      </p>
      <form
        className="connected-settings"
        onSubmit={(e) => {
          e.preventDefault();
          void save("products", product)
            .then(() =>
              setProduct({
                code: "",
                name: "",
                uom: "PCS",
                uomFactor: 1,
                trackBatch: false,
                trackExpiry: false,
              }),
            )
            .catch(() => {});
        }}
      >
        <h3>Produk baru</h3>
        <label>
          Kode produk
          <input
            required
            maxLength={64}
            pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
            value={product.code}
            onChange={(e) => setProduct({ ...product, code: e.target.value })}
          />
        </label>
        <label>
          Nama produk
          <input
            required
            maxLength={200}
            value={product.name}
            onChange={(e) => setProduct({ ...product, name: e.target.value })}
          />
        </label>
        <label>
          Satuan dokumen
          <input
            required
            maxLength={20}
            value={product.uom}
            onChange={(e) => setProduct({ ...product, uom: e.target.value })}
          />
        </label>
        <label>
          Faktor ke satuan dasar
          <input
            required
            type="number"
            min="1"
            max="2147483647"
            step="1"
            value={product.uomFactor}
            onChange={(e) =>
              setProduct({ ...product, uomFactor: Number(e.target.value) })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={product.trackBatch}
            onChange={(e) =>
              setProduct({
                ...product,
                trackBatch: e.target.checked,
                trackExpiry: e.target.checked && product.trackExpiry,
              })
            }
          />
          Lacak batch
        </label>
        <label>
          <input
            type="checkbox"
            disabled={!product.trackBatch}
            checked={product.trackExpiry}
            onChange={(e) =>
              setProduct({ ...product, trackExpiry: e.target.checked })
            }
          />
          Lacak kedaluwarsa
        </label>
        <p>Satuan dan pelacakan tidak dapat diubah setelah produk dibuat.</p>
        <button className="button primary" disabled={busy}>
          Tambah produk
        </button>
      </form>
      <form
        className="connected-settings"
        onSubmit={(e) => {
          e.preventDefault();
          void save("locations", { id: location })
            .then(() => setLocation(""))
            .catch(() => {});
        }}
      >
        <label>
          Lokasi baru
          <input
            required
            maxLength={100}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={busy}>
          Tambah lokasi
        </button>
      </form>
      <form
        className="connected-settings"
        onSubmit={(e) => {
          e.preventDefault();
          void save("batches", batch)
            .then(() => setBatch({ product: "", batch: "", expiry: "" }))
            .catch(() => {});
        }}
      >
        <label>
          Produk batch
          <select
            required
            value={batch.product}
            onChange={(e) => setBatch({ ...batch, product: e.target.value })}
          >
            <option value="">Pilih produk</option>
            {products
              .filter((p) => p.trackBatch)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} - {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Batch baru
          <input
            required
            maxLength={100}
            value={batch.batch}
            onChange={(e) => setBatch({ ...batch, batch: e.target.value })}
          />
        </label>
        <label>
          Kedaluwarsa batch
          <input
            type="date"
            value={batch.expiry}
            onChange={(e) => setBatch({ ...batch, expiry: e.target.value })}
          />
        </label>
        <button className="button primary" disabled={busy}>
          Tambah batch
        </button>
      </form>
    </section>
  );
}
