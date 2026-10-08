import { Pool } from "pg";

export async function connectDatabase(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

  try {
    const client = await pool.connect();
    client.release();
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
