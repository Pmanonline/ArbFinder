// table-tennis/scrapers/sofascore.js
import puppeteer from "puppeteer";
import pool from "../db/client.js";

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrapeUpcomingMatches() {
  let browser;
  try {
    console.log(
      "[TT-Scraper] 🚀 Launching Puppeteer for SofaScore Table Tennis...",
    );

    browser = await puppeteer.launch({
      headless: "new", // <-- USE "new" instead of true
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    );
    await page.setViewport({ width: 1366, height: 900 });

    console.log(
      "[TT-Scraper] Navigating to https://www.sofascore.com/table-tennis ...",
    );

    await page.goto("https://www.sofascore.com/table-tennis", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    console.log("[TT-Scraper] Page loaded. Waiting for content...");

    // Extra wait for dynamic loading
    await delay(10000);

    // Scroll down multiple times to load more matches
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await delay(4000);
      console.log(`[TT-Scraper] Scroll ${i + 1}/5`);
    }

    // Try to extract matches
    const matches = await page.evaluate(() => {
      const extracted = [];
      // Common selectors for SofaScore (updated 2026)
      const cards = document.querySelectorAll(
        'div[data-testid^="event-cell"], .EventCell, .match, [class*="event"]',
      );

      cards.forEach((card) => {
        try {
          // Player names
          const homeEl =
            card.querySelector(
              '.home, .participant-home, [data-testid="home-team"]',
            ) ||
            Array.from(card.querySelectorAll("span, div")).find(
              (el) => el.textContent && el.textContent.length > 3,
            );
          const awayEl =
            card.querySelector(
              '.away, .participant-away, [data-testid="away-team"]',
            ) ||
            Array.from(card.querySelectorAll("span, div")).find(
              (el) =>
                el.textContent && el.textContent.length > 3 && el !== homeEl,
            );

          const homeName = homeEl ? homeEl.textContent.trim() : null;
          const awayName = awayEl ? awayEl.textContent.trim() : null;

          const tournamentEl =
            card.closest(".tournament-header") ||
            card.querySelector(".league, .tournament-name, .category");
          const tournamentName = tournamentEl
            ? tournamentEl.textContent.trim()
            : "Table Tennis League";

          if (
            homeName &&
            awayName &&
            homeName.length > 2 &&
            awayName.length > 2
          ) {
            extracted.push({
              home: homeName,
              away: awayName,
              tournament: tournamentName,
            });
          }
        } catch (e) {}
      });

      return extracted;
    });

    console.log(
      `[TT-Scraper] Extracted ${matches.length} match pairs from the page`,
    );

    let saved = 0;

    for (const m of matches) {
      if (!m.home || !m.away) continue;

      const playerAId = await getOrCreatePlayer(m.home);
      const playerBId = await getOrCreatePlayer(m.away);
      const tournamentId = await getOrCreateTournament(m.tournament);

      const externalId =
        `tt_${Date.now()}_${m.home.substring(0, 10)}_${m.away.substring(0, 10)}`.replace(
          /[^a-zA-Z0-9]/g,
          "",
        );

      const query = `
        INSERT INTO matches (external_id, tournament_id, player_a_id, player_b_id, scheduled_at, status)
        VALUES ($1, $2, $3, $4, NOW() + INTERVAL '12 hours', 'upcoming')
        ON CONFLICT (external_id) DO NOTHING
        RETURNING id;
      `;

      const res = await pool.query(query, [
        externalId,
        tournamentId,
        playerAId,
        playerBId,
      ]);
      if (res.rowCount > 0) saved++;
    }

    console.log(`[TT-Scraper] ✅ Saved ${saved} new matches to DB`);

    return saved;
  } catch (err) {
    console.error("[TT-Scraper] ❌ Browser error:", err.message);
    return 0;
  } finally {
    if (browser) {
      await browser.close();
      console.log("[TT-Scraper] Browser closed.");
    }
  }
}

// Helper functions
async function getOrCreatePlayer(name) {
  const clean = name.trim();
  let res = await pool.query("SELECT id FROM players WHERE name = $1", [clean]);
  if (res.rows.length > 0) return res.rows[0].id;

  res = await pool.query(
    "INSERT INTO players (name) VALUES ($1) RETURNING id",
    [clean],
  );
  return res.rows[0].id;
}

async function getOrCreateTournament(name) {
  const clean = name.trim();
  let res = await pool.query("SELECT id FROM tournaments WHERE name = $1", [
    clean,
  ]);
  if (res.rows.length > 0) return res.rows[0].id;

  res = await pool.query(
    "INSERT INTO tournaments (name) VALUES ($1) RETURNING id",
    [clean],
  );
  return res.rows[0].id;
}

export default scrapeUpcomingMatches;
