import {
  ArrowDownLeft,
  ArrowUpRight,
  ClipboardCheck,
  ChevronRight,
  FileSearch,
} from "lucide-react";
import {
  kindLabel,
  statusLabel,
  type Document,
} from "../../services/warehouse";
export function StatusBadge({ status }: { status: Document["status"] }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <i />
      {statusLabel[status]}
    </span>
  );
}
export function DocumentTable({
  documents,
  open,
}: {
  documents: Document[];
  open: (doc: Document) => void;
}) {
  if (!documents.length)
    return (
      <div className="empty">
        <FileSearch size={32} />
        <h3>Belum ada dokumen</h3>
        <p>Dokumen yang sesuai pencarian akan tampil di sini.</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Dokumen</th>
            <th>Jenis transaksi</th>
            <th>Supplier / tujuan</th>
            <th>Tanggal</th>
            <th>Status</th>
            <th aria-label="Detail" />
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id}>
              <td>
                <button className="document-link" onClick={() => open(d)}>
                  {d.id}
                </button>
                <small>{d.creatorName}</small>
              </td>
              <td>
                <span className={`type-label ${d.kind}`}>
                  {d.kind === "receiving" ? (
                    <ArrowDownLeft size={15} />
                  ) : d.kind === "issue" ? (
                    <ArrowUpRight size={15} />
                  ) : (
                    <ClipboardCheck size={15} />
                  )}{" "}
                  {kindLabel[d.kind]}
                </span>
              </td>
              <td>
                {d.partner}
                <small>{d.lines.length} material</small>
              </td>
              <td>
                {new Date(d.date + "T12:00:00").toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "short",
                })}
                <small>{d.shift}</small>
              </td>
              <td>
                <StatusBadge status={d.status} />
              </td>
              <td>
                <button
                  className="icon-button"
                  onClick={() => open(d)}
                  aria-label={`Detail ${d.id}`}
                >
                  <ChevronRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
