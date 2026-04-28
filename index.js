// table-tennis/index.js
import UnifiedTableTennisScraper from "./scrapers/unified-scraper.js";
import generatePredictions from "./services/predictor.js";
import {
  sendValueBetAlert,
  sendDailyReport,
} from "./services/telegramAlerts.js";
import pool from "./db/client.js";
import dotenv from "dotenv";

dotenv.config();

async function getActivePlayersCount() {
  const { rows } = await pool.query("SELECT COUNT(*) as count FROM players");
  return rows[0]?.count || 0;
}

async function getAverageElo() {
  const { rows } = await pool.query(
    "SELECT AVG(rating_value) as avg FROM player_ratings WHERE effective_date = CURRENT_DATE",
  );
  return rows[0]?.avg ? Math.round(rows[0].avg) : null;
}

async function main() {
  console.log("🏓 Table Tennis Predictive System v3.0 - Multi-Source\n");

  const scraper = new UnifiedTableTennisScraper();

  try {
    await scraper.init();

    // 1. Scrape all sources
    console.log("[Step 1] Scraping multiple data sources...");
    const matches = await scraper.scrapeAllSources();

    // 2. Save matches to database
    if (matches.length > 0) {
      console.log("\n[Step 2] Saving matches to database...");
      await scraper.saveMatchesToDB(matches);
    } else {
      console.log("\n[Step 2] No new matches found");
    }

    // 3. Fetch player rankings
    console.log("\n[Step 3] Fetching player rankings...");
    await scraper.scrapeITTFData();

    // 4. Generate predictions
    console.log("\n[Step 4] Analyzing value bets...");
    const { predictions, valueBets } = await generatePredictions();

    // 5. Send alerts
    if (valueBets && valueBets.length > 0) {
      console.log(
        `\n[Step 5] Sending ${Math.min(3, valueBets.length)} alerts...`,
      );
      for (const bet of valueBets.slice(0, 3)) {
        await sendValueBetAlert(bet);
        await new Promise((r) => setTimeout(r, 2000));
      }
    } else {
      console.log("\n[Step 5] No value bets to alert");
    }

    // 6. Daily summary
    const stats = {
      totalMatches: predictions?.length || 0,
      valueBets: valueBets?.length || 0,
      topMatch: valueBets?.[0]
        ? `${valueBets[0].playerA} vs ${valueBets[0].playerB}`
        : null,
      topEdge: valueBets?.[0] ? `${valueBets[0].edgePercent}%` : null,
      activePlayers: await getActivePlayersCount(),
      avgElo: await getAverageElo(),
    };

    await sendDailyReport(stats);

    console.log("\n✅ System ready!");
    console.log(`   📊 Predictions: ${stats.totalMatches}`);
    console.log(`   🎯 Value bets: ${stats.valueBets}`);
  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    await scraper.close();
    await pool.end().catch(() => {});
  }
}

main().catch(console.error);
