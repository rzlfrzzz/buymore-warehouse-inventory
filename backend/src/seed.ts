import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth.js";
import { openDatabase, migrate } from "./runtime.js";
if (process.env.NODE_ENV === "production" || process.env.DEV_SEED !== "true")
  throw new Error("Explicit DEV_SEED=true required; never seed production");
const password = process.env.DEV_SEED_PASSWORD;
if (!password || password.length < 12 || password.length > 256)
  throw new Error("Set DEV_SEED_PASSWORD (12-256 characters)");
const db = await openDatabase();
try {
  await migrate(db);
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    for (const [username, role] of [
      ["staff", "User"],
      ["admin", "Admin"],
      ["head", "Admin"],
    ]) {
      const id = randomUUID();
      const created = (
        await tx.query(
          "INSERT INTO users VALUES ($1,$2,$3,true) ON CONFLICT(username) DO NOTHING RETURNING id",
          [id, username, hash],
        )
      ).rows[0];
      if (created)
        await tx.query("INSERT INTO memberships VALUES ($1,$2,$3)", [
          id,
          "GDG-01",
          role,
        ]);
    }
    await tx.query(
      "INSERT INTO locations VALUES ('GDG-01','A-01'),('GDG-01','A-02'),('GDG-02','B-01') ON CONFLICT DO NOTHING",
    );
    await tx.query(
      "INSERT INTO products(code,name) VALUES ('MAT-001','Material 001') ON CONFLICT DO NOTHING",
    );
    await tx.query(
      "INSERT INTO product_batches(product,batch) VALUES ('MAT-001','LOT-01') ON CONFLICT DO NOTHING",
    );
    if (
      !(
        await tx.query(
          "SELECT 1 FROM inventory_ledger WHERE warehouse='GDG-01'",
        )
      ).rows.length
    )
      await tx.query(
        "INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor) VALUES ($1,'GDG-01','A-01','MAT-001','LOT-01',100,'development-seed')",
        [randomUUID()],
      );
  });
  console.log(
    "Development users ready: staff, admin, head. Existing passwords are unchanged. Membership: GDG-01 only.",
  );
} finally {
  await db.close();
}
