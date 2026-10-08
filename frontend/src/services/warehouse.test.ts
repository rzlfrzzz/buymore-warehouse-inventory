import { describe, expect, it } from "vitest";
import {
  startCount,
  recordCount,
  available,
  canCreate,
  frozen,
  localDate,
  saveDocument,
  seed,
  shiftAt,
  transition,
  type Document,
  type Session,
  type State,
} from "./warehouse";
import { allowedPages } from "../permissions";
const checker: Session = { role: "Admin", warehouse: "GDG-01" };
const admin: Session = { role: "Admin", warehouse: "GDG-01" };
const head: Session = { role: "Admin", warehouse: "GDG-01" };
const staff: Session = { role: "User", warehouse: "GDG-01" };
function input(
  kind: Document["kind"] = "receiving",
): Parameters<typeof saveDocument>[2] {
  return {
    kind,
    date: localDate(),
    status: "PENDING",
    partner: kind === "issue" ? "Produksi" : "PT Supplier",
    reference: "TEST",
    notes: "",
    lines: [
      {
        product: "MAT-001",
        location: "A-01",
        batch: "",
        expiry: "",
        quantity: 100,
        documentQuantity: 100,
      },
    ],
  };
}
function stock(state: State) {
  return state.stocks.find(
    (s) => s.warehouse === "GDG-01" && s.product === "MAT-001",
  )!.quantity;
}
describe("permission dan scope gudang", () => {
  it("Staff tidak memiliki inventori atau laporan; System Admin tidak bertransaksi", () => {
    expect(allowedPages("User")).not.toContain("inventory");
    expect(allowedPages("User")).not.toContain("reports");
    expect(allowedPages("Admin")).toEqual(["settings"]);
    expect(canCreate("Admin", "receiving")).toBe(false);
    expect(() =>
      saveDocument(seed(), { role: "Admin", warehouse: "GDG-01" }, input()),
    ).toThrow();
  });
  it("mencegah verifikasi lintas gudang dan Head memverifikasi issue", () => {
    expect(() =>
      transition(
        seed(),
        { ...admin, warehouse: "GDG-02" },
        "RCV-2026-0048",
        "verify",
      ),
    ).toThrow();
    expect(() => transition(seed(), head, "ISS-2026-0032", "verify")).toThrow();
  });
  it("melarang pembuat memverifikasi dokumennya sendiri", () => {
    const state = seed();
    state.documents[0].createdBy = "admin-demo";
    expect(() =>
      transition(state, admin, state.documents[0].id, "verify"),
    ).toThrow("Pembuat");
  });
});
describe("dokumen dan ledger", () => {
  it("posting hanya saat verified, tidak mengubah input state, dan tidak bisa posting dua kali", () => {
    const original = seed();
    const before = stock(original);
    const saved = saveDocument(original, checker, input());
    expect(stock(saved)).toBe(before);
    expect(original.documents).toHaveLength(5);
    const verified = transition(saved, admin, saved.documents[0].id, "verify");
    expect(stock(verified)).toBe(before + 100);
    expect(verified.ledger).toHaveLength(1);
    expect(stock(saved)).toBe(before);
    expect(() =>
      transition(verified, admin, saved.documents[0].id, "verify"),
    ).toThrow();
  });
  it("mengirim draft, mereservasi issue, menolak overselling, melepas reservasi setelah penolakan", () => {
    let state = seed();
    const doc = input("issue");
    doc.status = "DRAFT";
    doc.lines[0].quantity = 200000;
    state = saveDocument(state, checker, doc);
    const id = state.documents[0].id;
    expect(available(state, "GDG-01", doc.lines[0])).toBe(248000);
    state = transition(state, checker, id, "submit");
    expect(available(state, "GDG-01", doc.lines[0])).toBe(48000);
    expect(() => saveDocument(state, checker, input("issue"))).not.toThrow();
    const tooMuch = input("issue");
    tooMuch.lines[0].quantity = 50000;
    expect(() => saveDocument(state, checker, tooMuch)).toThrow("mencukupi");
    state = transition(state, admin, id, "reject", "Permintaan dibatalkan");
    expect(available(state, "GDG-01", doc.lines[0])).toBe(248000);
  });
  it("verifikasi issue mengurangi stok sekali dan mempertahankan reservasi dokumen lain", () => {
    let state = saveDocument(seed(), checker, input("issue"));
    const id = state.documents[0].id;
    state = transition(state, admin, id, "verify");
    expect(stock(state)).toBe(247900);
    expect(state.ledger[0].delta).toBe(-100);
  });
  it("alasan wajib untuk penolakan dan pembatalan", () => {
    expect(() => transition(seed(), admin, "RCV-2026-0048", "reject")).toThrow(
      "Alasan",
    );
    expect(() => transition(seed(), head, "RCV-2026-0048", "cancel")).toThrow(
      "Alasan",
    );
  });
  it("memvalidasi integer dasar, batch, lokasi, kuantitas dan duplikasi", () => {
    for (const quantity of [-1, 0, 1.5, NaN, Infinity]) {
      const doc = input();
      doc.lines[0].quantity = quantity;
      expect(() => saveDocument(seed(), checker, doc)).toThrow();
    }
    const duplicate = input();
    duplicate.lines.push({ ...duplicate.lines[0] });
    expect(() => saveDocument(seed(), checker, duplicate)).toThrow("diulang");
    const batch = input();
    batch.lines[0].product = "MAT-006";
    expect(() => saveDocument(seed(), checker, batch)).toThrow("Batch");
    const nonBatch = input();
    nonBatch.lines[0].batch = "BAD";
    expect(() => saveDocument(seed(), checker, nonBatch)).toThrow("Batch");
  });
});
describe("blind count dan pembekuan", () => {
  function countInput(): Parameters<typeof saveDocument>[2] {
    return {
      ...input("stock-count"),
      partner: "B-01",
      lines: [
        {
          product: "MAT-003",
          location: "B-01",
          batch: "",
          expiry: "",
          quantity: 18000,
          documentQuantity: 0,
          snapshot: 0,
        },
        {
          product: "MAT-008",
          location: "B-01",
          batch: "",
          expiry: "",
          quantity: 125000,
          documentQuantity: 0,
        },
      ],
    };
  }
  it("snapshot berasal dari saldo, lokasi beku sampai approval, delta diposting setelah approval", () => {
    let state = saveDocument(seed(), staff, countInput());
    const id = state.documents[0].id;
    expect(state.documents[0].lines[0].snapshot).toBe(18500);
    expect(frozen(state, "GDG-01", "B-01")).toBe(true);
    expect(() => transition(state, admin, id, "verify")).toThrow("selisih");
    state = transition(state, admin, id, "verify", "Material rusak");
    expect(state.ledger).toHaveLength(0);
    state = transition(state, head, id, "approve", "Setuju koreksi fisik");
    expect(state.ledger).toHaveLength(0);
    expect(frozen(state, "GDG-01", "B-01")).toBe(true);
    state = transition(state, head, id, "post");
    expect(frozen(state, "GDG-01", "B-01")).toBe(false);
    expect(state.ledger.map((l) => l.delta)).toEqual([-500, -1000]);
  });
  it("menolak hitung parsial dan stok yang masih memiliki issue pending", () => {
    const partial = countInput();
    partial.lines.pop();
    expect(() => saveDocument(seed(), staff, partial)).toThrow(
      "semua material",
    );
    const count = {
      ...input("stock-count"),
      partner: "B-02",
      lines: [
        {
          ...input().lines[0],
          product: "MAT-004",
          location: "B-02",
          quantity: 3240,
        },
      ],
    };
    expect(() => saveDocument(seed(), staff, count)).toThrow("issue");
  });
  it("blokir transaksi pada lokasi beku dan melepaskan freeze ketika dibatalkan", () => {
    let state = saveDocument(seed(), staff, {
      ...countInput(),
      status: "DRAFT",
    });
    const id = state.documents[0].id;
    const receiving = input();
    receiving.lines[0].location = "B-01";
    expect(() => saveDocument(state, checker, receiving)).toThrow("dibekukan");
    state = transition(state, staff, id, "cancel", "Hitung ulang nanti");
    expect(frozen(state, "GDG-01", "B-01")).toBe(false);
  });
});
describe("shift pencatatan", () => {
  it("mendeteksi shift lintas tengah malam tanpa membatasi akses", () => {
    expect(shiftAt(new Date(2026, 9, 7, 6))).toBe("Shift malam");
    expect(shiftAt(new Date(2026, 9, 7, 7))).toBe("Shift 1");
    expect(shiftAt(new Date(2026, 9, 7, 15))).toBe("Shift 2");
    expect(shiftAt(new Date(2026, 9, 7, 23))).toBe("Shift malam");
  });
});

