import { useEffect, useRef, useState } from "react";
import { api, type AuthSession } from "../services/api";
import { Camera, Boxes, LogOut, Search, ShieldCheck } from "lucide-react";
import "../inspection.css";
type Product = { code: string; name: string; uom: string; uom_factor: number };
type Catalog = {
  products: Product[];
  locations: { id: string }[];
  batches: { product: string; batch: string }[];
  balances: {
    location: string;
    product: string;
    batch: string;
    quantity: number;
  }[];
};
type Inspection = {
  id: string;
  product: string;
  name: string;
  location: string;
  batch: string;
  quantity: number;
  unit: string;
  snapshot: number;
  base_quantity: number;
  status: string;
  username: string;
  photo: string;
  reason?: string;
};
const empty: Catalog = {
  products: [],
  locations: [],
  batches: [],
  balances: [],
};
export function InspectionWorkspace() {
  const [session, setSession] = useState<AuthSession | null>(null),
    [boot, setBoot] = useState(true),
    [warehouse, setWarehouse] = useState(""),
    [catalog, setCatalog] = useState<Catalog>(empty),
    [inspections, setInspections] = useState<Inspection[]>([]),
    [users, setUsers] = useState<
      { id: string; username: string; role: string }[]
    >([]);
  const [tab, setTab] = useState("inspect"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Product | null>(null),
    [location, setLocation] = useState(""),
    [batch, setBatch] = useState(""),
    [quantity, setQuantity] = useState(""),
    [unit, setUnit] = useState("PCS"),
    [capture, setCapture] = useState(""),
    [camera, setCamera] = useState(false),
    [photoView, setPhotoView] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    pending = useRef(new Map<string, string>()),
    uploaded = useRef<{
      capture: string;
      warehouse: string;
      id: string;
    } | null>(null);
  const [edit, setEdit] = useState({
      code: "",
      name: "",
      unit: "PCS",
      factor: "1",
    }),
    [newUser, setNewUser] = useState({
      username: "",
      password: "",
      role: "User",
    }),
    [newLocation, setNewLocation] = useState("");
  const [file, setFile] = useState<{ content: string; format: string } | null>(
      null,
    ),
    [preview, setPreview] = useState<{
      headers: string[];
      rows: string[][];
      rowCount: number;
    } | null>(null),
    [mapping, setMapping] = useState({
      code: "",
      name: "",
      unit: "",
      quantity: "",
    }),
    [defaultUnit, setDefaultUnit] = useState("PCS"),
    [defaultFactor, setDefaultFactor] = useState("1"),
    [opening, setOpening] = useState(false),
    [reviewReason, setReviewReason] = useState("");
  const role = session?.memberships.find(
      (m) => m.warehouse === warehouse,
    )?.role,
    admin = role === "Admin";
  function stopCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }
  useEffect(() => {
    api<AuthSession>("/session")
      .then((s) => {
        setSession(s);
        setWarehouse(s.memberships[0]?.warehouse || "");
      })
      .catch(() => {})
      .finally(() => setBoot(false));
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);
  async function load() {
    if (!warehouse) return;
    const [c, i] = await Promise.all([
      api<Catalog>("/workspace/catalog", warehouse),
      api<Inspection[]>("/workspace/inspections", warehouse),
    ]);
    setCatalog(c);
    setInspections(i);
    setLocation((l) =>
      c.locations.some((x) => x.id === l) ? l : c.locations[0]?.id || "",
    );
    if (admin) setUsers(await api("/workspace/users", warehouse));
  }
  useEffect(() => {
    setSelected(null);
    setCapture("");
    setPhotoView("");
    setCatalog(empty);
    setInspections([]);
    setUsers([]);
    setTab("inspect");
    stopCamera();
    if (session && warehouse) load().catch((e) => setError(e.message));
  }, [warehouse, session]);
  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      video.current
        .play()
        .catch(() =>
          setError("Kamera tidak dapat diputar. Periksa izin browser."),
        );
    }
  }, [camera]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Permintaan gagal");
    } finally {
      setBusy(false);
    }
  }
  async function mutate<T>(path: string, input: unknown): Promise<T> {
    const fingerprint = JSON.stringify([warehouse, path, input]);
    let key = pending.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      pending.current.set(fingerprint, key);
    }
    const result = await api<T>(path, warehouse, input, key);
    pending.current.delete(fingerprint);
    return result;
  }
  async function startCamera() {
    setCapture("");
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Live photo memerlukan HTTPS (atau localhost) dan browser dengan akses kamera.",
      );
    stream.current = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
    setCamera(true);
  }
  function takePhoto() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / v.videoWidth);
    canvas.width = v.videoWidth * scale;
    canvas.height = v.videoHeight * scale;
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    setCapture(canvas.toDataURL("image/jpeg", 0.8));
    stopCamera();
  }
  if (boot)
    return (
      <main className="inspection-app">
        <p>Memuat workspace...</p>
      </main>
    );
  if (!session)
    return (
      <main className="inspection-login">
        <div className="inspection-brand">
          <Boxes />
          <span>BUYMORE / WAREHOUSE</span>
        </div>
        <h1>
          Stok akurat.
          <br />
          Bukti nyata.
        </h1>
        <p>
          Master BigSeller, inspeksi langsung, dan persetujuan Admin dalam satu
          workspace.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api("/login", undefined, {
                username,
                password,
              });
              const s = await api<AuthSession>("/session");
              setSession(s);
              setWarehouse(s.memberships[0]?.warehouse || "");
              setPassword("");
            });
          }}
        >
          <label>
            Username
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>Masuk workspace</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <div className="inspection-app">
      <header className="inspection-header">
        <div className="inspection-brand">
          <Boxes />
          <strong>BUYMORE</strong>
          <span>WAREHOUSE</span>
        </div>
        <select
          aria-label="Gudang"
          value={warehouse}
          onChange={(e) => setWarehouse(e.target.value)}
        >
          {session.memberships.map((m) => (
            <option key={m.warehouse}>{m.warehouse}</option>
          ))}
        </select>
        <span>
          {session.user.username} / {role}
        </span>
        <button
          aria-label="Keluar"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api("/logout", warehouse, {});
              stopCamera();
              setSession(null);
              setCatalog(empty);
              setInspections([]);
              setPhotoView("");
            })
          }
        >
          <LogOut size={18} />
        </button>
      </header>
      <section className="inspection-hero">
        <div>
          <p className="inspection-eyebrow">LIVE INVENTORY / {warehouse}</p>
          <h1>
            {admin
              ? "Kendali stok, tanpa kerumitan."
              : "Periksa barang. Catat yang nyata."}
          </h1>
          <p>
            {admin
              ? "Kelola master, tim, dan hasil inspeksi dari satu tempat."
              : "SKU dan nama dikunci. Pilih satuan, isi stok teramati, lalu ambil foto langsung."}
          </p>
        </div>
        <div className="inspection-metric">
          <strong>{catalog.products.length}</strong>
          <span>SKU aktif</span>
        </div>
      </section>
      <aside className="inspection-assumption">
        <ShieldCheck size={18} />
        <span>
          Asumsi untuk ditinjau: stok resmi berubah setelah persetujuan Admin.
          User memilih satuan yang ditetapkan Admin, bukan mengubah konversi.
        </span>
      </aside>
      <nav className="inspection-tabs">
        {[
          ["inspect", "Inspeksi stok"],
          ["history", admin ? "Tinjau inspeksi" : "Riwayat saya"],
          ...(admin
            ? [
                ["master", "Master & impor"],
                ["users", "Pengguna"],
              ]
            : []),
        ].map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => {
              setTab(id);
              stopCamera();
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="inspection-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="inspection-notice" role="status">
          {notice}
        </div>
      )}
      {tab === "inspect" && (
        <section className="inspection-grid">
          <div>
            <div className="inspection-search">
              <Search size={18} />
              <input
                placeholder="Cari SKU atau nama barang"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="inspection-products">
              {catalog.products
                .filter((p) =>
                  `${p.code} ${p.name}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((p) => (
                  <button
                    className={selected?.code === p.code ? "selected" : ""}
                    key={p.code}
                    onClick={() => {
                      stopCamera();
                      setSelected(p);
                      setUnit(p.uom);
                      setQuantity("");
                      setBatch(
                        catalog.batches.find((b) => b.product === p.code)
                          ?.batch || "",
                      );
                      setCapture("");
                    }}
                  >
                    <span className="inspection-sku">{p.code}</span>
                    <strong>{p.name}</strong>
                    <span>
                      {p.uom} / {p.uom_factor} PCS
                    </span>
                  </button>
                ))}
              {!catalog.products.length && (
                <p>
                  Master belum tersedia. Admin dapat mengimpor ekspor master
                  BigSeller.
                </p>
              )}
            </div>
          </div>
          <article className="inspection-card">
            {selected ? (
              <>
                <p className="inspection-eyebrow">INSPEKSI BARANG</p>
                <h2>{selected.name}</h2>
                <p>
                  SKU: <strong>{selected.code}</strong> (hanya baca)
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      if (!capture)
                        throw new Error("Ambil live photo terlebih dahulu.");
                      const photo =
                        uploaded.current?.capture === capture &&
                        uploaded.current.warehouse === warehouse
                          ? uploaded.current
                          : await mutate<{ id: string }>("/workspace/photos", {
                              mime: "image/jpeg",
                              content: capture.split(",")[1],
                            });
                      uploaded.current = { capture, warehouse, id: photo.id };
                      await mutate("/workspace/inspections", {
                        product: selected.code,
                        location,
                        batch,
                        quantity: Number(quantity),
                        unit,
                        photo: photo.id,
                      });
                      setCapture("");
                      uploaded.current = null;
                      setQuantity("");
                      await load();
                      setNotice(
                        "Inspeksi terkirim. Menunggu persetujuan Admin.",
                      );
                    });
                  }}
                >
                  <label>
                    Lokasi
                    <select
                      required
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    >
                      {catalog.locations.map((l) => (
                        <option key={l.id}>{l.id}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Batch
                    <select
                      value={batch}
                      onChange={(e) => setBatch(e.target.value)}
                    >
                      {catalog.batches
                        .filter((b) => b.product === selected.code)
                        .map((b) => (
                          <option key={b.batch} value={b.batch}>
                            {b.batch || "Tanpa batch"}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p>
                    Stok resmi:{" "}
                    <strong>
                      {catalog.balances.find(
                        (b) =>
                          b.product === selected.code &&
                          b.location === location &&
                          b.batch === batch,
                      )?.quantity || 0}{" "}
                      PCS
                    </strong>
                  </p>
                  <div className="inspection-fields">
                    <label>
                      Stok teramati
                      <input
                        required
                        type="number"
                        min="0"
                        max="2147483647"
                        step="1"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                    </label>
                    <label>
                      Satuan
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                      >
                        {[...new Set(["PCS", selected.uom])].map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="inspection-camera">
                    {camera && <video ref={video} autoPlay muted playsInline />}
                    {capture && <img src={capture} alt="Live photo inspeksi" />}
                    {!camera && !capture && (
                      <p>
                        <Camera /> Foto langsung dari kamera, bukan unggahan
                        galeri.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(startCamera)}
                    >
                      {capture ? "Ambil ulang" : "Buka kamera"}
                    </button>
                    {camera && (
                      <button type="button" onClick={takePhoto}>
                        Ambil foto
                      </button>
                    )}
                  </div>
                  <button disabled={busy || !capture || !location}>
                    Kirim untuk persetujuan
                  </button>
                </form>
              </>
            ) : (
              <>
                <Camera size={40} />
                <h2>Pilih barang untuk mulai</h2>
                <p>
                  Semua master tetap hanya-baca untuk User. Perubahan stok
                  tercatat bersama bukti foto.
                </p>
              </>
            )}
          </article>
        </section>
      )}
      {tab === "history" && (
        <section className="inspection-card">
          <h2>
            {admin ? "Hasil inspeksi & persetujuan" : "Riwayat inspeksi Anda"}
          </h2>
          <button disabled={busy} onClick={() => run(load)}>
            Muat ulang
          </button>
          {admin && (
            <label>
              Alasan review
              <input
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                placeholder="Wajib untuk setujui atau tolak"
              />
            </label>
          )}
          <div className="inspection-table">
            <table>
              <thead>
                <tr>
                  <th>Barang / lokasi</th>
                  <th>Teramati</th>
                  <th>Snapshot</th>
                  <th>Status</th>
                  <th>Bukti / tindakan</th>
                </tr>
              </thead>
              <tbody>
                {inspections.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.name}</strong>
                      <br />
                      {i.product} / {i.location} {i.batch}
                      <br />
                      {i.username}
                    </td>
                    <td>
                      {i.quantity} {i.unit}
                      <br />
                      {i.base_quantity} PCS
                    </td>
                    <td>{i.snapshot} PCS</td>
                    <td>
                      {i.status}
                      <br />
                      {i.reason}
                    </td>
                    <td>
                      <button
                        onClick={() =>
                          run(async () => {
                            const p = await api<{
                              mime: string;
                              content: string;
                            }>(`/workspace/photos/${i.photo}`, warehouse);
                            setPhotoView(`data:${p.mime};base64,${p.content}`);
                          })
                        }
                      >
                        Lihat foto
                      </button>
                      {admin &&
                        i.status === "PENDING" &&
                        ["approve", "reject"].map((action) => (
                          <button
                            disabled={busy || !reviewReason.trim()}
                            key={action}
                            onClick={() =>
                              run(async () => {
                                await mutate(
                                  `/workspace/inspections/${i.id}/${action}`,
                                  { reason: reviewReason },
                                );
                                await load();
                                setNotice(
                                  action === "approve"
                                    ? "Stok resmi diperbarui."
                                    : "Inspeksi ditolak.",
                                );
                              })
                            }
                          >
                            {action === "approve" ? "Setujui" : "Tolak"}
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!inspections.length && <p>Belum ada inspeksi.</p>}
          {photoView && (
            <div>
              <button onClick={() => setPhotoView("")}>Tutup foto</button>
              <img
                className="inspection-evidence"
                src={photoView}
                alt="Bukti foto inspeksi"
              />
            </div>
          )}
        </section>
      )}
      {admin && tab === "users" && (
        <section className="inspection-grid">
          <article className="inspection-card">
            <h2>Tambah pengguna</h2>
            <p>
              Akses hanya untuk gudang aktif. Username harus baru; akun gudang
              lain tidak diambil alih.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await mutate("/workspace/users", newUser);
                  setNewUser({ username: "", password: "", role: "User" });
                  await load();
                  setNotice("Pengguna dibuat.");
                });
              }}
            >
              <label>
                Username
                <input
                  required
                  value={newUser.username}
                  onChange={(e) =>
                    setNewUser({ ...newUser, username: e.target.value })
                  }
                />
              </label>
              <label>
                Password (minimal 16 karakter)
                <input
                  required
                  type="password"
                  minLength={16}
                  maxLength={256}
                  autoComplete="new-password"
                  value={newUser.password}
                  onChange={(e) =>
                    setNewUser({ ...newUser, password: e.target.value })
                  }
                />
              </label>
              <label>
                Peran
                <select
                  value={newUser.role}
                  onChange={(e) =>
                    setNewUser({ ...newUser, role: e.target.value })
                  }
                >
                  <option>User</option>
                  <option>Admin</option>
                </select>
              </label>
              <button disabled={busy}>Buat pengguna</button>
            </form>
          </article>
          <article className="inspection-card">
            <h2>Tim gudang</h2>
            {users.map((u) => (
              <p key={u.id}>
                <strong>{u.username}</strong> / {u.role}
              </p>
            ))}
          </article>
        </section>
      )}
      {admin && tab === "master" && (
        <section className="inspection-grid">
          <article className="inspection-card">
            <h2>Master barang</h2>
            <p>
              Kode SKU adalah identitas tetap. Konversi yang memiliki riwayat
              tidak dapat diubah; gunakan SKU baru.
            </p>
            <select
              aria-label="Pilih master untuk diedit"
              value={edit.code}
              onChange={(e) => {
                const p = catalog.products.find(
                  (p) => p.code === e.target.value,
                );
                setEdit(
                  p
                    ? {
                        code: p.code,
                        name: p.name,
                        unit: p.uom,
                        factor: String(p.uom_factor),
                      }
                    : { code: "", name: "", unit: "PCS", factor: "1" },
                );
              }}
            >
              <option value="">Barang baru</option>
              {catalog.products.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} / {p.name}
                </option>
              ))}
            </select>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await mutate("/workspace/products", {
                    ...edit,
                    factor: Number(edit.factor),
                  });
                  await load();
                  setNotice("Master disimpan.");
                });
              }}
            >
              <label>
                SKU
                <input
                  required
                  value={edit.code}
                  onChange={(e) => setEdit({ ...edit, code: e.target.value })}
                />
              </label>
              <label>
                Nama
                <input
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label>
                Satuan
                <input
                  required
                  value={edit.unit}
                  onChange={(e) => setEdit({ ...edit, unit: e.target.value })}
                />
              </label>
              <label>
                PCS per satuan
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={edit.factor}
                  onChange={(e) => setEdit({ ...edit, factor: e.target.value })}
                />
              </label>
              <button disabled={busy}>Simpan master</button>
            </form>
            <h3>Lokasi gudang</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await mutate("/workspace/locations", {
                    location: newLocation,
                  });
                  setNewLocation("");
                  await load();
                });
              }}
            >
              <label>
                Lokasi baru
                <input
                  required
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                />
              </label>
              <button disabled={busy}>Tambah lokasi</button>
            </form>
          </article>
          <article className="inspection-card">
            <h2>Impor awal BigSeller</h2>
            <p>
              Gunakan ekspor master produk, bukan template PO/SR. Maksimal 2 MB
              / 2.000 baris. Sampel master resmi belum tersedia; periksa
              pemetaan dan pratinjau sebelum impor.
            </p>
            <label>
              File XLSX / CSV
              <input
                type="file"
                accept=".xlsx,.csv"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPreview(null);
                  setFile(null);
                  if (!f) return;
                  run(async () => {
                    if (f.size > 2097152) throw new Error("Maksimal 2 MB");
                    const content = await new Promise<string>(
                      (resolve, reject) => {
                        const r = new FileReader();
                        r.onload = () =>
                          resolve(String(r.result).split(",")[1]);
                        r.onerror = reject;
                        r.readAsDataURL(f);
                      },
                    );
                    const next = {
                      content,
                      format: f.name.toLowerCase().endsWith(".csv")
                        ? "csv"
                        : "xlsx",
                    };
                    const p = await api<{
                      headers: string[];
                      rows: string[][];
                      rowCount: number;
                    }>("/workspace/import/preview", warehouse, next);
                    setFile(next);
                    setPreview(p);
                    setMapping({ code: "", name: "", unit: "", quantity: "" });
                  });
                }}
              />
            </label>
            {preview && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await mutate("/workspace/import", {
                      ...file,
                      mapping,
                      defaultUnit,
                      defaultFactor: Number(defaultFactor),
                      opening,
                      location,
                    });
                    setPreview(null);
                    setFile(null);
                    await load();
                    setNotice(
                      "Impor berhasil, seluruh baris tersimpan secara atomik.",
                    );
                  });
                }}
              >
                <p>{preview.rowCount} baris / pratinjau 10 baris pertama</p>
                {(
                  [
                    ["code", "Kolom SKU"],
                    ["name", "Kolom nama"],
                    ["unit", "Kolom satuan (opsional)"],
                    ["quantity", "Kolom stok awal"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select
                      required={
                        key === "code" ||
                        key === "name" ||
                        (key === "quantity" && opening)
                      }
                      value={mapping[key]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [key]: e.target.value })
                      }
                    >
                      <option value="">Pilih kolom</option>
                      {preview.headers.filter(Boolean).map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  Satuan default
                  <input
                    required
                    value={defaultUnit}
                    onChange={(e) => setDefaultUnit(e.target.value)}
                  />
                </label>
                <label>
                  PCS per satuan (berlaku untuk semua baris)
                  <input
                    required
                    type="number"
                    min="1"
                    step="1"
                    value={defaultFactor}
                    onChange={(e) => setDefaultFactor(e.target.value)}
                  />
                </label>
                <label className="inspection-check">
                  <input
                    type="checkbox"
                    checked={opening}
                    onChange={(e) => setOpening(e.target.checked)}
                  />{" "}
                  Impor stok awal juga (hanya SKU tanpa mutasi sebelumnya)
                </label>
                {opening && (
                  <label>
                    Lokasi stok awal
                    <select
                      required
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    >
                      <option value="">Pilih lokasi</option>
                      {catalog.locations.map((l) => (
                        <option key={l.id}>{l.id}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="inspection-table">
                  <table>
                    <thead>
                      <tr>
                        {preview.headers.map((h, i) => (
                          <th key={i}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((v, j) => (
                            <td key={j}>{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button disabled={busy}>
                  Konfirmasi impor{" "}
                  {opening ? "master + stok awal" : "master saja"}
                </button>
              </form>
            )}
          </article>
        </section>
      )}
      <footer className="inspection-footer">
        BUYMORE / SKU dan riwayat stok tetap terlacak. Foto tersimpan privat,
        bukan tautan publik.
      </footer>
    </div>
  );
}
