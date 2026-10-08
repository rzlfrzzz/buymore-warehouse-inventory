import { Fragment, useEffect, useRef, useState } from "react";
import { api, ApiError, type AuthSession } from "../services/api";
import { loadOverview, type Overview } from "../services/overview";
import { CountWorkspace } from "./CountWorkspace";

import {
  ConnectedLayout,
  connectedNavigation,
  allowedConnectedPages,
  type ConnectedPage as Page,
} from "../layouts/ConnectedLayout";
import { Boxes, ArrowRight, ShieldCheck } from "lucide-react";

type DocType = "RECEIVING" | "ISSUE";
type ReportKind = "stock" | "activity";
type Uom = string;
type Product = {
  id: string;
  sku?: string;
  name?: string;
  bigsellerSku?: string;
  bigsellerRegistered?: boolean;
  uom?: string;
  uomFactor?: number;
  track_batch?: boolean;
  trackBatch?: boolean;
  track_expiry?: boolean;
  trackExpiry?: boolean;
};
type Location = { id: string; code?: string; name?: string };
type Supplier = { id: string; name: string };
type OpsSettings = {
  reportPageSize: number;
  reportDefaultDays: number;
  csvDelimiter: string;
  exportWarehouseName: string;
  bigsellerTemplateConfirmed: boolean;
  templates?: Record<"PO" | "SR", { ready: boolean; message: string }>;
};
type Master = {
  products: Product[];
  locations: Location[];
  suppliers: Supplier[];
  settings: OpsSettings;
};
type DocumentLine = {
  productId: string;
  locationId: string;
  documentQuantity: string;
  actualQuantity: string;
  uom: Uom;
  batch: string;
  expiry: string;
};
type DocumentItem = {
  id: string;
  reference?: string;
  status: string;
  supplierName?: string;
  createdBy?: string;
  lineCount?: number;
  totalQuantity?: number;
};
type DocumentDetailLine = {
  id: string;
  productId: string;
  productName?: string;
  bigsellerSku?: string;
  locationId: string;
  documentQuantity: number;
  actualQuantity: number;
  uom: string;
  baseQuantity: number;
  batch?: string;
  expiry?: string;
};
type DocumentDetail = DocumentItem & {
  type: DocType;
  warehouse: string;
  createdAt?: string;
  submittedAt?: string;
  verifiedAt?: string;
  submittedBy?: string;
  verifiedBy?: string;
  rejectedBy?: string;
  rejectReason?: string;
  lines: DocumentDetailLine[];
};
type ReportItem = Record<string, string | number | null | undefined>;
type ExportItem = {
  id: string;
  type: "PO" | "SR";
  status: string;
  createdAt?: string;
  fileName?: string;
  checksum?: string;
  documentCount?: number;
};
const emptyLine = (): DocumentLine => ({
  productId: "",
  locationId: "",
  documentQuantity: "",
  actualQuantity: "",
  uom: "PCS",
  batch: "",
  expiry: "",
});
const defaultSettings: OpsSettings = {
  reportPageSize: 50,
  reportDefaultDays: 30,
  csvDelimiter: ",",
  exportWarehouseName: "",
  bigsellerTemplateConfirmed: false,
};

