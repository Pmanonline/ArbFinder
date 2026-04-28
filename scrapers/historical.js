// table-tennis/scrapers/historical.js (updated selectors)
import puppeteer from "puppeteer";
import pool from "../db/client.js";
import { updateElo } from "../utils/elo.js";

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrapeHistoricalResults() {
  let browser;
  try {
    console.log("[TT-Historical] 📜 Scraping historical results...");
    
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    
    // Try different URLs for completed matches
    await page.goto("https://www.sofascore.com/table-tennis", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    
    await delay(5000);
    
    // Click on "Completed" tab if exists
    try {
      const completedTab = await page.$('button:has-text("Completed"), div:has-text("Completed"), [data-testid*="completed"]');
      if (completedTab) {
        await completedTab.click();
        await delay(3000);
      }
    } catch(e) {}
    
    // Extract completed matches with broader selectors
    const completed = await page.evaluate(() => {
      const matches = [];
      
      // Try multiple possible selectors
      const selectors = [
        '[data-testid*="event-cell"]',
        '[class*="EventCell"]',
        '[class*="match"]',
        'tr[class*="event"]',
        'div[class*="event"]'
      ];
      
      let elements = [];
      for (const selector of selectors) {
        elements = document.querySelectorAll(selector);
        if (elements.length > 0) break;
      }
      
      elements.forEach((row) => {
        try {
          // Get all text content
          const text = row.textContent || "";
          
          // Look for score patterns like "3-1", "3:1", "4-2"
          const scoreMatch = text.match(/(\d+)[-:](\d+)/);
          if (!scoreMatch) return;
          
          // Extract team names (usually before the score)
          const parts = text.split(scoreMatch[0]);
          let home = "", away = "";
          
          if (parts.length >= 2) {
            // First part contains team names
            const teamText = parts[0].trim();
            const teamParts = teamText.split(/\s{2,}|\n/);
            if (teamParts.length >= 2) {
              home = teamParts[0].trim();
              away = teamParts[1].trim();
            } else {
              // Try to find two names
              const words = teamText.split(/\s+/);
              if (words.length >= 4) {
                const mid = Math.floor(words.length / 2);
                home = words.slice(0, mid).join(" ");
                away = words.slice(mid).join(" ");
              }
            }
          }
          
          if (home && away && home.length > 2 && away.length > 2) {
            matches.push({
              home: home.substring(0, 50),
              away: away.substring(0, 50),
              score: scoreMatch[0],
              setsA: parseInt(scoreMatch[1]),
              setsB: parseInt(scoreMatch[2])
            });
          }
        } catch(e) {}
      });
      
      return matches;
    });
    
    console.log(`[TT-Historical] Found ${completed.length} completed matches`);
    
    let updatedCount = 0;
    
    for (const match of completed) {
      const result = await processCompletedMatch(match);
      if (result) updatedCount++;
      await delay(500); // Rate limiting
    }
    
    console.log(`[TT-Historical] ✅ Updated ${updatedCount} matches with Elo ratings`);
    
    return updatedCount;
  } catch (err) {
    console.error("[TT-Historical] Error:", err.message);
    return 0;
  } finally {
    if (browser) await browser.close();
  }
}

async function processCompletedMatch(match) {
  try {
    const setsA = match.setsA;
    const setsB = match.setsB;
    const winner = setsA > setsB ? match.home : match.away;
    
    // Get or create players
    const playerAId = await getOrCreatePlayer(match.home);
    const playerBId = await getOrCreatePlayer(match.away);
    
    // Get current ratings
    const ratings = await getPlayerRatings(playerAId, playerBId);
    
    // Update Elo based on result
    const result = updateElo({
      ratingA: ratings.ratingA,
      ratingB: ratings.ratingB,
      winner: winner === match.home ? 'A' : 'B',
      setsA: setsA,
      setsB: setsB,
      kFactor: 32
    });
    
    // Store new ratings
    await storeRating(playerAId, result.newRatingA);
    await storeRating(playerBId, result.newRatingB);
    
    console.log(`  📊 ${match.home} vs ${match.away}: ${setsA}-${setsB} → Elo updated`);
    
    return true;
  } catch (err) {
    return false;
  }
}

async function getOrCreatePlayer(name) {
  const clean = name.trim().substring(0, 100);
  const res = await pool.query("SELECT id FROM players WHERE name = $1", [clean]);
  if (res.rows.length > 0) return res.rows[0].id;
  
  const insert = await pool.query(
    "INSERT INTO players (name) VALUES ($1) RETURNING id",
    [clean]
  );
  return insert.rows[0].id;
}

async function getPlayerRatings(playerAId, playerBId) {
  const resA = await pool.query(
    "SELECT rating_value FROM player_ratings WHERE player_id = $1 ORDER BY effective_date DESC LIMIT 1",
    [playerAId]
  );
  const resB = await pool.query(
    "SELECT rating_value FROM player_ratings WHERE player_id = $1 ORDER BY effective_date DESC LIMIT 1",
    [playerBId]
  );
  
  return {
    ratingA: resA.rows[0]?.rating_value || 1500,
    ratingB: resB.rows[0]?.rating_value || 1500
  };
}

async function storeRating(playerId, newRating) {
  await pool.query(
    `INSERT INTO player_ratings (player_id, rating_value, effective_date)
     VALUES ($1, $2, CURRENT_DATE)`,
    [playerId, newRating]
  );
}

export default scrapeHistoricalResults;