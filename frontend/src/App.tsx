import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { useWarehouse } from "./hooks/useWarehouse";
import { allowedPages, type Page } from "./permissions";
import {
  canVerify,
  people,
  roles,
  warehouses,
  type Document,
  type Kind,
  type Session,
  type State,
} from "./services/warehouse";
import { WorkspaceLayout } from "./layouts/WorkspaceLayout";
import { Dashboard } from "./pages/Dashboard";
import { Inventory } from "./pages/Inventory";
import { Documents } from "./pages/Documents";
import { Reports } from "./pages/Reports";
import { Export } from "./pages/Export";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { DocumentForm } from "./components/forms/DocumentForm";
import { DocumentDetail } from "./components/common/DocumentDetail";
function readSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem("buymore.session") || "null");
    return s && roles.includes(s.role) && s.warehouse in warehouses ? s : null;
  } catch {
    return null;
  }
}
export default function App() {
  const { state, update } = useWarehouse();
  const [session, setSession] = useState<Session | null>(readSession);
  const [route, setRoute] = useState(location.hash.slice(1) || "dashboard");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<Kind | null>(null);
  const [selected, setSelected] = useState<Document | null>(null);
  const [toast, setToast] = useState("");
  useEffect(() => {
    const onHash = () => {
      setRoute(location.hash.slice(1) || "dashboard");
      setSearch("");
      setCreating(null);
      setSelected(null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  function changeSession(value: Session) {
    sessionStorage.setItem("buymore.session", JSON.stringify(value));
    setSession(value);
    setSelected(null);
    setCreating(null);
    setSearch("");
  }
  if (!session) return <Login login={changeSession} />;
  const active = session;
  const permitted = allowedPages(active.role);
  const page = permitted.includes(route as Page)
    ? (route as Page)
    : permitted[0];
  const navigate = (next: Page) => {
    location.hash = next;
    setRoute(next);
    setSearch("");
    setSelected(null);
    setCreating(null);
  };
  const documents = state.documents.filter(
    (d) =>
      d.warehouse === active.warehouse &&
      (["Admin", "Admin"].includes(active.role) ||
        d.createdBy === people[active.role].id),
  );
  const filtered = documents.filter((d) =>
    `${d.id} ${d.partner} ${d.creatorName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const pending = documents.filter(
    (d) =>
      d.createdBy !== people[active.role].id &&
      ((d.status === "PENDING" && canVerify(active.role, d.kind)) ||
        (d.status === "VERIFIED" &&
          d.kind === "stock-count" &&
          active.role === "Admin")),
  ).length;
  function save(next: State) {
    try {
      update(next);
      setCreating(null);
      setSelected(null);
      setToast("Perubahan berhasil disimpan di workspace demo.");
    } catch {
      throw new Error(
        "Penyimpanan browser penuh atau tidak tersedia. Kurangi ukuran foto lalu coba lagi.",
      );
    }
  }
  return (
    <WorkspaceLayout
      page={page}
      navigate={navigate}
      session={active}
      setSession={changeSession}
      logout={() => {
        sessionStorage.removeItem("buymore.session");
        setSession(null);
        setSelected(null);
        setCreating(null);
      }}
      pending={pending}
      search={search}
      setSearch={setSearch}
    >
      {page === "dashboard" && (
        <Dashboard
          state={state}
          session={active}
          documents={filtered}
          navigate={navigate}
          open={setSelected}
          create={setCreating}
        />
      )}
      {page === "inventory" && (
        <Inventory state={state} session={active} search={search} />
      )}
      {(["receiving", "issue", "stock-count", "approval"] as string[]).includes(
        page,
      ) && (
        <Documents
          key={`${page}-${active.role}-${active.warehouse}`}
          kind={page as Kind | "approval"}
          documents={documents}
          session={active}
          open={setSelected}
          create={setCreating}
          search={search}
        />
      )}
      {page === "reports" && (
        <Reports
          key={`${active.role}-${active.warehouse}`}
          state={state}
          session={active}
          search={search}
        />
      )}
      {page === "export" && (
        <Export
          state={state}
          session={active}
          open={setSelected}
          search={search}
        />
      )}
      {page === "settings" && (
        <Settings key={active.role} session={active} search={search} />
      )}
      {creating && (
        <DocumentForm
          kind={creating}
          state={state}
          session={active}
          close={() => setCreating(null)}
          save={save}
        />
      )}
      {selected && (
        <DocumentDetail
          doc={selected}
          state={state}
          session={active}
          close={() => setSelected(null)}
          save={save}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={20} />
          {toast}
          <button
            className="icon-button"
            aria-label="Tutup notifikasi"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </WorkspaceLayout>
  );
}
