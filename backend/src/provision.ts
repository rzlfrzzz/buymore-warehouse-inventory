import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth.js";
import { openDatabase } from "./runtime.js";
const username = process.env.ADMIN_USERNAME?.trim().toLowerCase(),
  password = process.env.ADMIN_PASSWORD,
  warehouse = process.env.ADMIN_WAREHOUSE?.trim(),
  role = process.env.ADMIN_ROLE?.trim() || "Admin";
if (
  !username ||
  !/^[a-z0-9._-]{1,100}$/.test(username) ||
  !password ||
  password.length < 16 ||
  password.length > 256 ||
  !warehouse ||
  warehouse.length > 100 ||
  role !== "Admin"
)
  throw new Error(
    "ADMIN_USERNAME, ADMIN_PASSWORD (16-256 characters), ADMIN_WAREHOUSE, optional ADMIN_ROLE=Admin required",
  );
const db = await openDatabase();
try {
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(6190307)");
    if (
      (await tx.query("SELECT 1 FROM memberships WHERE role='Admin' LIMIT 1"))
        .rows.length
    )
      throw new Error("First-admin provisioning refused: Admin already exists");
    const id = randomUUID();
    await tx.query(
      "INSERT INTO users(id,username,password_hash) VALUES ($1,$2,$3)",
      [id, username, hash],
    );
    await tx.query("INSERT INTO memberships VALUES ($1,$2,$3)", [
      id,
      warehouse,
      role,
    ]);
  });
  console.log(
    `First ${role} provisioned. Create users from the Admin workspace.`,
  );
} finally {
  await db.close();
}
