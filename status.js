// table-tennis/status.js - Quick health check
import pool from "./db/client.js";
import dotenv from "dotenv";

dotenv.config();

async function status() {
  try {
    const [players, matches, ratings, upcoming] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM players"),
      pool.query("SELECT COUNT(*) FROM matches WHERE status = 'upcoming'"),
      pool.query(
        "SELECT COUNT(DISTINCT player_id) FROM player_ratings WHERE effective_date > NOW() - INTERVAL '30 days'",
      ),
      pool.query(
        "SELECT COUNT(*) FROM matches WHERE status = 'upcoming' AND scheduled_at > NOW() AND scheduled_at < NOW() + INTERVAL '7 days'",
      ),
    ]);

    const topPlayers = await pool.query(`
      SELECT p.name, r.rating_value 
      FROM player_ratings r
      JOIN players p ON r.player_id = p.id
      WHERE r.effective_date = CURRENT_DATE
      ORDER BY r.rating_value DESC
      LIMIT 5
    `);

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           TABLE TENNIS VALUE BET SYSTEM - STATUS            ║
╠══════════════════════════════════════════════════════════════╣
║  📊 Database Statistics:                                    ║
║     • Total Players:     ${String(players.rows[0].count).padStart(10)}                                  ║
║     • Total Matches:     ${String(matches.rows[0].count).padStart(10)}                                  ║
║     • Upcoming (7d):     ${String(upcoming.rows[0].count).padStart(10)}                                  ║
║     • Active Players:    ${String(ratings.rows[0].count).padStart(10)}                                  ║
╠══════════════════════════════════════════════════════════════╣
║  🏆 Top Players:                                            ║
${topPlayers.rows.map((p, i) => `║     ${i + 1}. ${(p.name.substring(0, 35) + "...").padEnd(38)} ${Math.round(p.rating_value)} ║`).join("\n")}
╠══════════════════════════════════════════════════════════════╣
║  ✅ System ready for daily predictions                      ║
╚══════════════════════════════════════════════════════════════╝
    `);

    await pool.end();
  } catch (err) {
    console.error("❌ Status check failed:", err.message);
    process.exit(1);
  }
}

status();
