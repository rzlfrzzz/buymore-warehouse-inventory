import { useState } from "react";
import { Modal } from "./Modal";
import { StatusBadge } from "../tables/DocumentTable";
import {
  recordCount,
  varianceReasons,
  canVerify,
  kindLabel,
  number,
  people,
  productById,
  transition,
  type Document,
  type Session,
  type State,
} from "../../services/warehouse";
export function DocumentDetail({
  doc,
  state,
  session,
  close,
  save,
}: {
  doc: Document;
  state: State;
  session: Session;
  close: () => void;
  save: (state: State) => void;
}) {
  const [varianceReason, setVarianceReason] =
    useState<(typeof varianceReasons)[number]>("miscount");
  const [quantities, setQuantities] = useState(
    doc.lines.map((l) => (l.quantity < 0 ? "" : String(l.quantity))),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const me = people[session.role].id;
  function act(action: Parameters<typeof transition>[3]) {
    try {
      save(transition(state, session, doc.id, action, reason, varianceReason));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const verify =
    doc.status === "PENDING" &&
    canVerify(session.role, doc.kind) &&
    doc.createdBy !== me;
  const approve =
    doc.kind === "stock-count" &&
    doc.status === "VERIFIED" &&
    session.role === "Admin" &&
    doc.createdBy !== me;
  const counting =
    doc.kind === "stock-count" &&
    doc.status === "DRAFT" &&
    session.role === "User" &&
    doc.createdBy === me;
  const adjustment = state.adjustments?.find((a) => a.countId === doc.id);
  return (
    <Modal title={doc.id} close={close} wide>
      <div className="detail-meta">
        <StatusBadge status={doc.status} />
        <span>
          {kindLabel[doc.kind]} / {doc.partner}
        </span>
        <span>
          {doc.date} / {doc.shift}
        </span>
      </div>
      <p className="muted">
        Dicatat oleh {doc.creatorName}. Referensi: {doc.reference || "-"}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Material / lokasi</th>
              <th>Kuantitas aktual</th>
              {doc.kind === "receiving" && <th>Surat jalan</th>}
              {doc.kind === "stock-count" && session.role !== "User" && (
                <>
                  <th>Saldo snapshot</th>
                  <th>Selisih</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => {
              const p = productById(l.product);
              return (
                <tr key={i}>
                  <td>
                    <strong>{p.name}</strong>
                    <small>
                      {l.location} {l.batch} {l.expiry && `ED ${l.expiry}`}
                    </small>
                  </td>
                  <td>
                    {counting ? (
                      <input
                        aria-label={p.name}
                        type="number"
                        min="0"
                        step="1"
                        value={quantities[i]}
                        onChange={(e) =>
                          setQuantities(
                            quantities.map((q, j) =>
                              j === i ? e.target.value : q,
                            ),
                          )
                        }
                      />
                    ) : (
                      <>
                        {number(l.quantity / p.factor)} {p.inputUnit}
                      </>
                    )}
                    {counting && <small>Satuan dasar: {p.unit}</small>}
                  </td>
                  {doc.kind === "receiving" && (
                    <td>
                      {number(l.documentQuantity / p.factor)} {p.inputUnit}
                    </td>
                  )}
                  {doc.kind === "stock-count" && session.role !== "User" && (
                    <>
                      <td>
                        {number((l.snapshot ?? 0) / p.factor)} {p.inputUnit}
                      </td>
                      <td>
                        {number((l.quantity - (l.snapshot ?? 0)) / p.factor)}{" "}
                        {p.inputUnit}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">{doc.notes || "Tidak ada catatan."}</p>
      {doc.reason && <p className="callout">Catatan keputusan: {doc.reason}</p>}
      {doc.attachment && (
        <a
          className="attachment"
          href={doc.attachment.data}
          download={doc.attachment.name}
        >
          <img src={doc.attachment.data} alt="Foto bukti transaksi" />
          Unduh {doc.attachment.name}
        </a>
      )}
      {approve && (
        <div className="callout">
          Persetujuan count membuat adjustment terpisah tanpa mengubah stok.
          Lokasi tetap beku sampai adjustment diposting.
        </div>
      )}
      {adjustment && (
        <p className="callout">
          Adjustment {adjustment.id}: {adjustment.status}
        </p>
      )}
      {doc.kind === "stock-count" && verify && (
        <label>
          Alasan selisih (semua baris berselisih)
          <select
            value={varianceReason}
            onChange={(e) =>
              setVarianceReason(e.target.value as typeof varianceReason)
            }
          >
            {varianceReasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Alasan keputusan
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Wajib untuk penolakan, pembatalan, dan adjustment"
          rows={3}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        {((doc.status === "DRAFT" && doc.createdBy === me) ||
          (doc.status === "PENDING" &&
            ["Admin", "Admin"].includes(session.role)) ||
          (doc.kind === "stock-count" &&
            (doc.status === "VERIFIED" ||
              (doc.status === "APPROVED" &&
                adjustment?.status === "PENDING")) &&
            session.role === "Admin")) && (
          <button className="button danger" onClick={() => act("cancel")}>
            Batalkan dokumen
          </button>
        )}
        {doc.status === "DRAFT" && doc.createdBy === me && (
          <button
            className="button primary"
            onClick={() => {
              if (!counting) act("submit");
              else
                try {
                  if (quantities.some((q) => q === ""))
                    throw new Error("Isi semua hasil hitung.");
                  save(
                    recordCount(state, session, doc.id, quantities.map(Number)),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
            }}
          >
            Kirim dokumen
          </button>
        )}
        {verify && (
          <>
            {doc.kind === "stock-count" && (
              <button
                className="button secondary"
                onClick={() => act("recount")}
              >
                Minta hitung ulang
              </button>
            )}
            <button className="button secondary" onClick={() => act("reject")}>
              Tolak
            </button>
            <button className="button primary" onClick={() => act("verify")}>
              Verifikasi dokumen
            </button>
          </>
        )}
        {approve && (
          <button className="button primary" onClick={() => act("approve")}>
            Setujui count
          </button>
        )}
        {adjustment?.status === "PENDING" && session.role === "Admin" && (
          <button className="button primary" onClick={() => act("post")}>
            Setujui & posting adjustment
          </button>
        )}
      </div>
    </Modal>
  );
}
