import "dotenv/config";
import { Pool } from "pg";
import { CatalogService } from "../services/catalog.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

try {
  const catalog = new CatalogService(pool);
  const [deletedRooms, deletedProfiles, deletedRateLimits, expiredConnectionLeases] = await Promise.all([
    catalog.cleanupEmptyRooms(30),
    catalog.cleanupUnusedProfiles(90),
    catalog.cleanupExpiredRateLimits(),
    catalog.cleanupExpiredWebSocketConnections(),
  ]);
  console.info(
    `Retention cleanup removed ${deletedRooms.length} room(s), `
    + `${deletedProfiles.length} unused profile(s), `
    + `${deletedRateLimits} expired rate-limit counter(s), and `
    + `${expiredConnectionLeases} expired WebSocket connection lease(s).`,
  );
} catch (error) {
  console.error("Retention cleanup failed.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
