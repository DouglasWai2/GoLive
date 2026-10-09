import "dotenv/config";
import { Pool } from "pg";
import { CatalogService } from "../services/catalog.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

try {
  const deleted = await new CatalogService(pool).cleanupEmptyRooms(30);
  console.info(`Removed ${deleted.length} room(s) empty for more than 30 days.`);
} catch (error) {
  console.error("Empty room cleanup failed.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