export function OperationsWorkspace({
  initialSession,
  initialWarehouse,
  initialBoot,
}: {
  initialSession?: AuthSession | null;
  initialWarehouse?: string;
  initialBoot?: boolean;
} = {}) {
  const [session, setSession] = useState<AuthSession | null>(
    initialSession ?? null,
  );
  const [warehouse, setWarehouse] = useState(initialWarehouse ?? "");
  const [boot, setBoot] = useState(initialBoot ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [page, setPage] = useState<Page>("dashboard");
  const [master, setMaster] = useState<Master>({
    products: [],
    locations: [],
    suppliers: [],
    settings: defaultSettings,
  });
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [expandedDocId, setExpandedDocId] = useState("");
  const [docDetails, setDocDetails] = useState<Record<string, DocumentDetail>>(
    {},
  );
  const [docTotal, setDocTotal] = useState(0);
  const [docPage, setDocPage] = useState(1);
  const [docType, setDocType] = useState<DocType>("RECEIVING");
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine()]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [reportTotal, setReportTotal] = useState(0);
  const [reportKind, setReportKind] = useState<ReportKind>("stock");
  const [reportPage, setReportPage] = useState(1);
  const [reportFilters, setReportFilters] = useState({
    from: "",
    to: "",
    product: "",
    location: "",
    actor: "",
  });
  const [settings, setSettings] = useState<OpsSettings>(defaultSettings);
  const [productConfig, setProductConfig] = useState({
    id: "",
    trackBatch: false,
    trackExpiry: false,
    uom: "PCS",
    uomFactor: 1,
    bigsellerSku: "",
    bigsellerRegistered: false,
  });
  const [eligible, setEligible] = useState<DocumentItem[]>([]);
  const [exports, setExports] = useState<ExportItem[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [exportType, setExportType] = useState<"PO" | "SR">("PO");
  const [inventory, setInventory] = useState<
    { location: string; product: string; batch: string; quantity: number }[]
  >([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const intents = useRef(new Map<string, string>());
  const role = session?.memberships.find(
    (m) => m.warehouse === warehouse,
  )?.role;
  const activeScope = useRef("");
  const scope = `${session?.user.id ?? ""}:${warehouse}`;
  activeScope.current = scope;
  const pageSize = Math.max(1, settings.reportPageSize || 50);

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : "Tidak dapat menghubungi server");
    if (e instanceof ApiError && e.status === 401) setSession(null);
  }
  async function run(work: () => Promise<void>) {
    const startedScope = scope;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      if (startedScope === activeScope.current) fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function mutate<T>(
    path: string,
    input: unknown,
    method?: "POST" | "PATCH",
  ) {
    const identity = JSON.stringify([
      session?.user.id,
      warehouse,
      path,
      input,
      method,
    ]);
    let key = intents.current.get(identity);
    if (!key) {
      key = crypto.randomUUID();
      intents.current.set(identity, key);
    }
    const result = await api<T>(path, warehouse, input, key, method);
    intents.current.delete(identity);
    return result;
  }
  async function authenticate() {
    const s = await api<AuthSession>("/session");
    setSession(s);
    setPage("dashboard");
    setWarehouse(s.memberships[0]?.warehouse || "");
  }
  async function loadMaster() {
    const m = await api<Master>("/operations/master", warehouse);
    if (scope !== activeScope.current) return;
    setMaster({
      products: m.products || [],
      locations: m.locations || [],
      suppliers: m.suppliers || [],
      settings: { ...defaultSettings, ...m.settings },
    });
    setSettings({ ...defaultSettings, ...m.settings });
  }
  async function loadDocs(type = docType, pageNo = docPage) {
    const w = warehouse;
    const r = await api<{ items: DocumentItem[]; total: number }>(
      `/operations/documents?warehouseId=${encodeURIComponent(w)}&type=${type}&page=${pageNo}&pageSize=${pageSize}`,
      w,
    );
    if (scope !== activeScope.current) return;
    setDocs(r.items || []);
    setDocTotal(r.total || 0);
    setDocType(type);
    setDocPage(pageNo);
    setSelectedDocs([]);
    setExpandedDocId("");
  }
  async function toggleDocDetail(id: string) {
    if (expandedDocId === id) {
      setExpandedDocId("");
      return;
    }
    if (!docDetails[id]) {
      const detail = await api<DocumentDetail>(
        `/operations/documents/${encodeURIComponent(id)}?warehouseId=${encodeURIComponent(warehouse)}`,
        warehouse,
      );
      if (scope !== activeScope.current) return;
      setDocDetails((current) => ({ ...current, [id]: detail }));
    }
    setExpandedDocId(id);
  }
  async function loadReports(kind = reportKind, pageNo = reportPage) {
    const w = warehouse;
    const params = new URLSearchParams({
      warehouseId: w,
      kind,
      page: String(pageNo),
      pageSize: String(pageSize),
    });
    Object.entries(reportFilters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });
    const r = await api<{ items: ReportItem[]; total: number }>(
      `/operations/reports?${params.toString()}`,
      w,
    );
    if (scope !== activeScope.current) return;
    setReports(r.items || []);
    setReportTotal(r.total || 0);
    setReportKind(kind);
    setReportPage(pageNo);
  }
  async function loadExports(type: "PO" | "SR" = exportType) {
    const w = warehouse;
    const r = await api<{ items: ExportItem[] }>(
      `/operations/exports?warehouseId=${encodeURIComponent(w)}`,
      w,
    );
    if (scope !== activeScope.current) return;
    setExports(r.items || []);
    const candidates = await api<{ items: DocumentItem[] }>(
      `/operations/exports/eligible?type=${type}`,
      w,
    );
    if (scope !== activeScope.current) return;
    setEligible(candidates.items);
    setSelectedDocs([]);
  }
  async function loadInventory() {
    const result = await api<typeof inventory>(
      "/inventory?limit=200&offset=0",
      warehouse,
    );
    if (scope === activeScope.current) setInventory(result);
  }

  useEffect(() => {
    void authenticate()
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) fail(e);
      })
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    let active = true;
    setOverview(null);
    if (
      page !== "dashboard" ||
      !session ||
      !warehouse ||
      !role ||
      role === "System Admin"
    )
      return;
    setBusy(true);
    loadOverview(warehouse)
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch((e) => {
        if (active) fail(e);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [session, warehouse, role, page]);
  useEffect(() => {
    if (
      !session ||
      !warehouse ||
      !["receiving", "issue", "reports", "export"].includes(page)
    )
      return;
    const timer = window.setInterval(() => {
      if (page === "receiving") void loadDocs("RECEIVING", docPage).catch(fail);
      if (page === "issue") void loadDocs("ISSUE", docPage).catch(fail);
      if (page === "reports" && ["Admin", "Head"].includes(role || ""))
        void loadReports(reportKind, reportPage).catch(fail);
      if (page === "export" && role === "Head") void loadExports().catch(fail);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [
    session,
    warehouse,
    page,
    docPage,
    reportKind,
    reportPage,
    role,
    pageSize,
  ]);

  function submitPayload() {
    const clean = lines.map((l) => ({
      productId: l.productId,
      locationId: l.locationId,
      documentQuantity: Number(l.documentQuantity),
      actualQuantity: Number(l.actualQuantity),
      uom: l.uom,
      ...(l.batch ? { batch: l.batch } : {}),
      ...(l.expiry ? { expiry: l.expiry } : {}),
    }));
    if (
      !clean.length ||
      clean.some(
        (l) =>
          !l.productId ||
          !l.locationId ||
          !Number.isFinite(l.documentQuantity) ||
          !Number.isFinite(l.actualQuantity) ||
          l.documentQuantity < 0 ||
          l.actualQuantity < 0,
      )
    )
      throw new Error(
        "Isi produk, lokasi, dan kuantitas valid untuk semua baris.",
      );
    return {
      warehouseId: warehouse,
      type: docType,
      ...(docType === "RECEIVING" && supplierId ? { supplierId } : {}),
      ...(reference ? { reference } : {}),
      lines: clean,
    };
  }
  function updateLine(index: number, field: keyof DocumentLine, value: string) {
    setLines(lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }
  function canCreate(_type: DocType) {
    return role === "Checker";
  }
  function canVerify(type: DocType) {
    return role === "Admin" || (role === "Head" && type === "RECEIVING");
  }
  function uomOptions(productId: string) {
    const configured =
      master.products.find((p) => p.id === productId)?.uom || "PCS";
    return Array.from(new Set(["PCS", configured]));
  }
  function selectProductConfig(productId: string) {
    const product = master.products.find((p) => p.id === productId);
    setProductConfig({
      id: productId,
      trackBatch: Boolean(product?.trackBatch ?? product?.track_batch),
      trackExpiry: Boolean(product?.trackExpiry ?? product?.track_expiry),
      uom: product?.uom || "PCS",
      uomFactor: Number(product?.uomFactor || 1),
      bigsellerSku: product?.bigsellerSku || "",
      bigsellerRegistered: product?.bigsellerRegistered || false,
    });
  }
  function reportCsvUrl() {
    const params = new URLSearchParams({
      warehouseId: warehouse,
      kind: reportKind,
      page: String(reportPage),
      pageSize: String(pageSize),
      format: "csv",
    });
    Object.entries(reportFilters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });
    return `/api/operations/reports?${params.toString()}`;
  }
  async function createSupplier() {
    const supplier = await mutate<Supplier>("/operations/suppliers", {
      name: newSupplier,
    });
    setMaster({
      ...master,
      suppliers: [...master.suppliers, supplier].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    });
    setSupplierId(supplier.id);
    setNewSupplier("");
    setMessage("Supplier ditambahkan.");
  }
  const docCount = `${docs.length}/${docTotal}`;

  if (boot)
    return (
      <main className="connected-loading" role="status">
        Menghubungkan ke server...
      </main>
    );
  if (!session)
    return (
      <div className="login-page">
        <section className="login-story">
          <div className="brand">
            <span className="brand-mark">b.</span>
            <span>
              buymore<small>WAREHOUSE WORKSPACE</small>
            </span>
          </div>
          <div>
            <span className="eyebrow">RUANG KERJA GUDANG ANDA</span>
            <h1>
              Material teratur.
              <br />
              Tim terhubung.
              <br />
              <em>Kerja lebih tenang.</em>
            </h1>
            <p>
              Dari material pertama datang hingga produksi berjalan. Semua
              tercatat dalam satu workspace.
            </p>
          </div>
          <span className="login-story-footer">
            <Boxes size={18} />
            Dibangun untuk operasional Buymore.
          </span>
        </section>
        <section className="login-form">
          <div className="login-inner">
            <span className="subtle-chip">WAREHOUSE WORKSPACE</span>
            <h2>Selamat datang kembali.</h2>
            <p>Masuk dengan akun gudang Anda untuk melanjutkan.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("/login", undefined, { username, password });
                  setPassword("");
                  await authenticate();
                });
              }}
            >
              <label>
                Username
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {error && (
                <p className="connected-error" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? "Menghubungkan..." : "Masuk ke workspace"}
                <ArrowRight size={18} />
              </button>
            </form>
            <div className="login-notice">
              <ShieldCheck size={21} />
              <p>
                Akses aman sesuai akun dan keanggotaan gudang. Transaksi
                tersimpan di server.
              </p>
            </div>
          </div>
        </section>
      </div>
    );

  return (
    <ConnectedLayout
      session={session}
      warehouse={warehouse}
      setWarehouse={(value) => {
        setWarehouse(value);
        setPage("dashboard");
        setOverview(null);
        setDocs([]);
        setDocDetails({});
        setInventory([]);
        setReports([]);
        setExports([]);
        setMaster({
          products: [],
          locations: [],
          suppliers: [],
          settings: defaultSettings,
        });
        setLines([emptyLine()]);
        setSupplierId("");
        setReference("");
        setSelectedDocs([]);
        setEligible([]);
        setExpandedDocId("");
        setProductConfig({
          id: "",
          trackBatch: false,
          trackExpiry: false,
          uom: "PCS",
          uomFactor: 1,
          bigsellerSku: "",
          bigsellerRegistered: false,
        });
        setError("");
        setMessage("");
      }}
      page={page}
      busy={busy}
      navigate={(next) => {
        if (!allowedConnectedPages(role).includes(next)) return;
        setPage(next);
        setError("");
        setMessage("");
        if (next === "receiving" || next === "issue")
          void run(async () => {
            await loadMaster();
            await loadDocs(next === "receiving" ? "RECEIVING" : "ISSUE", 1);
          });
        if (next === "reports")
          void run(async () => {
            await loadMaster();
            await loadReports(reportKind, 1);
          });
        if (next === "export")
          void run(async () => {
            await loadMaster();
            await loadExports();
          });
        if (next === "settings") void run(loadMaster);
        if (next === "inventory") void run(loadInventory);
      }}
      logout={() =>
        void run(async () => {
          await api("/logout", undefined, {});
          setSession(null);
          setPage("dashboard");
          setOverview(null);
        })
      }
    >
      <header className="page-heading">
        <span className="eyebrow">
          {warehouse || "WORKSPACE"} / {role || "Tanpa akses"}
        </span>
        <h1>
          {page === "dashboard" ? (
            <>
              Semua dalam kendali<span className="green-dot">.</span>
            </>
          ) : (
            connectedNavigation.find((n) => n.id === page)?.label
          )}
        </h1>
        <p>
          {page === "dashboard"
            ? "Selamat datang, " +
              session.user.username +
              ". Ini ringkasan gudang Anda."
            : "Kelola operasional gudang dalam satu workspace."}
        </p>
      </header>
      {(!warehouse || !role || role === "System Admin") && (
        <p className="connected-card">
          Akun belum memiliki akses operasional gudang. Hubungi administrator.
        </p>
      )}
      {page === "dashboard" && warehouse && role && role !== "System Admin" && (
        <>
          <section className="hero-panel">
            <div className="hero-copy">
              <span className="hero-tag">WORKSPACE GUDANG / {warehouse}</span>
              <h2>
                Material teratur.
                <br />
                Tim terhubung.
              </h2>
              <p>Pantau dokumen dan lanjutkan pekerjaan sesuai akses Anda.</p>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setPage("receiving");
                  void run(async () => {
                    await loadMaster();
                    await loadDocs("RECEIVING", 1);
                  });
                }}
              >
                Lihat penerimaan <ArrowRight size={16} />
              </button>
            </div>
            <Boxes
              className="connected-hero-icon"
              size={130}
              aria-hidden="true"
            />
          </section>
          <div className="stats-grid connected-stats">
            {[
              { label: "Dokumen penerimaan", value: overview?.receiving },
              { label: "Dokumen pengeluaran", value: overview?.issue },
              {
                label: "Stock count terbaru (maks. 200)",
                value: overview?.counts,
              },
            ].map((metric) => (
              <article className="stat-card" key={metric.label}>
                <span className="stat-label">{metric.label}</span>
                <strong>
                  {metric.value === undefined
                    ? "?"
                    : metric.value.toLocaleString("id-ID")}
                </strong>
                <p>Sesuai akses akun di {warehouse}</p>
              </article>
            ))}
          </div>
          <section className="connected-card">
            <h2>Pekerjaan gudang, satu tempat.</h2>
            <p>
              Gunakan menu operasional untuk penerimaan, pengeluaran, dan stock
              count. Ringkasan berasal dari dokumen yang diizinkan server; bukan
              saldo stok atau angka demo.
            </p>
            {overview &&
              overview.receiving === 0 &&
              overview.issue === 0 &&
              overview.counts === 0 && (
                <p>Belum ada dokumen yang tersedia di gudang ini.</p>
              )}
            {!overview && !busy && (
              <button
                className="button"
                onClick={() => setSession({ ...session })}
              >
                Muat ulang ringkasan
              </button>
            )}
          </section>
        </>
      )}
      {error && (
        <p className="connected-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Memproses...</p>}

      {(page === "receiving" || page === "issue") && (
        <>
          <section className="connected-card">
            <div className="connected-inline">
              <h2>
                {docType === "RECEIVING" ? "Penerimaan" : "Pengeluaran"} terbaru
                ({docCount})
              </h2>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    loadDocs(
                      page === "receiving" ? "RECEIVING" : "ISSUE",
                      docPage,
                    ),
                  )
                }
              >
                Muat ulang
              </button>
            </div>
            <div className="connected-table">
              <table>
                <thead>
                  <tr>
                    <th>Pilih</th>
                    <th>Dokumen</th>
                    <th>Referensi</th>
                    <th>Status</th>
                    <th>Partner</th>
                    <th>Baris</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => {
                    const detail = docDetails[d.id];
                    const expanded = expandedDocId === d.id;
                    return (
                      <Fragment key={d.id}>
                        <tr>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedDocs.includes(d.id)}
                              onChange={(e) =>
                                setSelectedDocs(
                                  e.target.checked
                                    ? [...selectedDocs, d.id]
                                    : selectedDocs.filter((id) => id !== d.id),
                                )
                              }
                            />
                          </td>
                          <td>
                            <code>{d.id}</code>
                          </td>
                          <td>{d.reference || "-"}</td>
                          <td>{d.status}</td>
                          <td>{d.supplierName || "-"}</td>
                          <td>{d.lineCount ?? "-"}</td>
                          <td className="connected-row-actions">
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run(() => toggleDocDetail(d.id))
                              }
                            >
                              {expanded ? "Tutup detail" : "View detail"}
                            </button>
                            <button
                              disabled={busy || d.status !== "DRAFT"}
                              onClick={() =>
                                void run(async () => {
                                  await mutate(
                                    `/operations/documents/${d.id}/submit`,
                                    { warehouseId: warehouse },
                                  );
                                  await loadDocs(docType, docPage);
                                  setMessage("Dokumen dikirim.");
                                })
                              }
                            >
                              Submit
                            </button>
                            {canVerify(docType) && (
                              <button
                                disabled={busy || d.status !== "PENDING"}
                                onClick={() =>
                                  void run(async () => {
                                    await mutate(
                                      `/operations/documents/${d.id}/verify`,
                                      { warehouseId: warehouse },
                                    );
                                    await loadDocs(docType, docPage);
                                    setMessage("Dokumen terverifikasi.");
                                  })
                                }
                              >
                                Verify
                              </button>
                            )}
                            <button
                              disabled={
                                busy ||
                                !rejectReason.trim() ||
                                !["DRAFT", "PENDING"].includes(d.status)
                              }
                              onClick={() =>
                                void run(async () => {
                                  await mutate(
                                    `/operations/documents/${d.id}/reject`,
                                    {
                                      warehouseId: warehouse,
                                      reason: rejectReason,
                                    },
                                  );
                                  await loadDocs(docType, docPage);
                                  setMessage("Dokumen ditolak.");
                                })
                              }
                            >
                              Reject
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="connected-detail-row">
                            <td colSpan={7}>
                              {detail ? (
                                <div className="connected-doc-detail">
                                  <p>
                                    <strong>{detail.type}</strong> /{" "}
                                    {detail.status} /{" "}
                                    {detail.supplierName || "-"} / Ref{" "}
                                    {detail.reference || "-"}
                                  </p>
                                  <div className="connected-table compact">
                                    <table>
                                      <thead>
                                        <tr>
                                          <th>Produk</th>
                                          <th>Lokasi</th>
                                          <th>Dok</th>
                                          <th>Aktual</th>
                                          <th>UOM</th>
                                          <th>Base</th>
                                          <th>Batch</th>
                                          <th>ED</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {detail.lines.map((line) => (
                                          <tr key={line.id}>
                                            <td>
                                              {line.productId}{" "}
                                              {line.productName
                                                ? `- ${line.productName}`
                                                : ""}
                                              {line.bigsellerSku
                                                ? ` / ${line.bigsellerSku}`
                                                : ""}
                                            </td>
                                            <td>{line.locationId}</td>
                                            <td>{line.documentQuantity}</td>
                                            <td>{line.actualQuantity}</td>
                                            <td>{line.uom}</td>
                                            <td>{line.baseQuantity}</td>
                                            <td>{line.batch || "-"}</td>
                                            <td>
                                              {String(line.expiry || "-").slice(
                                                0,
                                                10,
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : (
                                <p>Memuat detail...</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="connected-actions">
              <label>
                Alasan reject
                <input
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </label>
              <button
                disabled={busy || docPage === 1}
                onClick={() => void run(() => loadDocs(docType, docPage - 1))}
              >
                Sebelumnya
              </button>
              <button
                disabled={busy || docPage * pageSize >= docTotal}
                onClick={() => void run(() => loadDocs(docType, docPage + 1))}
              >
                Berikutnya
              </button>
            </div>
            {!docs.length && <p>Belum ada dokumen.</p>}
          </section>
          {canCreate(docType) && (
            <section className="connected-card">
              <h2>Buat {docType === "RECEIVING" ? "receiving" : "issue"}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await mutate("/operations/documents", submitPayload());
                    setLines([emptyLine()]);
                    setReference("");
                    await loadDocs(docType, 1);
                    setMessage("Draft dokumen tersimpan.");
                  });
                }}
              >
                <div className="connected-inline">
                  {docType === "RECEIVING" && (
                    <>
                      <label>
                        Supplier
                        <select
                          value={supplierId}
                          onChange={(e) => setSupplierId(e.target.value)}
                        >
                          <option value="">Pilih supplier</option>
                          {master.suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {["Admin", "Head"].includes(role || "") && (
                        <label>
                          Supplier baru
                          <input
                            value={newSupplier}
                            onChange={(e) => setNewSupplier(e.target.value)}
                            placeholder="Nama supplier"
                          />
                        </label>
                      )}
                      {["Admin", "Head"].includes(role || "") && (
                        <button
                          type="button"
                          className="button"
                          disabled={busy || !newSupplier.trim()}
                          onClick={() => void run(createSupplier)}
                        >
                          Tambah supplier
                        </button>
                      )}
                    </>
                  )}
                  <label>
                    Referensi
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder={
                        docType === "RECEIVING"
                          ? "Surat jalan"
                          : "Tujuan/alasan"
                      }
                    />
                  </label>
                </div>
                <div className="connected-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Produk</th>
                        <th>Lokasi</th>
                        <th>Dokumen</th>
                        <th>Aktual</th>
                        <th>UoM</th>
                        <th>Batch</th>
                        <th>ED</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i}>
                          <td>
                            <select
                              value={l.productId}
                              onChange={(e) =>
                                updateLine(i, "productId", e.target.value)
                              }
                            >
                              <option value="">Produk</option>
                              {master.products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.sku || p.id} {p.name || ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={l.locationId}
                              onChange={(e) =>
                                updateLine(i, "locationId", e.target.value)
                              }
                            >
                              <option value="">Lokasi</option>
                              {master.locations.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.code || loc.id}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={l.documentQuantity}
                              onChange={(e) =>
                                updateLine(
                                  i,
                                  "documentQuantity",
                                  e.target.value,
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={l.actualQuantity}
                              onChange={(e) =>
                                updateLine(i, "actualQuantity", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <select
                              value={l.uom}
                              onChange={(e) =>
                                updateLine(i, "uom", e.target.value)
                              }
                            >
                              {uomOptions(l.productId).map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              value={l.batch}
                              onChange={(e) =>
                                updateLine(i, "batch", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="date"
                              value={l.expiry}
                              onChange={(e) =>
                                updateLine(i, "expiry", e.target.value)
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="connected-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setLines([...lines, emptyLine()])}
                  >
                    Tambah baris
                  </button>
                  <button className="button primary" disabled={busy}>
                    Simpan draft
                  </button>
                </div>
              </form>
            </section>
          )}
        </>
      )}

      {page === "counts" && (
        <CountWorkspace
          key={warehouse}
          embedded
          parentSession={session}
          parentWarehouse={warehouse}
          onUnauthorized={() => setSession(null)}
        />
      )}
      {page === "reports" && ["Admin", "Head"].includes(role || "") && (
        <section className="connected-card">
          <div className="connected-inline">
            <h2>
              Laporan ({reports.length}/{reportTotal})
            </h2>
            <label>
              Jenis
              <select
                value={reportKind}
                onChange={(e) =>
                  void run(() => loadReports(e.target.value as ReportKind, 1))
                }
              >
                <option value="stock">Stock</option>
                <option value="activity">Activity</option>
              </select>
            </label>
            <button
              className="button"
              onClick={() => {
                location.href = reportCsvUrl();
              }}
            >
              Unduh CSV halaman ini
            </button>
          </div>
          <form
            className="connected-settings"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => loadReports(reportKind, 1));
            }}
          >
            <label>
              Dari
              <input
                type="date"
                value={reportFilters.from}
                disabled={reportKind === "stock"}
                onChange={(e) =>
                  setReportFilters({ ...reportFilters, from: e.target.value })
                }
              />
            </label>
            <label>
              Sampai
              <input
                type="date"
                value={reportFilters.to}
                disabled={reportKind === "stock"}
                onChange={(e) =>
                  setReportFilters({ ...reportFilters, to: e.target.value })
                }
              />
            </label>
            <label>
              Produk
              <select
                value={reportFilters.product}
                onChange={(e) =>
                  setReportFilters({
                    ...reportFilters,
                    product: e.target.value,
                  })
                }
              >
                <option value="">Semua produk</option>
                {master.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku || p.id} {p.name ? `- ${p.name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lokasi
              <select
                value={reportFilters.location}
                onChange={(e) =>
                  setReportFilters({
                    ...reportFilters,
                    location: e.target.value,
                  })
                }
              >
                <option value="">Semua lokasi</option>
                {master.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code || l.id} {l.name ? `- ${l.name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Actor
              <input
                value={reportFilters.actor}
                disabled={reportKind === "stock"}
                placeholder="UUID actor activity"
                onChange={(e) =>
                  setReportFilters({
                    ...reportFilters,
                    actor: e.target.value,
                  })
                }
              />
            </label>
            <button className="button primary" disabled={busy}>
              Terapkan filter
            </button>
          </form>
          <p>
            CSV mengunduh halaman yang sedang tampil, bukan full export. Stock
            menampilkan on-hand lifetime; tanggal dan actor hanya untuk
            activity.
          </p>
          <div className="connected-table">
            <table>
              <thead>
                <tr>
                  {Object.keys(reports[0] || { empty: "" }).map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!reports.length && (
                  <tr>
                    <td colSpan={10}>Belum ada data untuk filter ini.</td>
                  </tr>
                )}
                {reports.map((r, i) => (
                  <tr key={i}>
                    {Object.keys(reports[0] || r).map((k) => (
                      <td key={k}>{String(r[k] ?? "-")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || reportPage === 1}
            onClick={() =>
              void run(() => loadReports(reportKind, reportPage - 1))
            }
          >
            Sebelumnya
          </button>
          <button
            disabled={busy || reportPage * pageSize >= reportTotal}
            onClick={() =>
              void run(() => loadReports(reportKind, reportPage + 1))
            }
          >
            Berikutnya
          </button>
        </section>
      )}
      {page === "export" && role === "Head" && (
        <section className="connected-card">
          <h2>Export batch ({exports.length})</h2>
          {!settings.templates?.[exportType]?.ready && (
            <p className="connected-error">
              {settings.templates?.[exportType]?.message ||
                "Template resmi BigSeller belum tersedia. Konfigurasikan BIGSELLER_TEMPLATE_DIR."}
            </p>
          )}
          {!eligible.length && <p>Belum ada dokumen yang siap diekspor.</p>}
          {eligible.map((d) => (
            <label key={d.id}>
              <input
                type="checkbox"
                checked={selectedDocs.includes(d.id)}
                onChange={(e) =>
                  setSelectedDocs(
                    e.target.checked
                      ? [...selectedDocs, d.id]
                      : selectedDocs.filter((id) => id !== d.id),
                  )
                }
              />
              {d.reference || d.id}
            </label>
          ))}
          <div className="connected-actions">
            <label>
              Tipe
              <select
                value={exportType}
                onChange={(e) => {
                  const type = e.target.value as "PO" | "SR";
                  setExportType(type);
                  void run(() => loadExports(type));
                }}
              >
                <option value="PO">PO receiving</option>
                <option value="SR">Stock reduction</option>
              </select>
            </label>
            <button
              className="button primary"
              disabled={
                busy ||
                !settings.templates?.[exportType]?.ready ||
                !selectedDocs.length
              }
              onClick={() =>
                void run(async () => {
                  await mutate("/operations/exports", {
                    warehouseId: warehouse,
                    type: exportType,
                    documentIds: selectedDocs,
                  });
                  await loadExports();
                  setMessage("Export dibuat.");
                })
              }
            >
              Buat export dari pilihan dokumen
            </button>
          </div>
          <div className="connected-table">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Tipe</th>
                  <th>Status</th>
                  <th>Dokumen</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {!exports.length && (
                  <tr>
                    <td colSpan={7}>Belum ada batch ekspor.</td>
                  </tr>
                )}
                {exports.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <code>{x.id}</code>
                    </td>
                    <td>{x.type}</td>
                    <td>
                      {x.status}
                      <br />
                      <small>{x.checksum}</small>
                    </td>
                    <td>{x.documentCount ?? "-"}</td>
                    <td>
                      <button
                        disabled={busy || !x.fileName}
                        onClick={() => {
                          location.href = `/api/operations/exports/${x.id}/file?warehouseId=${encodeURIComponent(warehouse)}`;
                        }}
                      >
                        Unduh
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {page === "settings" && (
        <section className="connected-card">
          <h2>Pengaturan operasi</h2>
          <form
            className="connected-settings"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const saved = await mutate<OpsSettings>(
                  `/operations/settings?warehouseId=${encodeURIComponent(warehouse)}`,
                  {
                    reportPageSize: settings.reportPageSize,
                    reportDefaultDays: settings.reportDefaultDays,
                    csvDelimiter: settings.csvDelimiter,
                    exportWarehouseName: settings.exportWarehouseName,
                  },
                  "PATCH",
                );
                setSettings({ ...settings, ...saved });
                setMessage("Pengaturan tersimpan.");
              });
            }}
          >
            <label>
              Baris laporan
              <input
                type="number"
                min="1"
                max="500"
                value={settings.reportPageSize}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    reportPageSize: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Default hari laporan
              <input
                type="number"
                min="1"
                max="365"
                value={settings.reportDefaultDays}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    reportDefaultDays: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Delimiter CSV
              <input
                value={settings.csvDelimiter}
                maxLength={3}
                onChange={(e) =>
                  setSettings({ ...settings, csvDelimiter: e.target.value })
                }
              />
            </label>
            <label>
              Nama gudang export
              <input
                value={settings.exportWarehouseName}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    exportWarehouseName: e.target.value,
                  })
                }
              />
            </label>
            <label className="connected-check">
              <input
                type="checkbox"
                checked={settings.bigsellerTemplateConfirmed}
                disabled
                readOnly
              />
              Kesiapan template terdeteksi server (bukan konfirmasi manual)
            </label>
            <button
              className="button primary"
              disabled={busy || !["Head", "Admin"].includes(role || "")}
            >
              Simpan settings
            </button>
          </form>
          {role === "Head" && (
            <div>
              <label>
                Supplier baru
                <input
                  value={newSupplier}
                  onChange={(e) => setNewSupplier(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !newSupplier.trim()}
                onClick={() => void run(createSupplier)}
              >
                Tambah supplier
              </button>
            </div>
          )}
          <h3>Konfigurasi produk master</h3>
          <p>
            Tracking dan konversi global hanya-baca. Pemetaan SKU dan konfirmasi
            registrasi berlaku hanya untuk gudang aktif, dikelola Head.
          </p>
          <form
            className="connected-settings"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (!productConfig.id) throw new Error("Pilih produk dulu.");
                const saved = await mutate<Product>(
                  `/operations/products/${encodeURIComponent(productConfig.id)}`,
                  {
                    bigsellerRegistered: productConfig.bigsellerRegistered,
                    bigsellerSku: productConfig.bigsellerSku || null,
                  },
                  "PATCH",
                );
                setMaster({
                  ...master,
                  products: master.products.map((p) =>
                    p.id === saved.id ? { ...p, ...saved } : p,
                  ),
                });
                selectProductConfig(saved.id);
                setMessage("Konfigurasi produk tersimpan.");
              });
            }}
          >
            <label>
              Produk
              <select
                value={productConfig.id}
                onChange={(e) => selectProductConfig(e.target.value)}
              >
                <option value="">Pilih produk</option>
                {master.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku || p.id} {p.name ? `- ${p.name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="connected-check">
              <input
                type="checkbox"
                disabled
                checked={productConfig.trackBatch}
                onChange={(e) =>
                  setProductConfig({
                    ...productConfig,
                    trackBatch: e.target.checked,
                    trackExpiry: e.target.checked
                      ? productConfig.trackExpiry
                      : false,
                  })
                }
              />
              Track batch
            </label>
            <label className="connected-check">
              <input
                type="checkbox"
                checked={productConfig.trackExpiry}
                disabled
                onChange={(e) =>
                  setProductConfig({
                    ...productConfig,
                    trackExpiry: e.target.checked,
                  })
                }
              />
              Track expiry
            </label>
            <label>
              UOM
              <input
                disabled
                value={productConfig.uom}
                maxLength={20}
                onChange={(e) =>
                  setProductConfig({ ...productConfig, uom: e.target.value })
                }
              />
            </label>
            <label>
              UOM factor
              <input
                type="number"
                min="1"
                max="1000000"
                disabled
                value={productConfig.uomFactor}
                onChange={(e) =>
                  setProductConfig({
                    ...productConfig,
                    uomFactor: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={productConfig.bigsellerRegistered}
                onChange={(e) =>
                  setProductConfig({
                    ...productConfig,
                    bigsellerRegistered: e.target.checked,
                  })
                }
              />
              SKU sudah terdaftar di BigSeller
            </label>
            <label>
              BigSeller SKU
              <input
                value={productConfig.bigsellerSku}
                onChange={(e) =>
                  setProductConfig({
                    ...productConfig,
                    bigsellerSku: e.target.value,
                  })
                }
              />
            </label>
            <button
              className="button primary"
              disabled={busy || role !== "Head"}
            >
              Simpan konfigurasi produk
            </button>
          </form>
        </section>
      )}
      {page === "inventory" && (
        <section className="connected-card">
          <h2>Inventori ({inventory.length})</h2>
          <div className="connected-table">
            <table>
              <thead>
                <tr>
                  <th>Lokasi</th>
                  <th>Produk</th>
                  <th>Batch</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {!inventory.length && (
                  <tr>
                    <td colSpan={4}>
                      Belum ada saldo inventori di gudang ini.
                    </td>
                  </tr>
                )}
                {inventory.map((l, i) => (
                  <tr key={i}>
                    <td>{l.location}</td>
                    <td>{l.product}</td>
                    <td>{l.batch || "-"}</td>
                    <td>{l.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </ConnectedLayout>
  );
}

export function ConnectedWorkspace() {
  return <OperationsWorkspace />;
}
