import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Boxes,
  ShieldCheck,
  TriangleAlert,
  CalendarDays,
  PackageCheck,
  ClipboardCheck,
} from "lucide-react";
import { DocumentTable } from "../components/tables/DocumentTable";
import { canViewBalances, type Page } from "../permissions";
import {
  canCreate,
  kindLabel,
  localDate,
  number,
  people,
  productById,
  products,
  type Document,
  type Kind,
  type Session,
  type State,
} from "../services/warehouse";
export function Dashboard({
  state,
  session,
  documents,
  navigate,
  open,
  create,
}: {
  state: State;
  session: Session;
  documents: Document[];
  navigate: (page: Page) => void;
  open: (doc: Document) => void;
  create: (kind: Kind) => void;
}) {
  const stocks = state.stocks.filter((s) => s.warehouse === session.warehouse);
  const balances = canViewBalances(session.role);
  const lows = products
    .map((p) => ({
      p,
      qty: stocks
        .filter((s) => s.product === p.id)
        .reduce((a, s) => a + s.quantity, 0),
    }))
    .filter((x) => x.qty < x.p.minimum);
  const pending = documents.filter(
    (d) =>
      d.status === "PENDING" ||
      (d.kind === "stock-count" && d.status === "VERIFIED"),
  );
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + i);
    const key = localDate(date);
    return {
      label: date.toLocaleDateString("id-ID", { weekday: "short" }),
      receiving: documents.filter(
        (d) => d.date === key && d.kind === "receiving",
      ).length,
      issue: documents.filter((d) => d.date === key && d.kind === "issue")
        .length,
    };
  });
  const max = Math.max(3, ...days.flatMap((d) => [d.receiving, d.issue]));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GUDANG TERKELOLA, KERJA LEBIH MUDAH</div>
          <h1>
            Semua dalam kendali<span className="green-dot">.</span>
          </h1>
          <p>
            Selamat datang, {people[session.role].name.split(" ")[0]}. Ini kabar
            gudang Anda hari ini.
          </p>
        </div>
        <div className="date-chip">
          <CalendarDays size={16} />
          {new Date().toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </div>
      </div>
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="hero-tag">
            <span className="online-dot" />
            WAREHOUSE OVERVIEW
          </span>
          <h2>
            Alur material lancar.
            <br />
            Produksi terus berjalan.
          </h2>
          <p>
            Satu ruang untuk memantau persediaan,
            <br className="desktop-only" /> memastikan akurasi, dan menggerakkan
            operasional.
          </p>
          <button
            className="hero-link"
            onClick={() =>
              navigate(
                balances
                  ? "inventory"
                  : session.role === "Staff"
                    ? "stock-count"
                    : "receiving",
              )
            }
          >
            {balances ? "Jelajahi inventori" : "Mulai pekerjaan"}
            <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="warehouse-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-floor" />
          <div className="rack rack-back">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="rack rack-front">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="floating-label">
            <PackageCheck size={16} />
            <span>Setiap material, tercatat.</span>
            <span className="online-dot" />
          </div>
          <div className="art-coordinate">BUYMORE / OPERATIONS SYSTEM</div>
        </div>
        <div className="hero-index">01 — WORKSPACE</div>
      </section>
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-icon sage">
            <Boxes size={20} />
          </span>
          <span className="stat-label">
            {balances ? "Material aktif" : "Dokumen saya"}
          </span>
          <strong>
            {balances
              ? new Set(stocks.map((s) => s.product)).size
              : documents.length}
            <small>{balances ? "SKU" : "dokumen"}</small>
          </strong>
          <p>
            <span className="tiny-dot green" />
            {balances ? "Tercatat di gudang aktif" : "Tersimpan di workspace"}
          </p>
        </div>
        <div className="stat-card">
          <span className="stat-icon blue">
            <ArrowDownLeft size={20} />
          </span>
          <span className="stat-label">Penerimaan hari ini</span>
          <strong>
            {
              documents.filter(
                (d) => d.kind === "receiving" && d.date === localDate(),
              ).length
            }
            <small>dokumen</small>
          </strong>
          <p>Material masuk dari supplier</p>
        </div>
        <div className="stat-card">
          <span className="stat-icon sand">
            <ArrowUpRight size={20} />
          </span>
          <span className="stat-label">Pengeluaran hari ini</span>
          <strong>
            {
              documents.filter(
                (d) => d.kind === "issue" && d.date === localDate(),
              ).length
            }
            <small>dokumen</small>
          </strong>
          <p>Pemakaian & kebutuhan produksi</p>
        </div>
        <div className="stat-card">
          <span className="stat-icon lilac">
            <ShieldCheck size={20} />
          </span>
          <span className="stat-label">Menunggu pemeriksaan</span>
          <strong>
            {pending.length}
            <small>dokumen</small>
          </strong>
          <p>
            <span className="tiny-dot amber" />
            Perlu tindak lanjut
          </p>
        </div>
      </div>
      <div className="dashboard-middle">
        <section className="panel movement-panel">
          <div className="panel-heading">
            <div>
              <h3>Aktivitas material</h3>
              <p>Jumlah dokumen masuk dan keluar</p>
            </div>
            <span className="subtle-chip">7 hari terakhir</span>
          </div>
          <div className="chart-legend">
            <span>
              <i className="green" />
              Penerimaan
            </span>
            <span>
              <i className="lime" />
              Pengeluaran
            </span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={days
              .map(
                (d) =>
                  `${d.label}: ${d.receiving} penerimaan, ${d.issue} pengeluaran`,
              )
              .join("; ")}
          >
            <div className="chart-axis">
              {[max, Math.round(max / 2), 0].map((n, i) => (
                <span key={i}>{n}</span>
              ))}
            </div>
            <div className="chart-plot">
              {days.map((d, i) => (
                <div className={`chart-day ${i === 6 ? "today" : ""}`} key={i}>
                  <div className="bar-pair">
                    <div
                      className="bar incoming"
                      style={{ height: `${(d.receiving / max) * 100}%` }}
                      title={`${d.receiving} penerimaan`}
                    />
                    <div
                      className="bar outgoing"
                      style={{ height: `${(d.issue / max) * 100}%` }}
                      title={`${d.issue} pengeluaran`}
                    />
                  </div>
                  <span>{d.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-footer">
            <span className="online-dot" />
            Data dari dokumen di workspace ini, bukan tren produksi aktual.
          </div>
        </section>
        <section className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <h3>
                Perlu perhatian{" "}
                <span className="count-chip">
                  {balances ? lows.length : pending.length}
                </span>
              </h3>
              <p>
                {balances
                  ? "Jaga ketersediaan material Anda"
                  : "Lanjutkan pekerjaan Anda"}
              </p>
            </div>
            <TriangleAlert size={18} className="amber-text" />
          </div>
          {balances ? (
            <>
              <div className="attention-label">STOK DI BAWAH MINIMUM</div>
              {lows.slice(0, 3).map(({ p, qty }) => (
                <button
                  className="low-stock"
                  key={p.id}
                  onClick={() => navigate("inventory")}
                >
                  <span
                    className={`material-icon ${p.category === "Benang" ? "thread" : "accessory"}`}
                  >
                    <Boxes size={20} />
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.id}{" "}
                      <span>
                        / Minimum {number(p.minimum / p.factor)} {p.inputUnit}
                      </span>
                    </small>
                  </span>
                  <b>
                    {number(qty / p.factor)}
                    <small>{p.inputUnit}</small>
                  </b>
                </button>
              ))}
              {!lows.length && (
                <p className="empty-inline">
                  Semua material di atas stok minimum.
                </p>
              )}
              <button
                className="text-button attention-link"
                onClick={() => navigate("inventory")}
              >
                Lihat semua inventori
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <div className="role-focus">
              <ClipboardCheck size={38} />
              <h3>
                {session.role === "Staff"
                  ? "Hitung fisik, tanpa bias."
                  : "Catat setiap pergerakan."}
              </h3>
              <p>
                {session.role === "Staff"
                  ? "Saldo sistem tidak ditampilkan pada proses stock count."
                  : "Penerimaan dan pengeluaran Anda menunggu verifikasi Admin."}
              </p>
            </div>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Transaksi terbaru</h3>
            <p>Jejak pergerakan material di gudang Anda</p>
          </div>
          <button
            className="text-button"
            onClick={() =>
              navigate(session.role === "Staff" ? "stock-count" : "receiving")
            }
          >
            Lihat semua
            <ArrowRight size={15} />
          </button>
        </div>
        <DocumentTable documents={documents.slice(0, 5)} open={open} />
      </section>
      <div className="quick-actions">
        {(["receiving", "issue", "stock-count"] as Kind[])
          .filter((k) => canCreate(session.role, k))
          .map((k) => (
            <button
              className="button primary"
              key={k}
              onClick={() => create(k)}
            >
              Buat {kindLabel[k].toLowerCase()}
              <ArrowRight size={16} />
            </button>
          ))}
      </div>
    </>
  );
}
