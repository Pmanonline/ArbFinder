// table-tennis/index-predict.js
import generatePredictions from "./services/predictor.js";
import { bootstrapElo } from "./services/elo-bootstrap.js";
import { generateOverUnderPredictions } from "./services/over-under-predictor.js";
import { startBot, sendOverUnderAlertBot } from "./services/telegramBot.js";
import {
  sendValueBetAlert,
  sendDailyReport,
} from "./services/telegramAlerts.js";
import UnifiedTableTennisScraper from "./scrapers/unified-scraper.js";
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

async function getUpcomingMatchesForOU() {
  const { rows } = await pool.query(`
    SELECT 
      m.id, m.external_id,
      p1.name as player_a, p2.name as player_b,
      t.name as tournament, m.scheduled_at,
      COALESCE(r1.rating_value, 1500) as rating_a,
      COALESCE(r2.rating_value, 1500) as rating_b,
      COALESCE(r1.games_played, 0) as games_a,
      COALESCE(r2.games_played, 0) as games_b
    FROM matches m
    JOIN players p1 ON m.player_a_id = p1.id
    JOIN players p2 ON m.player_b_id = p2.id
    LEFT JOIN tournaments t ON m.tournament_id = t.id
    LEFT JOIN LATERAL (
      SELECT rating_value, games_played FROM player_ratings 
      WHERE player_id = p1.id AND games_played >= 5
      ORDER BY effective_date DESC LIMIT 1
    ) r1 ON true
    LEFT JOIN LATERAL (
      SELECT rating_value, games_played FROM player_ratings 
      WHERE player_id = p2.id AND games_played >= 5
      ORDER BY effective_date DESC LIMIT 1
    ) r2 ON true
    WHERE m.status = 'upcoming'
      AND m.scheduled_at > NOW()
      AND m.scheduled_at < NOW() + INTERVAL '24 hours'
      AND m.player_a_id != m.player_b_id
    ORDER BY m.scheduled_at ASC
    LIMIT 200
  `);
  return rows;
}

async function main() {
  const startTime = Date.now();
  console.log("🏓 Table Tennis Value Bet Finder - Daily Run");
  console.log(`📅 ${new Date().toLocaleString()}\n`);

  try {
    // ── Start Telegram bot (enables /scan, /status, /help commands) ───────────
    console.log("[TT-Bot] Starting Telegram bot...");
    startBot();
    console.log("[TT-Bot] Bot listening for /scan, /status, /help\n");

    // ── Step 1: Refresh Elo ratings ───────────────────────────────────────────
    console.log("🔄 Refreshing Elo ratings (last 7 days)...");
    try {
      await bootstrapElo(7);
      console.log("✅ Elo ratings refreshed\n");
    } catch (eloErr) {
      console.warn(
        `⚠️  Elo refresh failed (using cached ratings): ${eloErr.message}\n`,
      );
    }

    // ── Step 2: Scrape fresh matches ──────────────────────────────────────────
    console.log("🔍 Scraping fresh matches...");
    try {
      const scraper = new UnifiedTableTennisScraper();
      await scraper.init();
      const scraped = await scraper.scrapeAllSources();
      await scraper.saveMatchesToDB(scraped);
      await scraper.close();
      console.log(`✅ Scraped ${scraped.length} matches\n`);
    } catch (scrapeErr) {
      console.warn(`⚠️  Scrape failed: ${scrapeErr.message}\n`);
    }

    // ── Step 3: Database status ───────────────────────────────────────────────
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

    // ── Step 4: Top players ───────────────────────────────────────────────────
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

    // ── Step 5: Generate value bets ───────────────────────────────────────────
    console.log("🎯 Analyzing value bets...");
    const { predictions, valueBets } = await generatePredictions();

    // ── Step 6: Generate Over/Under predictions ───────────────────────────────
    console.log("📐 Generating Over/Under predictions...");
    const upcomingMatches = await getUpcomingMatchesForOU();
    const ouPredictions = await generateOverUnderPredictions(upcomingMatches);
    console.log(`   Found ${ouPredictions.length} O/U signals\n`);

    // ── Step 7: Send value bet alerts (up to 10) ──────────────────────────────
    const MAX_ALERTS = 10;

    if (valueBets && valueBets.length > 0) {
      console.log(
        `\n💰 Found ${valueBets.length} value bets! Sending top ${Math.min(valueBets.length, MAX_ALERTS)}...`,
      );
      for (const bet of valueBets.slice(0, MAX_ALERTS)) {
        console.log(
          `   • ${bet.playerA} vs ${bet.playerB}: +${bet.edgePercent}% edge`,
        );
        await sendValueBetAlert(bet);
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (valueBets.length > MAX_ALERTS) {
        console.log(
          `   ℹ️  ${valueBets.length - MAX_ALERTS} additional bets not sent (cap: ${MAX_ALERTS})`,
        );
      }
    } else {
      console.log("\n📊 No value bets found above threshold today.");
    }

    // ── Step 8: Send Over/Under alerts (up to 10) ─────────────────────────────
    if (ouPredictions.length > 0) {
      console.log(
        `\n📐 Sending ${Math.min(ouPredictions.length, MAX_ALERTS)} O/U predictions...`,
      );
      for (const ou of ouPredictions.slice(0, MAX_ALERTS)) {
        console.log(
          `   • ${ou.playerA} vs ${ou.playerB} | Sets: ${ou.sets.recommendation} | Pts: ${ou.points.recommendation}`,
        );
        await sendOverUnderAlertBot(ou);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    // ── Step 9: Daily summary ─────────────────────────────────────────────────
    const runtime = ((Date.now() - startTime) / 1000).toFixed(1);
    const summaryStats = {
      totalMatches: predictions?.length || 0,
      valueBets: valueBets?.length || 0,
      ouPredictions: ouPredictions.length,
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
    console.log(`   📐 O/U signals: ${summaryStats.ouPredictions}`);

    // ── Keep process alive for bot polling ────────────────────────────────────
    // Bot polling keeps the process running so /scan works anytime
    console.log(
      "\n🤖 Bot active — send /scan in Telegram to trigger a fresh scan anytime.",
    );
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
  // NOTE: No pool.end() here — bot polling keeps process alive
}

main().catch(console.error);
