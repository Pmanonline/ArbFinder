// table-tennis/index-predict.js - Predictions only (no scraping)
import generatePredictions from "./services/predictor.js";
import { bootstrapElo } from "./services/elo-bootstrap.js";
import {
  sendValueBetAlert,
  sendDailyReport,
} from "./services/telegramAlerts.js";
import pool from "./db/client.js";
import dotenv from "dotenv";

dotenv.config();

async function getDatabaseStats() {
  const [players, matches, ratings, upcoming] = await Promise.all([
    pool.query("SELECT COUNT(*) as count FROM players"),
    pool.query(
      "SELECT COUNT(*) as count FROM matches WHERE status = 'upcoming'",
    ),
    pool.query(
      "SELECT COUNT(DISTINCT player_id) as count FROM player_ratings WHERE effective_date > NOW() - INTERVAL '30 days'",
    ),
    pool.query(
      "SELECT COUNT(*) as count FROM matches WHERE status = 'upcoming' AND scheduled_at > NOW() AND scheduled_at < NOW() + INTERVAL '7 days'",
    ),
  ]);

  return {
    totalPlayers: parseInt(players.rows[0].count),
    totalMatches: parseInt(matches.rows[0].count),
    activePlayers: parseInt(ratings.rows[0].count),
    upcomingMatches: parseInt(upcoming.rows[0].count),
  };
}

async function getTopPlayers() {
  const { rows } = await pool.query(`
    SELECT p.name, r.rating_value 
    FROM player_ratings r
    JOIN players p ON r.player_id = p.id
    WHERE r.effective_date = CURRENT_DATE
    ORDER BY r.rating_value DESC
    LIMIT 5
  `);
  return rows;
}

async function main() {
  const startTime = Date.now();
  console.log("🏓 Table Tennis Value Bet Finder - Daily Run");
  console.log(`📅 ${new Date().toLocaleString()}\n`);

  try {
    // ── Step 1: Refresh Elo ratings with last 7 days of results ──────────────
    // Full 90-day bootstrap is run manually; daily refresh keeps ratings current.
    console.log("🔄 Refreshing Elo ratings (last 7 days)...");
    try {
      await bootstrapElo(7);
      console.log("✅ Elo ratings refreshed\n");
    } catch (eloErr) {
      // Non-fatal — predictions can still run with yesterday's ratings
      console.warn(
        `⚠️  Elo refresh failed (using cached ratings): ${eloErr.message}\n`,
      );
    }

    // ── Step 2: Database status ───────────────────────────────────────────────
    const stats = await getDatabaseStats();
    console.log("📊 Database Status:");
    console.log(`   • Total Players: ${stats.totalPlayers.toLocaleString()}`);
    console.log(`   • Total Matches: ${stats.totalMatches.toLocaleString()}`);
    console.log(
      `   • Upcoming (7d): ${stats.upcomingMatches.toLocaleString()}`,
    );
    console.log(
      `   • Active Players (30d): ${stats.activePlayers.toLocaleString()}\n`,
    );

    // ── Step 3: Top players ───────────────────────────────────────────────────
    const topPlayers = await getTopPlayers();
    if (topPlayers.length > 0) {
      console.log("🏆 Top 5 Players by Elo:");
      topPlayers.forEach((p, i) => {
        const name =
          p.name.length > 35 ? p.name.substring(0, 32) + "..." : p.name;
        console.log(`   ${i + 1}. ${name}: ${Math.round(p.rating_value)}`);
      });
      console.log();
    }

    // ── Step 4: Generate predictions ─────────────────────────────────────────
    console.log("🎯 Analyzing value bets...");
    const { predictions, valueBets } = await generatePredictions();

    // ── Step 5: Send up to 10 alerts ─────────────────────────────────────────
    const MAX_ALERTS = 10;

    if (valueBets && valueBets.length > 0) {
      console.log(
        `\n💰 Found ${valueBets.length} value bets! Sending top ${Math.min(valueBets.length, MAX_ALERTS)} to Telegram...`,
      );

      for (const bet of valueBets.slice(0, MAX_ALERTS)) {
        console.log(
          `   • ${bet.playerA} vs ${bet.playerB}: +${bet.edgePercent}% edge`,
        );
        await sendValueBetAlert(bet);
        await new Promise((r) => setTimeout(r, 1500)); // 1.5s gap to avoid Telegram rate limits
      }

      if (valueBets.length > MAX_ALERTS) {
        console.log(
          `   ℹ️  ${valueBets.length - MAX_ALERTS} additional bets not sent (cap: ${MAX_ALERTS})`,
        );
      }
    } else {
      console.log("\n📊 No value bets found above threshold today.");
      console.log(
        `   (Threshold: >2% edge required, HIGH/MEDIUM confidence only)`,
      );
    }

    // ── Step 6: Daily summary report ──────────────────────────────────────────
    const runtime = ((Date.now() - startTime) / 1000).toFixed(1);
    const summaryStats = {
      totalMatches: predictions?.length || 0,
      valueBets: valueBets?.length || 0,
      topMatch: valueBets?.[0]
        ? `${valueBets[0].playerA} vs ${valueBets[0].playerB}`
        : null,
      topEdge: valueBets?.[0] ? `${valueBets[0].edgePercent}%` : null,
      activePlayers: stats.activePlayers,
      avgElo: topPlayers.length
        ? Math.round(
            topPlayers.reduce((sum, p) => sum + p.rating_value, 0) /
              topPlayers.length,
          )
        : 1650,
      runtime,
    };

    await sendDailyReport(summaryStats);

    console.log(`\n✅ Daily run complete (${runtime}s)`);
    console.log(`   📊 Analyzed: ${summaryStats.totalMatches} matches`);
    console.log(`   🎯 Value bets: ${summaryStats.valueBets}`);
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(console.error);
