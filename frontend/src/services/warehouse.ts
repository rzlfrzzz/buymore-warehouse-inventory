export type Role = "Head" | "Admin" | "Checker" | "Staff" | "System Admin";
export type Kind = "receiving" | "issue" | "stock-count";
export type Status =
  "DRAFT" | "PENDING" | "VERIFIED" | "APPROVED" | "REJECTED" | "CANCELLED";
export type Warehouse = "GDG-01" | "GDG-02";
export interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  factor: number;
  inputUnit: string;
  minimum: number;
  sku: string;
  batch: boolean;
}
export interface Stock {
  product: string;
  warehouse: Warehouse;
  location: string;
  batch: string;
  expiry: string;
  quantity: number;
}
export interface Line {
  product: string;
  location: string;
  batch: string;
  expiry: string;
  quantity: number;
  documentQuantity: number;
  snapshot?: number;
  varianceReason?: (typeof varianceReasons)[number];
  explanation?: string;
}
export interface Document {
  id: string;
  kind: Kind;
  warehouse: Warehouse;
  date: string;
  createdBy: string;
  creatorName: string;
  shift: string;
  status: Status;
  partner: string;
  reference: string;
  notes: string;
  lines: Line[];
  verifiedBy?: string;
  approvedBy?: string;
  reason?: string;
  attachment?: { name: string; data: string };
}
export interface Audit {
  id: string;
  time: string;
  actor: string;
  warehouse: Warehouse;
  action: string;
  document: string;
  detail: string;
}
export interface Ledger {
  id: string;
  warehouse: Warehouse;
  time: string;
  document: string;
  line: Line;
  delta: number;
}
export interface Adjustment {
  id: string;
  countId: string;
  status: "PENDING" | "POSTED" | "CANCELLED";
  lines: Line[];
  approvedBy?: string;
}
export const varianceReasons = [
  "miscount",
  "damaged",
  "wrong_location",
  "unrecorded_transaction",
  "missing",
  "other",
] as const;
export interface State {
  version: 1;
  adjustments?: Adjustment[];
  stocks: Stock[];
  documents: Document[];
  audit: Audit[];
  ledger: Ledger[];
}
export interface Session {
  role: Role;
  warehouse: Warehouse;
}
export const warehouses: Record<Warehouse, string> = {
  "GDG-01": "Gudang Utama",
  "GDG-02": "Gudang Produksi",
};
export const roles: Role[] = [
  "Head",
  "Admin",
  "Checker",
  "Staff",
  "System Admin",
];
export const people: Record<
  Role,
  { id: string; name: string; initials: string; title: string }
