import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { knownHeaders, templateNames } from "../src/bigseller.js";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/api.js";
import { hashPassword } from "../src/auth.js";
import { migrate, type Runtime } from "../src/runtime.js";
import type { DB } from "../src/stock-count.js";

const origin = "http://127.0.0.1:5173";

async function fixture() {
  const engine = new PGlite();
  const db: Runtime = {
    transaction: (work) => engine.transaction((tx) => work(tx as DB)),
    close: () => engine.close(),
  };
  await migrate(db);
  const password = "test-only-password-123";
  const hash = await hashPassword(password);
  const ids = {
    checker: randomUUID(),
    admin: randomUUID(),
    head: randomUUID(),
    staff: randomUUID(),
  };
  await db.transaction(async (tx) => {
    for (const [name, id] of Object.entries(ids)) {
      await tx.query("INSERT INTO users VALUES ($1,$2,$3,true)", [
        id,
        name,
        hash,
      ]);
      await tx.query("INSERT INTO memberships VALUES ($1,'W',$2)", [
        id,
        name === "staff" ? "User" : "Admin",
      ]);
    }
    await tx.query("INSERT INTO locations VALUES ('W','A'),('W','B')");
    await tx.query(
      "INSERT INTO products(code,name,uom,uom_factor,track_batch,track_expiry) VALUES ('P','Product','BOX',12,true,true),('Q','Second','PCS',1,false,false)",
    );
    await tx.query(
      "INSERT INTO product_batches(product,batch,expiry) VALUES ('P','LOT','2027-01-31'),('Q','',NULL)",
    );
    await tx.query(
      "INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor) VALUES ($1,'W','A','P','LOT',120,'seed'),($2,'W','A','Q','',5,'seed')",
      [randomUUID(), randomUUID()],
    );
  });
  const server = await createApi(db, { origin, secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  async function request(
    path: string,
    cookie = "",
    data?: unknown,
    method?: string,
    key = randomUUID(),
  ) {
    return fetch(base + path, {
      method: method || (data === undefined ? "GET" : "POST"),
      headers: {
        Cookie: cookie,
        "X-Warehouse": "W",
        "Idempotency-Key": key,
        ...(data === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: origin }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  async function login(name: string) {
    const response = await request("/api/login", "", {
      username: name,
      password,
    });
    assert.equal(response.status, 200, await response.text());
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  return { db, server, request, login };
}

test("operations HTTP E2E covers receiving, reservations, settings and fail-closed export", async () => {
  const { db, server, request, login } = await fixture();
  try {
    const checker = await login("checker"),
      user = await login("staff");
    const admin = await login("admin");
    const head = await login("head");
    const staff = await login("staff");

    const supplier = await request("/api/operations/suppliers", head, {
      name: "PT Supplier",
    });
    const supplierBody = (await supplier.json()) as any;
    assert.equal(supplier.status, 201);
    const supplierId = supplierBody.id;
    assert.equal(
      (await request("/api/operations/suppliers", staff, { name: "No" }))
        .status,
      403,
    );

    const receiving = await request("/api/operations/documents", checker, {
      warehouseId: "W",
      type: "RECEIVING",
      supplierId,
      lines: [
        {
          productId: "P",
          locationId: "A",
          documentQuantity: 1,
          actualQuantity: 2,
          uom: "BOX",
          batch: "LOT",
          expiry: "2027-01-31",
        },
      ],
    });
    const receivingBody = (await receiving.json()) as any;
    assert.equal(receiving.status, 201);
    const receivingId = receivingBody.id;
    const detail = (await (
      await request(`/api/operations/documents/${receivingId}`, checker)
    ).json()) as any;
    assert.equal(detail.id, receivingId);
    assert.equal(detail.warehouse, "W");
    assert.equal(detail.lines[0].productId, "P");
    assert.equal(detail.lines[0].locationId, "A");
    assert.equal(detail.lines[0].documentQuantity, 1);
    assert.equal(detail.lines[0].actualQuantity, 2);
    assert.equal(detail.lines[0].uom, "BOX");
    assert.equal(detail.lines[0].baseQuantity, 24);
    assert.equal(detail.lines[0].batch, "LOT");
    assert.equal(String(detail.lines[0].expiry).slice(0, 10), "2027-01-31");
    assert.equal(
      (await request(`/api/operations/documents/${receivingId}`, "")).status,
      401,
    );
    assert.equal(
      (
        await request(
          `/api/operations/documents/${receivingId}?warehouseId=OTHER`,
          checker,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          `/api/operations/documents/${receivingId}/submit`,
          checker,
          { warehouseId: "W" },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/operations/documents/${receivingId}/verify`,
          admin,
          { warehouseId: "W" },
        )
      ).status,
      200,
    );
    const stock = (await (
      await request("/api/operations/reports?kind=stock", head)
    ).json()) as any;
    assert.equal(stock.items.find((r: any) => r.product === "P").quantity, 144);

    const badExpiry = await request("/api/operations/documents", checker, {
      warehouseId: "W",
      type: "RECEIVING",
      supplierId,
      lines: [
        {
          productId: "P",
          locationId: "A",
          documentQuantity: 1,
          actualQuantity: 1,
          uom: "BOX",
          batch: "LOT",
          expiry: "2027-02-01",
        },
      ],
    });
    assert.equal(badExpiry.status, 409);
    const zero = await request("/api/operations/documents", checker, {
      warehouseId: "W",
      type: "ISSUE",
      lines: [
        {
          productId: "Q",
          locationId: "A",
          documentQuantity: 0,
          actualQuantity: 0,
          uom: "PCS",
        },
      ],
    });
    assert.equal(zero.status, 400);

    const issue1 = await request("/api/operations/documents", checker, {
      warehouseId: "W",
      type: "ISSUE",
      lines: [
        {
          productId: "P",
          locationId: "A",
          documentQuantity: 9,
          actualQuantity: 9,
          uom: "BOX",
          batch: "LOT",
          expiry: "2027-01-31",
        },
      ],
    });
    const issue2 = await request("/api/operations/documents", checker, {
      warehouseId: "W",
      type: "ISSUE",
      lines: [
        {
          productId: "P",
          locationId: "A",
          documentQuantity: 4,
          actualQuantity: 4,
          uom: "BOX",
          batch: "LOT",
          expiry: "2027-01-31",
        },
      ],
    });
    const issueId1 = ((await issue1.json()) as any).id;
    const issueId2 = ((await issue2.json()) as any).id;
    const submitBoth = await Promise.all([
      request(`/api/operations/documents/${issueId1}/submit`, checker, {
        warehouseId: "W",
      }),
      request(`/api/operations/documents/${issueId2}/submit`, checker, {
        warehouseId: "W",
      }),
    ]);
    assert.deepEqual(submitBoth.map((r) => r.status).sort(), [200, 409]);
    const reservedId = submitBoth[0].status === 200 ? issueId1 : issueId2;
    assert.equal(
      (
        await request(`/api/operations/documents/${reservedId}/reject`, admin, {
          warehouseId: "W",
          reason: "release",
        })
      ).status,
      200,
    );
    assert.equal(
      Number(
        (
          await db.transaction((tx) =>
            tx.query(
              "SELECT count(*) AS n FROM inventory_reservations WHERE status='ACTIVE'",
            ),
          )
        ).rows[0].n,
      ),
      0,
    );

    const count = (await (
      await request("/api/counts", admin, { location: "A" })
    ).json()) as any;
    const frozenIssue = await request("/api/operations/documents", checker, {
      warehouseId: "W",
      type: "ISSUE",
      lines: [
        {
          productId: "P",
          locationId: "A",
          documentQuantity: 1,
          actualQuantity: 1,
          uom: "BOX",
          batch: "LOT",
          expiry: "2027-01-31",
        },
      ],
    });
    const frozenId = ((await frozenIssue.json()) as any).id;
    assert.equal(
      (
        await request(`/api/operations/documents/${frozenId}/submit`, checker, {
          warehouseId: "W",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/api/operations/documents/${frozenId}/verify`, admin, {
          warehouseId: "W",
        })
      ).status,
      409,
    );
    const countLines = [
      { product: "P", batch: "LOT", quantity: 132, reason: "missing" },
      { product: "Q", batch: "", quantity: 5 },
    ];
    assert.equal(
      (
        await request(`/api/counts/${count.id}/submit`, admin, {
          lines: countLines,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/api/counts/${count.id}/verify`, admin, {
          lines: countLines,
        })
      ).status,
      200,
    );
    const approved = await request(`/api/counts/${count.id}/approve`, head, {});
    const adjustment = ((await approved.json()) as any).adjustmentId;
    assert.equal(
      (await request(`/api/adjustments/${adjustment}/post`, head, {})).status,
      200,
    );
    const datedStock = (await (
      await request(
        "/api/operations/reports?kind=stock&from=2020-01-01&to=2020-01-01",
        head,
      )
    ).json()) as any;
    assert.equal(
      datedStock.items.find((r: any) => r.product === "P").quantity,
      132,
    );
    assert.equal(datedStock.total, 2);
    const activity = (await (
      await request("/api/operations/reports?kind=activity", head)
    ).json()) as any;
    assert.equal(activity.total, activity.items.length);
    assert(activity.items.some((r: any) => r.delta === -12));
    assert(activity.items.some((r: any) => r.documentType === "RECEIVING"));

    assert.equal(
      (
        await request(
          "/api/operations/settings",
          head,
          {
            reportPageSize: 25,
            reportDefaultDays: 10,
            csvDelimiter: "|",
            exportWarehouseName: "W",
          },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/operations/settings",
          head,
          {
            reportPageSize: 25,
            reportDefaultDays: 10,
            csvDelimiter: "\n",
            exportWarehouseName: "W",
          },
          "PATCH",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/operations/settings",
          head,
          {
            reportPageSize: 25,
            reportDefaultDays: 10,
            csvDelimiter: ",",
            exportWarehouseName: "W",
            bad: true,
          },
          "PATCH",
        )
      ).status,
      400,
    );
    assert.equal(
      ((await (await request("/api/operations/settings", head)).json()) as any)
        .csvDelimiter,
      "|",
    );

    assert.equal(
      (
        await request("/api/operations/exports", head, {
          warehouseId: "W",
          type: "PO",
          documentIds: [receivingId],
        })
      ).status,
      409,
    );
    await db.transaction((tx) =>
      tx.query(
        "UPDATE operation_settings SET bigseller_template_confirmed=true WHERE warehouse='W'",
      ),
    );
    assert.equal(
      (
        await request("/api/operations/exports", head, {
          warehouseId: "W",
          type: "PO",
          documentIds: [receivingId],
        })
      ).status,
      409,
    );
    assert.equal(
      Number(
        (
          await db.transaction((tx) =>
            tx.query("SELECT count(*) AS n FROM export_jobs"),
          )
        ).rows[0].n,
      ),
      0,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await db.close();
  }
});

test("template-backed export is durable, scoped, idempotent and rejects duplicate claims", async () => {
  const { db, server, request, login } = await fixture();
  const directory = resolve(".test-export-" + randomUUID()),
    previous = process.env.BIGSELLER_TEMPLATE_DIR;
  try {
    await mkdir(directory, { recursive: true });
    for (const type of ["PO", "SR"] as const) {
      const w = new ExcelJS.Workbook(),
        sheet = w.addWorksheet("SKU");
      w.addWorksheet("Sheet1");
      for (let i = 1; i <= (type === "PO" ? 51 : 3); i++)
        sheet.getCell(1, i).value =
          knownHeaders[type][i] || "Synthetic unknown " + i;
      await w.xlsx.writeFile(join(directory, templateNames[type]));
    }
    process.env.BIGSELLER_TEMPLATE_DIR = directory;
    const head = await login("head"),
      admin = await login("admin"),
      checker = await login("checker"),
      user = await login("staff");
    assert.equal(
      (await request("/api/operations/suppliers", user, { name: "Denied" }))
        .status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/operations/products/Q",
          user,
          { bigsellerSku: "000Q", bigsellerRegistered: true },
          "PATCH",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/operations/products/Q",
          head,
          { uom: "BOX" },
          "PATCH",
        )
      ).status,
      400,
    );
    const supplier = (await (
      await request("/api/operations/suppliers", head, { name: "Supplier" })
    ).json()) as any;
    const doc = (await (
      await request("/api/operations/documents", checker, {
        warehouseId: "W",
        type: "RECEIVING",
        supplierId: supplier.id,
        lines: [
          {
            productId: "Q",
            locationId: "A",
            documentQuantity: 2,
            actualQuantity: 3,
            uom: "PCS",
          },
        ],
      })
    ).json()) as any;
    const payload = { warehouseId: "W", type: "PO", documentIds: [doc.id] };
    assert.equal(
      (await request("/api/operations/exports", head, payload)).status,
      409,
    );
    await request(`/api/operations/documents/${doc.id}/submit`, checker, {
      warehouseId: "W",
    });
    await request(`/api/operations/documents/${doc.id}/verify`, admin, {
      warehouseId: "W",
    });
    assert.equal(
      (await request("/api/operations/exports", head, payload)).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/api/operations/products/Q",
          head,
          { bigsellerSku: "000Q", bigsellerRegistered: true },
          "PATCH",
        )
      ).status,
      200,
    );
    const other = await db.transaction((tx) =>
      tx.query(
        "SELECT count(*) AS n FROM warehouse_product_settings WHERE warehouse='OTHER'",
      ),
    );
    assert.equal(Number(other.rows[0].n), 0);
    const key = randomUUID();
    const response = await request(
      "/api/operations/exports",
      head,
      payload,
      undefined,
      key,
    );
    const job = (await response.json()) as any;
    assert.equal(response.status, 201, JSON.stringify(job));
    assert.deepEqual(
      await (
        await request("/api/operations/exports", head, payload, undefined, key)
      ).json(),
      job,
    );
    assert.equal(
      (await request("/api/operations/exports", head, payload)).status,
      409,
    );
    assert.equal(
      (await request("/api/operations/exports", user, payload)).status,
      403,
    );
    const file = await request(
      "/api/operations/exports/" + job.id + "/file",
      head,
    );
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      job.checksum,
    );
    assert.equal(
      (
        await request(
          "/api/operations/exports/" + job.id + "/file?warehouseId=OTHER",
          head,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/operations/exports/" + job.id + "/file", user))
        .status,
      403,
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as any);
    assert.equal(book.getWorksheet("SKU")!.getCell("B2").value, "000Q");
    assert.equal(book.getWorksheet("SKU")!.getCell("C2").value, 3);
    const issue = (await (
      await request("/api/operations/documents", checker, {
        warehouseId: "W",
        type: "ISSUE",
        lines: [
          {
            productId: "Q",
            locationId: "A",
            documentQuantity: 5,
            actualQuantity: 5,
            uom: "PCS",
          },
        ],
      })
    ).json()) as any;
    assert.equal(
      (
        await request(`/api/operations/documents/${issue.id}/submit`, checker, {
          warehouseId: "W",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/api/operations/documents/${issue.id}/verify`, admin, {
          warehouseId: "W",
        })
      ).status,
      200,
    );
    const adjustmentId = randomUUID(),
      positiveId = randomUUID();
    await db.transaction(async (tx) => {
      for (const [id, delta] of [
        [adjustmentId, -1],
        [positiveId, 1],
      ] as const) {
        const countId = randomUUID();
        await tx.query(
          "INSERT INTO stock_counts(id,warehouse,location,status,counted_by) VALUES ($1,'W','B','COMPLETED','fixture')",
          [countId],
        );
        await tx.query(
          "INSERT INTO adjustments(id,count_id,status) VALUES ($1,$2,'POSTED')",
          [id, countId],
        );
        await tx.query(
          "INSERT INTO adjustment_lines(adjustment_id,product,batch,delta,reason) VALUES ($1,'Q','',$2,'missing')",
          [id, delta],
        );
      }
    });
    assert.equal(
      (
        await request("/api/operations/exports", head, {
          warehouseId: "W",
          type: "SR",
          documentIds: [positiveId],
        })
      ).status,
      409,
    );
    const eligible = (await (
      await request("/api/operations/exports/eligible?type=SR", head)
    ).json()) as any;
    assert(eligible.items.some((d: any) => d.id === adjustmentId));
    assert(!eligible.items.some((d: any) => d.id === positiveId));
    const srPayload = {
      warehouseId: "W",
      type: "SR",
      documentIds: [issue.id, adjustmentId],
    };
    const attempts = await Promise.all([
      request("/api/operations/exports", head, srPayload),
      request("/api/operations/exports", head, srPayload),
    ]);
    assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
    const reduction = (await attempts
      .find((r) => r.status === 201)!
      .json()) as any;
    const reductionFile = await request(
      `/api/operations/exports/${reduction.id}/file`,
      head,
    );
    await book.xlsx.load(Buffer.from(await reductionFile.arrayBuffer()) as any);
    assert.equal(book.getWorksheet("SKU")!.getCell("B2").value, 6);
    const jobs = (await (
      await request("/api/operations/exports", head)
    ).json()) as any;
    assert.equal(
      jobs.items.find((j: any) => j.id === reduction.id).documentCount,
      2,
    );
    await db.transaction((tx) =>
      tx.query("UPDATE export_jobs SET checksum='corrupt' WHERE id=$1", [
        job.id,
      ]),
    );
    assert.equal(
      (await request("/api/operations/exports/" + job.id + "/file", head))
        .status,
      409,
    );
  } finally {
    if (previous === undefined) delete process.env.BIGSELLER_TEMPLATE_DIR;
    else process.env.BIGSELLER_TEMPLATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((r) => server.close(() => r()));
    await db.close();
  }
});

test("Head onboarding through HTTP produces persisted receiving stock without catalog SQL", async () => {
  const { db, server, request, login } = await fixture();
  try {
    const head = await login("head"),
      checker = await login("checker"),
      admin = await login("admin"),
      staff = await login("staff");
    const product = {
      code: "NEW",
      name: "New product",
      uom: "BOX",
      uomFactor: 6,
      trackBatch: true,
      trackExpiry: true,
    };
    for (const cookie of [staff]) {
      for (const [kind, data] of [
        ["products", product],
        ["locations", { id: "NEW-LOC" }],
        ["batches", { product: "NEW", batch: "LOT" }],
      ] as const)
        assert.equal(
          (await request(`/api/operations/${kind}`, cookie, data)).status,
          403,
        );
    }
    const key = randomUUID();
    assert.equal(
      (await request("/api/operations/products", head, product, "POST", key))
        .status,
      201,
    );
    assert.equal(
      (await request("/api/operations/products", head, product, "POST", key))
        .status,
      201,
    );
    assert.equal(
      (await request("/api/operations/products", head, product)).status,
      409,
    );
    assert.equal(
      (
        await request("/api/operations/products", head, {
          ...product,
          code: "INVALID",
          uomFactor: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/api/operations/locations", head, { id: "NEW-LOC" }))
        .status,
      201,
    );
    assert.equal(
      (
        await request("/api/operations/batches", head, {
          product: "NEW",
          batch: "LOT",
          expiry: "2027-02-30",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/operations/batches", head, {
          product: "NEW",
          batch: "LOT",
          expiry: "2027-02-28",
        })
      ).status,
      201,
    );
    const supplierResponse = await request("/api/operations/suppliers", head, {
      name: "New supplier",
    });
    assert.equal(supplierResponse.status, 201);
    const supplier = (await supplierResponse.json()) as any;
    const response = await request("/api/operations/documents", checker, {
      warehouseId: "W",
      type: "RECEIVING",
      supplierId: supplier.id,
      lines: [
        {
          productId: "NEW",
          locationId: "NEW-LOC",
          documentQuantity: 2,
          actualQuantity: 2,
          uom: "BOX",
          batch: "LOT",
          expiry: "2027-02-28",
        },
      ],
    });
    assert.equal(response.status, 201);
    const document = (await response.json()) as any;
    for (const [action, cookie] of [
      ["submit", checker],
      ["verify", admin],
    ])
      assert.equal(
        (
          await request(
            `/api/operations/documents/${document.id}/${action}`,
            cookie,
            { warehouseId: "W" },
          )
        ).status,
        200,
      );
    const stock = (await (
      await request("/api/operations/reports?kind=stock", head)
    ).json()) as any;
    assert.equal(
      stock.items.find((row: any) => row.product === "NEW").quantity,
      12,
    );
    const master = (await (
      await request("/api/operations/master", checker)
    ).json()) as any;
    assert(master.products.some((p: any) => p.id === "NEW"));
    assert(master.locations.some((p: any) => p.id === "NEW-LOC"));
    assert(!master.products.some((p: any) => p.id === "INVALID"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
