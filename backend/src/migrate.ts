import { openDatabase, migrate } from "./runtime.js";
const db = await openDatabase();
try {
  await migrate(db);
} finally {
  await db.close();
}