> = {
  Head: {
    id: "head-demo",
    name: "Aditya Pratama",
    initials: "AP",
    title: "Warehouse Head",
  },
  Admin: {
    id: "admin-demo",
    name: "Nadia Putri",
    initials: "NP",
    title: "Warehouse Admin",
  },
  Checker: {
    id: "checker-demo",
    name: "Rizky Ramadhan",
    initials: "RR",
    title: "Warehouse Checker",
  },
  Staff: {
    id: "staff-demo",
    name: "Dewi Lestari",
    initials: "DL",
    title: "Warehouse Staff",
  },
  "System Admin": {
    id: "system-demo",
    name: "Bima Saputra",
    initials: "BS",
    title: "System Administrator",
  },
};
export const products: Product[] = [
  {
    id: "MAT-001",
    name: "Kain Cotton Combed 30s",
    category: "Kain",
    unit: "Cm",
    factor: 100,
    inputUnit: "Meter",
    minimum: 50000,
    sku: "BM-KN-001",
    batch: false,
  },
  {
    id: "MAT-002",
    name: "Kain French Terry",
    category: "Kain",
    unit: "Cm",
    factor: 100,
    inputUnit: "Meter",
    minimum: 30000,
    sku: "BM-KN-002",
    batch: false,
  },
  {
    id: "MAT-003",
    name: "Benang Polyester Putih",
    category: "Benang",
    unit: "Gram",
    factor: 1000,
    inputUnit: "Kg",
    minimum: 25000,
    sku: "BM-BN-001",
    batch: false,
  },
  {
    id: "MAT-004",
    name: "Resleting YKK 20 cm",
    category: "Aksesoris",
    unit: "Pcs",
    factor: 1,
    inputUnit: "Pcs",
    minimum: 500,
    sku: "BM-AK-001",
    batch: false,
  },
  {
    id: "MAT-005",
    name: "Kancing Resin Hitam",
    category: "Aksesoris",
    unit: "Pcs",
    factor: 1,
    inputUnit: "Pcs",
    minimum: 1000,
    sku: "BM-AK-002",
    batch: false,
  },
  {
    id: "MAT-006",
    name: "Pelumas Mesin Jahit",
    category: "Penunjang",
    unit: "Ml",
    factor: 1000,
    inputUnit: "Liter",
    minimum: 10000,
    sku: "BM-PN-001",
    batch: true,
  },
  {
    id: "MAT-007",
    name: "Label Woven Buymore",
    category: "Aksesoris",
    unit: "Pcs",
    factor: 1,
    inputUnit: "Pcs",
    minimum: 2000,
    sku: "BM-AK-003",
    batch: false,
  },
  {
    id: "MAT-008",
    name: "Kain Rib 1x1",
    category: "Kain",
    unit: "Cm",
    factor: 100,
    inputUnit: "Meter",
    minimum: 20000,
    sku: "BM-KN-003",
    batch: false,
  },
];
export const locations = ["A-01", "A-02", "B-01", "B-02", "C-01"];
export const kindLabel: Record<Kind, string> = {
  receiving: "Penerimaan",
  issue: "Pengeluaran",
  "stock-count": "Stock count",
};
export const statusLabel: Record<Status, string> = {
  DRAFT: "Draft",
  PENDING: "Menunggu verifikasi",
  VERIFIED: "Terverifikasi",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
};
export const number = (value: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(value);
export const productById = (id: string) => products.find((p) => p.id === id)!;
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function shiftAt(date = new Date()) {
  const h = date.getHours();
  return h >= 7 && h < 15
    ? "Shift 1"
    : h >= 15 && h < 23
      ? "Shift 2"
      : "Shift malam";
}
export const uid = () => crypto.randomUUID();
const stockKey = (l: Pick<Line, "product" | "location" | "batch">) =>
  `${l.product}|${l.location}|${l.batch}`;
export function seed(): State {
  const stocks: Stock[] = (Object.keys(warehouses) as Warehouse[]).flatMap(
    (warehouse, w) =>
      products.map((p, i) => ({
        product: p.id,
        warehouse,
        location: locations[i % locations.length],
        batch: p.batch ? "OL-2026-08" : "",
        expiry: p.batch ? "2027-08-31" : "",
        quantity:
          [248000, 86400, 18500, 3240, 820, 48000, 12800, 126000][i] *
          (w ? 0.5 : 1),
      })),
  );
  const line = (product: string, quantity: number): Line => {
    const s = stocks.find((s) => s.product === product)!;
    return {
      product,
      quantity,
      documentQuantity: quantity,
      location: s.location,
      batch: s.batch,
      expiry: s.expiry,
    };
  };
  const today = localDate();
  const documents: Document[] = [
    {
      id: "RCV-2026-0048",
      kind: "receiving",
      warehouse: "GDG-01",
      date: today,
      createdBy: "checker-other",
      creatorName: "Fajar Hidayat",
      shift: "Shift 1",
      status: "PENDING",
      partner: "PT Sinar Tekstil",
      reference: "SJ-1028",
      notes: "Kiriman kain untuk produksi minggu ini.",
      lines: [line("MAT-001", 50000), line("MAT-002", 25000)],
    },
    {
      id: "ISS-2026-0032",
      kind: "issue",
      warehouse: "GDG-01",
      date: today,
      createdBy: "checker-demo",
      creatorName: "Rizky Ramadhan",
      shift: "Shift 1",
      status: "PENDING",
      partner: "Produksi",
      reference: "PRD-0182",
      notes: "Kebutuhan lini produksi A.",
      lines: [line("MAT-004", 240)],
    },
    {
      id: "RCV-2026-0047",
      kind: "receiving",
      warehouse: "GDG-01",
      date: today,
      createdBy: "checker-other",
      creatorName: "Fajar Hidayat",
      shift: "Shift 1",
      status: "VERIFIED",
      verifiedBy: "admin-demo",
      partner: "CV Mitra Garment",
      reference: "SJ-1027",
      notes: "Saldo awal demo sudah termasuk penerimaan ini.",
      lines: [line("MAT-007", 2000)],
    },
    {
      id: "SC-2026-0012",
      kind: "stock-count",
      warehouse: "GDG-01",
      date: today,
      createdBy: "staff-other",
      creatorName: "Siti Rahma",
      shift: "Shift 1",
      status: "VERIFIED",
      verifiedBy: "admin-demo",
      partner: "A-02",
      reference: "",
      notes: "Selisih label rusak saat penyimpanan.",
      reason: "Label rusak ditemukan saat hitung fisik.",
      lines: [
        { ...line("MAT-002", 86400), snapshot: 86400 },
        {
          ...line("MAT-007", 12790),
          snapshot: 12800,
          varianceReason: "damaged",
          explanation: "Label rusak",
        },
      ],
    },
    {
      id: "ISS-2026-0031",
      kind: "issue",
      warehouse: "GDG-01",
      date: today,
      createdBy: "checker-other",
      creatorName: "Fajar Hidayat",
      shift: "Shift 1",
      status: "VERIFIED",
      verifiedBy: "admin-demo",
      partner: "Sampel",
      reference: "SMP-009",
      notes: "Saldo awal demo sudah termasuk pengeluaran ini.",
      lines: [line("MAT-001", 2500)],
    },
  ];
  return {
    version: 1,
    stocks,
    documents,
    ledger: [],
    audit: [
      {
        id: uid(),
        time: new Date().toISOString(),
        actor: "Sistem demo",
        warehouse: "GDG-01",
        action: "Workspace disiapkan",
        document: "-",
        detail: "Data contoh; bukan transaksi perusahaan.",
      },
    ],
  };
}
export function frozen(
  state: State,
  warehouse: Warehouse,
  location: string,
  except?: string,
) {
  return state.documents.some(
    (d) =>
      d.id !== except &&
      d.warehouse === warehouse &&
      d.kind === "stock-count" &&
      (["DRAFT", "PENDING", "VERIFIED"].includes(d.status) ||
        (d.status === "APPROVED" &&
          state.adjustments?.some(
            (a) => a.countId === d.id && a.status === "PENDING",
          ))) &&
      d.partner === location,
  );
}
export function available(
  state: State,
  warehouse: Warehouse,
  line: Line,
  except?: string,
) {
  const balance =
    state.stocks.find(
      (s) => s.warehouse === warehouse && stockKey(s) === stockKey(line),
    )?.quantity ?? 0;
  const reserved = state.documents
    .filter(
      (d) =>
        d.warehouse === warehouse &&
        d.kind === "issue" &&
        d.status === "PENDING" &&
        d.id !== except,
    )
    .flatMap((d) => d.lines)
    .filter((l) => stockKey(l) === stockKey(line))
    .reduce((n, l) => n + l.quantity, 0);
  return balance - reserved;
}
export function canCreate(role: Role, kind: Kind) {
  return kind === "stock-count" ? role === "Staff" : role === "Checker";
}
export function canVerify(role: Role, kind: Kind) {
  return role === "Admin" || (role === "Head" && kind === "receiving");
}
function log(
  state: State,
  session: Session,
  action: string,
  document: string,
  detail: string,
) {
  state.audit.unshift({
    id: uid(),
    time: new Date().toISOString(),
    actor: people[session.role].name,
    warehouse: session.warehouse,
    action,
    document,
    detail,
  });
}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function saveDocument(
  state: State,
  session: Session,
  input: Omit<
    Document,
    "id" | "createdBy" | "creatorName" | "shift" | "warehouse"
  >,
): State {
  ensure(
    canCreate(session.role, input.kind),
    "Peran Anda tidak dapat membuat dokumen ini.",
  );
  ensure(
    ["DRAFT", "PENDING"].includes(input.status),
    "Status dokumen tidak valid.",
  );
  ensure(
    input.partner.trim(),
    input.kind === "receiving"
      ? "Supplier wajib diisi."
      : "Tujuan atau lokasi wajib diisi.",
  );
  ensure(input.lines.length > 0, "Tambahkan minimal satu material.");
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(input.date), "Tanggal wajib diisi.");
  const seen = new Set<string>();
  for (const l of input.lines) {
    const p = productById(l.product);
    ensure(
      p && locations.includes(l.location),
      "Material atau lokasi tidak valid.",
    );
    ensure(
      Number.isSafeInteger(l.quantity) &&
        l.quantity >= (input.kind === "stock-count" ? 0 : 1),
      "Kuantitas harus positif dan bulat dalam satuan dasar.",
    );
    ensure(
      Number.isSafeInteger(l.documentQuantity) && l.documentQuantity >= 0,
      "Kuantitas surat jalan tidak valid.",
    );
    ensure(
      !seen.has(stockKey(l)),
      "Material, lokasi, dan batch yang sama tidak boleh diulang.",
    );
    seen.add(stockKey(l));
    ensure(
      !frozen(state, session.warehouse, l.location),
      `Lokasi ${l.location} dibekukan untuk stock count.`,
    );
    ensure(
      p.batch ? Boolean(l.batch && l.expiry) : !l.batch,
      "Batch dan kedaluwarsa harus sesuai pengaturan produk.",
    );
    if (p.batch && l.expiry < localDate())
      ensure(
        input.notes.trim(),
        "Batch kedaluwarsa memerlukan alasan pada catatan.",
      );
    if (input.kind === "issue")
      ensure(
        l.quantity <= available(state, session.warehouse, l),
        `Saldo tersedia ${p.name} tidak mencukupi.`,
      );
    if (input.kind === "stock-count")
      ensure(
        l.location === input.partner,
        "Stock count hanya untuk satu lokasi.",
      );
  }
  if (input.kind === "stock-count") {
    ensure(
      !state.documents.some(
        (d) =>
          d.warehouse === session.warehouse &&
          d.kind === "issue" &&
          d.status === "PENDING" &&
          d.lines.some((l) => l.location === input.partner),
      ),
      "Selesaikan issue menunggu verifikasi di lokasi ini sebelum stock count.",
    );
    const expected = state.stocks.filter(
      (s) => s.warehouse === session.warehouse && s.location === input.partner,
    );
    ensure(
      expected.length > 0 &&
        expected.length === input.lines.length &&
        expected.every((s) =>
          input.lines.some((l) => stockKey(l) === stockKey(s)),
        ),
      "Hitung semua material dan batch pada lokasi ini.",
    );
  }
  const next = structuredClone(state);
  const id = `${input.kind === "receiving" ? "RCV" : input.kind === "issue" ? "ISS" : "SC"}-${new Date().getFullYear()}-${uid().slice(0, 8).toUpperCase()}`;
  const lines = input.lines.map((l) => {
    const { snapshot: _snapshot, ...clean } = l;
    return input.kind === "stock-count"
      ? {
          ...clean,
          snapshot:
            state.stocks.find(
              (s) =>
                s.warehouse === session.warehouse &&
                stockKey(s) === stockKey(l),
            )?.quantity ?? 0,
        }
      : clean;
  });
  next.documents.unshift({
    ...input,
    lines,
    id,
    createdBy: people[session.role].id,
    creatorName: people[session.role].name,
    shift: shiftAt(),
    warehouse: session.warehouse,
  });
  log(
    next,
    session,
    input.status === "DRAFT" ? "Draft disimpan" : "Dokumen dikirim",
    id,
    kindLabel[input.kind],
  );
  return next;
}
export function transition(
  state: State,
  session: Session,
  id: string,
  action:
    "submit" | "verify" | "approve" | "reject" | "cancel" | "post" | "recount",
  reason = "",
  varianceReason: (typeof varianceReasons)[number] = "other",
): State {
  const next = structuredClone(state);
  const d = next.documents.find((d) => d.id === id);
  ensure(
    d && d.warehouse === session.warehouse,
    "Dokumen tidak ditemukan di gudang aktif.",
  );
  const actor = people[session.role].id;
  if (action === "post") {
    ensure(
      session.role === "Head" &&
        d.kind === "stock-count" &&
        d.status === "APPROVED" &&
        actor !== d.createdBy &&
        actor !== d.verifiedBy,
      "Hanya Head dapat posting adjustment.",
    );
    const adjustment = next.adjustments?.find((a) => a.countId === id);
    ensure(
      adjustment && adjustment.status !== "CANCELLED",
      "Adjustment tidak ditemukan.",
    );
    if (adjustment.status === "POSTED") return next;
    for (const l of adjustment.lines) {
      const delta = l.quantity - (l.snapshot ?? 0);
      const stock = next.stocks.find(
        (s) => s.warehouse === d.warehouse && stockKey(s) === stockKey(l),
      );
      ensure(
        stock && stock.quantity === l.snapshot && stock.quantity + delta >= 0,
        "Snapshot tidak sesuai saldo.",
      );
      stock.quantity += delta;
      next.ledger.push({
        id: uid(),
        warehouse: d.warehouse,
        time: new Date().toISOString(),
        document: adjustment.id,
        line: { ...l },
        delta,
      });
    }
    adjustment.status = "POSTED";
    adjustment.approvedBy = actor;
  } else if (action === "recount") {
    ensure(
      session.role === "Admin" &&
        d.kind === "stock-count" &&
        d.status === "PENDING" &&
        d.createdBy !== actor &&
        reason.trim(),
      "Admin dan alasan hitung ulang wajib.",
    );
    d.status = "DRAFT";
    d.reason = reason;
    d.lines.forEach((l) => {
      l.quantity = -1;
    });
  } else if (action === "submit") {
    ensure(
      d.status === "DRAFT" &&
        d.createdBy === actor &&
        canCreate(session.role, d.kind),
      "Hanya pembuat yang dapat mengirim draft.",
    );
    if (d.kind !== "stock-count")
      for (const l of d.lines) {
        ensure(
          !frozen(next, d.warehouse, l.location),
          "Lokasi sedang dibekukan.",
        );
        if (d.kind === "issue")
          ensure(
            l.quantity <= available(next, d.warehouse, l, d.id),
            "Saldo tersedia tidak mencukupi.",
          );
      }
    if (d.kind === "stock-count")
      ensure(
        d.lines.every(
          (l) => Number.isSafeInteger(l.quantity) && l.quantity >= 0,
        ),
        "Isi semua hasil hitung.",
      );
    d.status = "PENDING";
  } else if (action === "cancel") {
    ensure(
      (d.status === "DRAFT" && d.createdBy === actor) ||
        (d.status === "PENDING" && ["Admin", "Head"].includes(session.role)) ||
        (d.kind === "stock-count" &&
          (d.status === "VERIFIED" ||
            (d.status === "APPROVED" &&
              next.adjustments?.some(
                (a) => a.countId === id && a.status === "PENDING",
              ))) &&
          session.role === "Head"),
      "Dokumen ini tidak dapat dibatalkan.",
    );
    ensure(reason.trim(), "Alasan pembatalan wajib diisi.");
    d.status = "CANCELLED";
    d.reason = reason;
    next.adjustments
      ?.filter((a) => a.countId === id)
      .forEach((a) => {
        a.status = "CANCELLED";
      });
  } else {
    ensure(
      d.createdBy !== actor,
      "Pembuat tidak boleh memverifikasi atau menyetujui dokumennya sendiri.",
    );
    if (action === "approve") {
      ensure(
        d.kind === "stock-count" &&
          d.status === "VERIFIED" &&
          session.role === "Head",
        "Persetujuan hanya oleh Head untuk stock count terverifikasi.",
      );
      ensure(
        d.verifiedBy !== actor,
        "Verifikator dan penyetuju harus berbeda.",
      );
      ensure(reason.trim(), "Alasan persetujuan adjustment wajib diisi.");
      d.status = "APPROVED";
      d.approvedBy = actor;
      d.reason = reason;
      const changed = d.lines.filter((l) => l.quantity !== l.snapshot);
      ensure(
        changed.every(
          (l) =>
            l.varianceReason &&
            varianceReasons.includes(l.varianceReason) &&
            (l.varianceReason !== "other" || l.explanation?.trim()),
        ),
        "Verifikasi alasan selisih diperlukan; data demo lama perlu dihitung ulang.",
      );
      if (changed.length) {
        next.adjustments ??= [];
        next.adjustments.push({
          id: `ADJ-${uid().slice(0, 8)}`,
          countId: id,
          status: "PENDING",
          lines: structuredClone(changed),
        });
      }
    } else {
      ensure(
        d.status === "PENDING" && canVerify(session.role, d.kind),
        "Anda tidak dapat memverifikasi dokumen ini.",
      );
      if (action === "reject") {
        ensure(reason.trim(), "Alasan penolakan wajib diisi.");
        d.status = "REJECTED";
        d.reason = reason;
      } else {
        if (
          d.kind === "stock-count" &&
          d.lines.some((l) => l.quantity !== l.snapshot)
        ) {
          ensure(
            varianceReasons.includes(varianceReason) && reason.trim(),
            "Alasan selisih wajib diisi.",
          );
          d.lines
            .filter((l) => l.quantity !== l.snapshot)
            .forEach((l) => {
              l.varianceReason = varianceReason;
              l.explanation = reason;
            });
        }
        d.status = "VERIFIED";
        d.verifiedBy = actor;
        if (reason) d.reason = reason;
      }
    }
    if (action === "verify" && d.kind !== "stock-count") {
      for (const l of d.lines) {
        ensure(
          !frozen(next, d.warehouse, l.location, d.id),
          "Lokasi sedang dibekukan untuk stock count.",
        );
        if (d.kind === "issue")
          ensure(
            l.quantity <= available(next, d.warehouse, l, d.id),
            "Saldo tersedia tidak mencukupi.",
          );
        let stock = next.stocks.find(
          (s) => s.warehouse === d.warehouse && stockKey(s) === stockKey(l),
        );
        if (!stock) {
          stock = {
            product: l.product,
            warehouse: d.warehouse,
            location: l.location,
            batch: l.batch,
            expiry: l.expiry,
            quantity: 0,
          };
          next.stocks.push(stock);
        }
        const delta =
          d.kind === "receiving"
            ? l.quantity
            : d.kind === "issue"
              ? -l.quantity
              : l.quantity - (l.snapshot ?? 0);
        ensure(stock.quantity + delta >= 0, "Saldo tidak boleh negatif.");
        stock.quantity += delta;
        next.ledger.push({
          id: uid(),
          warehouse: d.warehouse,
          time: new Date().toISOString(),
          document: d.id,
          line: { ...l },
          delta,
        });
      }
    }
  }
  log(
    next,
    session,
    {
      submit: "Dokumen dikirim",
      verify: "Dokumen diverifikasi",
      approve: "Count disetujui; adjustment terpisah dibuat",
      post: "Adjustment disetujui dan diposting",
      recount: "Hitung ulang diminta",
      reject: "Dokumen ditolak",
      cancel: "Dokumen dibatalkan",
    }[action],
    d.id,
    reason || kindLabel[d.kind],
  );
  return next;
}

