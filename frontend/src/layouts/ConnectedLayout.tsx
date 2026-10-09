import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  ChartNoAxesCombined,
  Download,
  Settings2,
  LogOut,
  Menu,
  X,
  Warehouse,
} from "lucide-react";
import type { AuthSession } from "../services/api";

export const connectedNavigation = [
  {
    id: "dashboard",
    label: "Ringkasan",
    icon: LayoutDashboard,
    group: "WORKSPACE",
  },
  { id: "inventory", label: "Inventori", icon: Boxes, group: "OPERASIONAL" },
  { id: "receiving", label: "Penerimaan", icon: ArrowDownToLine },
  { id: "issue", label: "Pengeluaran", icon: ArrowUpFromLine },
  { id: "counts", label: "Stock count", icon: ClipboardCheck },
  {
    id: "reports",
    label: "Laporan & audit",
    icon: ChartNoAxesCombined,
    group: "PENGELOLAAN",
  },
  { id: "export", label: "Ekspor BigSeller", icon: Download },
  { id: "settings", label: "Pengaturan", icon: Settings2 },
] as const;
export type ConnectedPage = (typeof connectedNavigation)[number]["id"];
export function allowedConnectedPages(role?: string): ConnectedPage[] {
  return role === "Admin"
    ? connectedNavigation.map((item) => item.id)
    : ["counts"];
}
export function ConnectedLayout({
  session,
  warehouse,
  setWarehouse,
  page,
  navigate,
  logout,
  busy,
  children,
  inspectionMode = false,
}: {
  session: AuthSession;
  warehouse: string;
  setWarehouse: (value: string) => void;
  page: ConnectedPage;
  navigate: (page: ConnectedPage) => void;
  logout: () => void;
  busy: boolean;
  children: ReactNode;
  inspectionMode?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const role = session.memberships.find((m) => m.warehouse === warehouse)?.role;
  const navigation = inspectionMode
    ? ([
        {
          id: "counts",
          label: "Inspeksi stok",
          icon: ClipboardCheck,
          group: "WORKSPACE",
        },
        {
          id: "reports",
          label: role === "Admin" ? "Tinjau inspeksi" : "Riwayat saya",
          icon: ChartNoAxesCombined,
        },
        ...(role === "Admin"
          ? [
              {
                id: "inventory",
                label: "Master & impor",
                icon: Boxes,
                group: "PENGELOLAAN",
              },
              { id: "export", label: "Ekspor PO / SR", icon: Download },
              { id: "settings", label: "Pengguna", icon: Settings2 },
            ]
          : []),
      ] as {
        id: ConnectedPage;
        label: string;
        icon: typeof Boxes;
        group?: string;
      }[])
    : connectedNavigation;
  const pages = inspectionMode
    ? navigation.map((n) => n.id)
    : allowedConnectedPages(role);
  useEffect(() => {
    if (!menu) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), select:not(:disabled), a[href]",
        ) || [],
      );
    focusable()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const desktop = window.matchMedia("(min-width: 761px)");
    const close = () => {
      if (desktop.matches) setMenu(false);
    };
    desktop.addEventListener("change", close);
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", handle);
      desktop.removeEventListener("change", close);
      trigger.current?.focus();
    };
  }, [menu]);
  return (
    <div className="workspace connected-workspace">
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Tutup navigasi"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className={`sidebar ${menu ? "open" : ""}`}
        role={menu ? "dialog" : undefined}
        aria-modal={menu || undefined}
        aria-label="Navigasi workspace"
      >
        <div className="brand">
          <span className="brand-mark">
            b<span>.</span>
          </span>
          <span>
            buymore<small>WAREHOUSE WORKSPACE</small>
          </span>
        </div>
        <button
          className="mobile-close icon-button"
          aria-label="Tutup menu"
          onClick={() => setMenu(false)}
        >
          <X size={20} />
        </button>
        <div className="warehouse-select">
          <Warehouse size={20} />
          <label>
            <span>GUDANG AKTIF</span>
            <select
              aria-label="Gudang aktif"
              value={warehouse}
              disabled={busy || !session.memberships.length}
              onChange={(e) => setWarehouse(e.target.value)}
            >
              {session.memberships.map((m) => (
                <option key={m.warehouse} value={m.warehouse}>
                  {m.warehouse}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav aria-label="Menu utama">
          {navigation
            .filter((n) => pages.includes(n.id))
            .map((n) => (
              <div key={n.id}>
                {"group" in n && <p className="nav-group">{n.group}</p>}
                <button
                  className={`nav-item ${page === n.id ? "active" : ""}`}
                  aria-current={page === n.id ? "page" : undefined}
                  disabled={busy}
                  onClick={() => {
                    navigate(n.id);
                    setMenu(false);
                  }}
                >
                  <n.icon size={19} />
                  <span>{n.label}</span>
                </button>
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connected-session-note">
            <span className="online-dot" /> WORKSPACE TERHUBUNG
            <p>Akses sesuai keanggotaan gudang Anda.</p>
          </div>
          <div className="profile">
            <span className="avatar">
              {session.user.username.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{session.user.username}</strong>
              <small>{role || "Tanpa akses"}</small>
            </div>
            <button
              aria-label="Keluar"
              className="icon-button"
              disabled={busy}
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={menu || undefined}>
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              ref={trigger}
              className="icon-button mobile-toggle"
              aria-label="Buka menu"
              aria-expanded={menu}
              aria-controls="workspace-navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{navigation.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <span className="shift-pill">
              <span className="online-dot" />
              {warehouse || "Belum ada gudang"}
            </span>
            <span className="avatar small">
              {session.user.username.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main className="connected-main">{children}</main>
        <footer className="page-footer">
          <span>
            Buymore Workspace{" "}
            <span className="muted">
              / Kontrol lebih baik, kerja lebih tenang.
            </span>
          </span>
          <span>{warehouse}</span>
        </footer>
      </div>
    </div>
  );
}
