// table-tennis/db/client.js
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[TT-DB] ❌ DATABASE_URL is not defined in .env");
  process.exit(1);
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Railway PostgreSQL
  },
});

// Global error handler for idle clients
pool.on("error", (err) => {
  console.error("[TT-DB] Unexpected error on idle client:", err.message);
});

console.log("[TT-DB] Pool created successfully with Railway connection string");

// Quick connection test on load
pool
  .query("SELECT NOW()")
  .then(() => {
    console.log("[TT-DB] ✅ Successfully connected to Railway PostgreSQL");
  })
  .catch((err) => {
    console.error("[TT-DB] ❌ Initial connection test failed:", err.message);
  });

export default pool;
