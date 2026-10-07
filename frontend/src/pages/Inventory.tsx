import { useState } from "react";
import {
  Boxes,
  Download,
  Search,
  SlidersHorizontal,
  LockKeyhole,
} from "lucide-react";
import {
  frozen,
  number,
  productById,
  type Session,
  type State,
} from "../services/warehouse";
import { downloadCsv } from "../utils/download";
export function Inventory({
  state,
  session,
  search,
}: {
  state: State;
  session: Session;
  search: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Semua kategori");
  const [lowOnly, setLowOnly] = useState(false);
  const rows = state.stocks
    .filter((s) => s.warehouse === session.warehouse)
    .filter((s) => {
      const p = productById(s.product);
      return (
        `${p.name} ${p.id} ${s.location} ${s.batch}`
          .toLowerCase()
          .includes(`${search} ${query}`.trim().toLowerCase()) &&
        (category === "Semua kategori" || p.category === category) &&
        (!lowOnly || s.quantity < p.minimum)
      );
    });
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">MATERIAL & PERSEDIAAN</div>
        <div className="heading-row">
          <div>
            <h1>
              Inventori<span className="green-dot">.</span>
            </h1>
            <p>Satu sumber kebenaran, hingga lokasi rak dan batch.</p>
          </div>
          <button
            className="button secondary"
            onClick={() =>
              downloadCsv(
                "inventori-demo.csv",
                [
                  "SKU",
                  "Material",
                  "Lokasi",
                  "Batch",
                  "Kuantitas dasar",
                  "Satuan",
                ],
                rows.map((s) => {
                  const p = productById(s.product);
                  return [
                    p.id,
                    p.name,
                    s.location,
                    s.batch,
                    s.quantity,
                    p.unit,
                  ];
                }),
              )
            }
          >
            <Download size={16} />
            Unduh laporan
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="filter-bar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Cari material"
              placeholder="Cari nama material, SKU, atau rak..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Kategori material"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["Semua kategori", "Kain", "Benang", "Aksesoris", "Penunjang"].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
          </select>
          <button
            className={`button ${lowOnly ? "primary" : "secondary"}`}
            onClick={() => setLowOnly(!lowOnly)}
          >
            <SlidersHorizontal size={16} />
            Stok rendah
          </button>
        </div>
        <div className="table-scroll">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Kategori</th>
                <th>Lokasi / batch</th>
                <th>Saldo fisik</th>
                <th>Minimum per SKU</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const p = productById(s.product);
                const locked = frozen(state, session.warehouse, s.location);
                return (
                  <tr key={i}>
                    <td>
                      <div className="material-cell">
                        <span
                          className={`material-icon material-${p.category}`}
                        >
                          <Boxes size={20} />
                        </span>
                        <div>
                          <strong>{p.name}</strong>
                          <small>
                            {p.id} / {p.sku}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{p.category}</td>
                    <td>
                      <span className="location-chip">{s.location}</span>
                      <small>
                        {s.batch || "Tanpa batch"}
                        {s.expiry && ` / ED ${s.expiry}`}
                      </small>
                    </td>
                    <td>
                      <strong className="stock-number">
                        {number(s.quantity / p.factor)}
                      </strong>{" "}
                      <span className="muted">{p.inputUnit}</span>
                    </td>
                    <td>
                      {number(p.minimum / p.factor)} {p.inputUnit}
                    </td>
                    <td>
                      {locked ? (
                        <span className="badge draft">
                          <LockKeyhole size={12} />
                          Dibekukan
                        </span>
                      ) : (
                        <span
                          className={`badge ${s.quantity < p.minimum ? "pending" : "verified"}`}
                        >
                          <i />
                          {s.quantity < p.minimum ? "Stok rendah" : "Tersedia"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty">
              <Boxes size={30} />
              <h3>Material tidak ditemukan</h3>
              <p>Coba kata kunci atau kategori lain.</p>
            </div>
          )}
        </div>
        <div className="table-footer">
          Menampilkan {rows.length} posisi stok
          <span>Saldo berubah hanya melalui transaksi terverifikasi.</span>
        </div>
      </section>
    </>
  );
}