describe("count sessions and separate adjustment documents", () => {
  it("freezes before input, preserves snapshot through recount and retries posting without duplicating ledger", () => {
    let state = startCount(seed(), staff, "B-01");
    const id = state.documents[0].id;
    expect(frozen(state, "GDG-01", "B-01")).toBe(true);
    expect(state.documents[0].lines[0].quantity).toBe(-1);
    expect(() => transition(state, staff, id, "submit")).toThrow();
    state = recordCount(state, staff, id, [18000, 125000]);
    state = transition(state, admin, id, "recount", "Ulangi fisik");
    expect(state.documents[0].lines[0].snapshot).toBe(18500);
    state = recordCount(state, staff, id, [18400, 126000]);
    state = transition(state, admin, id, "verify", "Hilang", "missing");
    state = transition(state, head, id, "approve", "Disetujui");
    expect(state.ledger).toHaveLength(0);
    state = transition(state, head, id, "post");
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0].document).toBe(state.adjustments![0].id);
    expect(transition(state, head, id, "post").ledger).toHaveLength(1);
    expect(() => transition(state, head, id, "cancel", "Koreksi")).toThrow();
  });
  it("zero variance has no adjustment or ledger and completed count cannot be cancelled", () => {
    let state = startCount(seed(), staff, "B-01");
    const id = state.documents[0].id;
    state = recordCount(state, staff, id, [18500, 126000]);
    state = transition(state, admin, id, "verify");
    state = transition(state, head, id, "approve", "Sesuai");
    expect(state.adjustments ?? []).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
    expect(frozen(state, "GDG-01", "B-01")).toBe(false);
    expect(() =>
      transition(state, head, id, "cancel", "Tidak boleh"),
    ).toThrow();
  });
  it("cancels pending adjustment with its count and releases location", () => {
    let state = transition(seed(), head, "SC-2026-0012", "approve", "Setuju");
    state = transition(
      state,
      head,
      "SC-2026-0012",
      "cancel",
      "Perlu investigasi",
    );
    expect(state.adjustments![0].status).toBe("CANCELLED");
    expect(frozen(state, "GDG-01", "A-02")).toBe(false);
    expect(state.ledger).toHaveLength(0);
  });
});