export function startCount(
  state: State,
  session: Session,
  location: string,
): State {
  const lines = state.stocks
    .filter((s) => s.warehouse === session.warehouse && s.location === location)
    .map((s) => ({
      product: s.product,
      location: s.location,
      batch: s.batch,
      expiry: s.expiry,
      quantity: 0,
      documentQuantity: 0,
    }));
  const next = saveDocument(state, session, {
    kind: "stock-count",
    date: localDate(),
    status: "DRAFT",
    partner: location,
    reference: "",
    notes: "",
    lines,
  });
  next.documents[0].lines.forEach((l) => {
    l.quantity = -1;
  });
  return next;
}
export function recordCount(
  state: State,
  session: Session,
  id: string,
  quantities: number[],
): State {
  const next = structuredClone(state);
  const d = next.documents.find((d) => d.id === id);
  ensure(
    d &&
      d.warehouse === session.warehouse &&
      d.kind === "stock-count" &&
      d.status === "DRAFT" &&
      session.role === "Staff" &&
      d.createdBy === people.Staff.id,
    "Hanya penghitung dapat mencatat hasil.",
  );
  ensure(
    quantities.length === d.lines.length &&
      quantities.every((q) => Number.isSafeInteger(q) && q >= 0),
    "Isi semua kuantitas dasar non-negatif.",
  );
  d.lines.forEach((l, i) => {
    l.quantity = quantities[i];
  });
  return transition(next, session, id, "submit");
}
