import { useState } from "react";
import { Plus, Search, ShieldCheck } from "lucide-react";
import { DocumentTable } from "../components/tables/DocumentTable";
import {
  canCreate,
  canVerify,
  kindLabel,
  people,
  statusLabel,
  type Document,
  type Kind,
  type Session,
} from "../services/warehouse";
export function Documents({
  kind,
  documents,
  session,
  open,
  create,
  search,
}: {
  kind: Kind | "approval";
  documents: Document[];
  session: Session;
  open: (doc: Document) => void;
  create: (kind: Kind) => void;
  search: string;
}) {
  const [status, setStatus] = useState("ALL");
  const [query, setQuery] = useState("");
  const actionable = (d: Document) =>
    d.createdBy !== people[session.role].id &&
    ((d.status === "PENDING" && canVerify(session.role, d.kind)) ||
      (d.kind === "stock-count" &&
        d.status === "VERIFIED" &&
        session.role === "Admin"));
  const filtered = documents
    .filter((d) => (kind === "approval" ? actionable(d) : d.kind === kind))
    .filter(
      (d) =>
        (status === "ALL" || d.status === status) &&
        `${d.id} ${d.partner} ${d.creatorName}`
          .toLowerCase()
          .includes(`${search} ${query}`.trim().toLowerCase()),
    );
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">
          {kind === "approval" ? "KONTROL & AKURASI" : "OPERASIONAL GUDANG"}
        </div>
        <div className="heading-row">
          <div>
            <h1>
              {kind === "approval" ? "Persetujuan" : kindLabel[kind]}
              <span className="green-dot">.</span>
            </h1>
            <p>
              {kind === "approval"
                ? "Periksa dokumen sesuai kewenangan Anda sebelum stok berubah."
                : kind === "stock-count"
                  ? "Hitung fisik secara independen, jaga akurasi persediaan."
                  : kind === "receiving"
                    ? "Catat material datang, periksa, lalu simpan dengan pasti."
                    : "Pantau material keluar untuk setiap kebutuhan produksi."}
            </p>
          </div>
          {kind !== "approval" && canCreate(session.role, kind) && (
            <button className="button primary" onClick={() => create(kind)}>
              <Plus size={17} />
              Buat {kindLabel[kind].toLowerCase()}
            </button>
          )}
        </div>
      </div>
      {kind === "approval" && (
        <div className="callout">
          <ShieldCheck size={18} />
          Pembuat dokumen tidak dapat memverifikasi atau menyetujui dokumennya
          sendiri. Head tidak memverifikasi pengeluaran.
        </div>
      )}
      <section className="panel">
        <div className="filter-bar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Cari dokumen"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nomor dokumen, supplier, petugas..."
            />
          </label>
          <select
            aria-label="Filter status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="ALL">Semua status</option>
            {Object.entries(statusLabel).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <span className="muted">{filtered.length} dokumen</span>
        </div>
        <DocumentTable documents={filtered} open={open} />
      </section>
    </>
  );
}
