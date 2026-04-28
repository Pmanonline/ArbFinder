// table-tennis/db/migrate.js
import pool from "./db/client.js";

async function migrate() {
  console.log("Running migrations...");

  try {
    // 1. Add games_played column
    await pool.query(`
      ALTER TABLE player_ratings 
      ADD COLUMN IF NOT EXISTS games_played INTEGER DEFAULT 0
    `);
    console.log("✅ Added games_played column");

    // 2. Remove duplicate entries (keep the most recent for each player/date)
    console.log("Cleaning duplicate entries...");
    await pool.query(`
      DELETE FROM player_ratings a
      USING player_ratings b
      WHERE a.id < b.id 
        AND a.player_id = b.player_id 
        AND a.effective_date = b.effective_date
    `);
    console.log("✅ Duplicates removed");

    // 3. Add unique constraint
    try {
      await pool.query(`
        ALTER TABLE player_ratings 
        ADD CONSTRAINT unique_player_date 
        UNIQUE (player_id, effective_date)
      `);
      console.log("✅ Added unique constraint");
    } catch (err) {
      if (err.code === "42P07") {
        console.log("ℹ️ Constraint already exists");
      } else {
        throw err;
      }
    }

    console.log("\n✅ Migrations complete!");
  } catch (err) {
    console.error("Migration error:", err.message);
  } finally {
    await pool.end();
  }
}

migrate();
