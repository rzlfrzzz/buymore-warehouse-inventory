import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardCheck,
  ShieldCheck,
  ChartNoAxesCombined,
  Settings2,
  LogOut,
  ChevronsUpDown,
  ArrowUpRight,
  Menu,
  X,
  Search,
  Bell,
  Warehouse as WarehouseIcon,
  Download,
} from "lucide-react";
import { allowedPages, type Page } from "../permissions";
import {
  people,
  roles,
  shiftAt,
  warehouses,
  type Session,
  type Warehouse,
  type Role,
} from "../services/warehouse";
export const navigation = [
  {
    id: "dashboard",
    label: "Ringkasan",
    icon: LayoutDashboard,
    group: "WORKSPACE",
  },
  { id: "inventory", label: "Inventori", icon: Boxes, group: "OPERASIONAL" },
  { id: "receiving", label: "Penerimaan", icon: ArrowDownToLine },
  { id: "issue", label: "Pengeluaran", icon: ArrowUpFromLine },
  { id: "stock-count", label: "Stock count", icon: ClipboardCheck },
  { id: "approval", label: "Persetujuan", icon: ShieldCheck },
  {
    id: "reports",
    label: "Laporan & audit",
    icon: ChartNoAxesCombined,
    group: "PENGELOLAAN",
  },
  { id: "export", label: "Ekspor BigSeller", icon: Download },
  { id: "settings", label: "Pengaturan", icon: Settings2 },
] as const;
export function WorkspaceLayout({
  page,
  navigate,
  session,
  setSession,
  logout,
  pending,
  children,
  search,
  setSearch,
}: {
  page: Page;
  navigate: (page: Page) => void;
  session: Session;
  setSession: (session: Session) => void;
  logout: () => void;
  pending: number;
  children: ReactNode;
  search: string;
  setSearch: (v: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const user = people[session.role];
  return (
    <div className="workspace">
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Tutup navigasi"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          className="brand"
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            navigate(allowedPages(session.role)[0]);
          }}
        >
          <span className="brand-mark">
            b<span>.</span>
          </span>
          <span>
            buymore<small>WAREHOUSE WORKSPACE</small>
          </span>
        </a>
        <button
          className="mobile-close icon-button"
          aria-label="Tutup menu"
          onClick={() => setMenu(false)}
        >
          <X size={20} />
        </button>
        <div className="warehouse-select">
          <WarehouseIcon size={20} />
          <label>
            <span>GUDANG AKTIF</span>
            <select
              aria-label="Gudang aktif"
              value={session.warehouse}
              onChange={(e) =>
                setSession({
                  ...session,
                  warehouse: e.target.value as Warehouse,
                })
              }
            >
              {Object.entries(warehouses).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <ChevronsUpDown size={14} />
        </div>
        <nav>
          {navigation
            .filter((n) => allowedPages(session.role).includes(n.id))
            .map((n) => (
              <div key={n.id}>
                {"group" in n && <p className="nav-group">{n.group}</p>}
                <button
                  className={`nav-item ${page === n.id ? "active" : ""}`}
                  onClick={() => {
                    navigate(n.id);
                    setMenu(false);
                  }}
                >
                  <n.icon size={19} />
                  <span>{n.label}</span>
                  {n.id === "approval" && pending > 0 && (
                    <b className="nav-count">{pending}</b>
                  )}
                </button>
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-card">
            <div>
              <span className="online-dot" />
              DEMO WORKSPACE
              <ArrowUpRight size={15} />
            </div>
            <p>Kenali alur, coba tiap peran.</p>
            <label className="sr-only" htmlFor="role-switch">
              Peran demo
            </label>
            <select
              id="role-switch"
              value={session.role}
              onChange={(e) =>
                setSession({ ...session, role: e.target.value as Role })
              }
            >
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="profile">
            <span className="avatar">{user.initials}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.title}</small>
            </div>
            <button
              aria-label="Keluar dari demo"
              className="icon-button"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-toggle"
              aria-label="Buka menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{navigation.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={16} />
              <input
                aria-label="Cari pada halaman"
                placeholder="Cari di halaman ini..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>/</kbd>
            </label>
            <span className="shift-pill">
              <span className="online-dot" />
              {shiftAt()}
            </span>
            {allowedPages(session.role).includes("approval") && (
              <button
                className="notification icon-button"
                aria-label={`${pending} dokumen menunggu persetujuan`}
                onClick={() => navigate("approval")}
              >
                <Bell size={19} />
                {pending > 0 && <i />}
              </button>
            )}
            <span className="avatar small">{user.initials}</span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="page-footer">
          <span>
            Buymore Workspace{" "}
            <span className="muted">
              / Kontrol lebih baik, kerja lebih tenang.
            </span>
          </span>
          <span>
            <span className="online-dot" /> Data demo lokal
          </span>
        </footer>
      </div>
    </div>
  );
}
