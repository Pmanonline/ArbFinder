// // Uses SofaScore's JSON API directly — no DOM scraping needed
// import axios from "axios";
// import pool from "../db/client.js";

// const DELAY = (ms) => new Promise((r) => setTimeout(r, ms));

// const SOFA_HEADERS = {
//   "User-Agent":
//     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
//   Accept: "application/json",
//   "Accept-Language": "en-US,en;q=0.9",
//   Referer: "https://www.sofascore.com/",
//   Origin: "https://www.sofascore.com",
// };

// class UnifiedTableTennisScraper {
//   constructor() {
//     this.allMatches = new Map();
//   }

//   async init() {
//     console.log(
//       "[TT-Scraper] Scraper initialized (API mode — no browser needed)",
//     );
//   }

//   async close() {
//     console.log("[TT-Scraper] Scraper closed");
//   }

//   // ── SofaScore JSON API ──────────────────────────────────────────────────────
//   async scrapeSofaScore() {
//     const matches = [];
//     try {
//       // Fetch today + next 3 days
//       for (let dayOffset = 0; dayOffset < 4; dayOffset++) {
//         const date = new Date();
//         date.setDate(date.getDate() + dayOffset);
//         const dateStr = date.toISOString().split("T")[0]; // "2026-04-27"

//         const url = `https://api.sofascore.com/api/v1/sport/table-tennis/scheduled-events/${dateStr}`;
//         const res = await axios.get(url, {
//           headers: SOFA_HEADERS,
//           timeout: 10000,
//         });
//         const events = res.data?.events || [];

//         for (const ev of events) {
//           const home = ev.homeTeam?.name || ev.homeTeam?.shortName;
//           const away = ev.awayTeam?.name || ev.awayTeam?.shortName;
//           const tournament =
//             ev.tournament?.name ||
//             ev.tournament?.category?.name ||
//             "Table Tennis";
//           const scheduledAt = ev.startTimestamp
//             ? new Date(ev.startTimestamp * 1000).toISOString()
//             : null;

//           if (home && away && home.length > 2 && away.length > 2) {
//             matches.push({
//               home: home.trim().substring(0, 100),
//               away: away.trim().substring(0, 100),
//               tournament: tournament.substring(0, 100),
//               scheduledAt,
//               source: "SofaScore",
//               externalId: `sofa_${ev.id}`,
//             });
//           }
//         }

//         await DELAY(500); // Rate limit
//       }

//       console.log(
//         `[TT-Scraper] SofaScore API: ${matches.length} matches across 4 days`,
//       );
//     } catch (err) {
//       console.error("[TT-Scraper] SofaScore API error:", err.message);
//     }
//     return matches;
//   }

//   // ── FlashScore API (undocumented but stable) ────────────────────────────────
//   async scrapeFlashScore() {
//     const matches = [];
//     try {
//       // FlashScore uses a widget API
//       const url = "https://d.flashscore.com/x/feed/f_1_3_en_1";
//       const res = await axios.get(url, {
//         headers: {
//           "User-Agent": SOFA_HEADERS["User-Agent"],
//           "x-fsign": "SW9D1eZo", // public sign used in their widget
//         },
//         timeout: 10000,
//       });

//       // Response is pipe-separated text, not JSON
//       const lines = (res.data || "").split("¬");
//       let home = null,
//         away = null;

//       for (const line of lines) {
//         if (line.startsWith("AA÷")) home = line.replace("AA÷", "").trim();
//         if (line.startsWith("AB÷")) away = line.replace("AB÷", "").trim();
//         if (home && away) {
//           if (home.length > 2 && away.length > 2) {
//             matches.push({
//               home,
//               away,
//               tournament: "Table Tennis",
//               source: "FlashScore",
//               externalId: `fs_${home}_${away}_${Date.now()}`,
//             });
//           }
//           home = null;
//           away = null;
//         }
//       }

//       console.log(`[TT-Scraper] FlashScore: ${matches.length} matches`);
//     } catch (err) {
//       // FlashScore often requires auth — silently skip
//       console.log("[TT-Scraper] FlashScore unavailable — skipping");
//     }
//     return matches;
//   }

//   // ── World Table Tennis / ITTF alternative ───────────────────────────────────
//   async scrapeITTFData() {
//     console.log("[TT-Scraper] Fetching WTT rankings (ITTF alternative)...");
//     const rankings = [];
//     try {
//       // WTT (World Table Tennis) has a public API
//       const url =
//         "https://api.worldtabletennis.com/rankings?type=WR&genderType=M&limit=100&offset=0";
//       const res = await axios.get(url, {
//         headers: { "User-Agent": SOFA_HEADERS["User-Agent"] },
//         timeout: 10000,
//       });

//       const players = res.data?.data?.rankings || res.data?.rankings || [];
//       for (const p of players) {
//         const name = p.playerName || p.name || p.firstName + " " + p.lastName;
//         const rank = p.rank || p.position;
//         const points = p.points || p.rankingPoints;
//         if (name && rank)
//           rankings.push({ name: name.trim(), rank, points, source: "WTT" });
//       }

//       console.log(`[TT-Scraper] WTT rankings: ${rankings.length} players`);

//       // Update DB
//       for (const player of rankings) {
//         await pool
//           .query(`UPDATE players SET ittf_rank = $1 WHERE name ILIKE $2`, [
//             player.rank,
//             `%${player.name.split(" ")[0]}%`,
//           ])
//           .catch(() => {});
//       }
//     } catch (err) {
//       // Try backup: tabletennis11.com doesn't require auth
//       try {
//         const url2 =
//           "https://www.tabletennis11.com/api/ittf-ranking?gender=M&limit=50";
//         const res2 = await axios.get(url2, {
//           headers: { "User-Agent": SOFA_HEADERS["User-Agent"] },
//           timeout: 8000,
//         });
//         const players2 = res2.data?.data || res2.data?.players || [];
//         for (const p of players2) {
//           const name = p.name || p.player_name;
//           if (name) rankings.push({ name, rank: p.rank, source: "TT11" });
//         }
//         console.log(`[TT-Scraper] TT11 rankings: ${rankings.length} players`);
//       } catch (_) {
//         console.log(
//           "[TT-Scraper] Rankings unavailable — skipping (won't affect predictions)",
//         );
//       }
//     }
//     return rankings;
//   }

//   async scrapeAllSources() {
//     const results = await Promise.allSettled([
//       this.scrapeSofaScore(),
//       this.scrapeFlashScore(),
//     ]);

//     const allMatches = [];
//     for (const r of results) {
//       if (r.status === "fulfilled" && Array.isArray(r.value)) {
//         allMatches.push(...r.value);
//       }
//     }

//     return this.deduplicateMatches(allMatches);
//   }

//   deduplicateMatches(matches) {
//     const seen = new Map();
//     for (const m of matches) {
//       // Prefer SofaScore externalId as the key
//       const key = m.externalId?.startsWith("sofa_")
//         ? m.externalId
//         : `${m.home.toLowerCase()}|${m.away.toLowerCase()}`;
//       if (!seen.has(key)) seen.set(key, m);
//     }
//     return [...seen.values()];
//   }

//   async saveMatchesToDB(matches) {
//     let saved = 0;
//     for (const match of matches) {
//       try {
//         const playerAId = await this.getOrCreatePlayer(match.home);
//         const playerBId = await this.getOrCreatePlayer(match.away);
//         const tournamentId = await this.getOrCreateTournament(match.tournament);
//         const externalId = (
//           match.externalId || `${match.source}_${match.home}_${match.away}`
//         ).substring(0, 100);
//         const scheduledAt = match.scheduledAt || "NOW() + INTERVAL '12 hours'";

//         await pool.query(
//           `INSERT INTO matches (external_id, tournament_id, player_a_id, player_b_id, scheduled_at, status)
//            VALUES ($1, $2, $3, $4, $5::timestamptz, 'upcoming')
//            ON CONFLICT (external_id) DO NOTHING`,
//           [
//             externalId,
//             tournamentId,
//             playerAId,
//             playerBId,
//             match.scheduledAt ||
//               new Date(Date.now() + 12 * 3600000).toISOString(),
//           ],
//         );
//         saved++;
//       } catch (_) {}
//     }
//     console.log(`[TT-Scraper] Saved ${saved} new matches to DB`);
//     return saved;
//   }

//   async getOrCreatePlayer(name) {
//     const clean = name.trim().substring(0, 100);
//     let res = await pool.query("SELECT id FROM players WHERE name = $1", [
//       clean,
//     ]);
//     if (res.rows.length > 0) return res.rows[0].id;
//     res = await pool.query(
//       "INSERT INTO players (name) VALUES ($1) RETURNING id",
//       [clean],
//     );
//     return res.rows[0].id;
//   }

//   async getOrCreateTournament(name) {
//     const clean = (name || "Table Tennis").trim().substring(0, 100);
//     let res = await pool.query("SELECT id FROM tournaments WHERE name = $1", [
//       clean,
//     ]);
//     if (res.rows.length > 0) return res.rows[0].id;
//     res = await pool.query(
//       "INSERT INTO tournaments (name) VALUES ($1) RETURNING id",
//       [clean],
//     );
//     return res.rows[0].id;
//   }
// }

// export default UnifiedTableTennisScraper;

// table-tennis/scrapers/unified-scraper.js - OPTIMIZED VERSION
import axios from "axios";
import pool from "../db/client.js";

const SOFA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.sofascore.com/",
  Origin: "https://www.sofascore.com",
};

class UnifiedTableTennisScraper {
  async init() {
    console.log("[TT-Scraper] Scraper initialized (batch mode)");
  }

  async close() {
    console.log("[TT-Scraper] Scraper closed");
  }

  async scrapeSofaScore() {
    const matches = [];
    try {
      // Fetch today + next 3 days
      for (let dayOffset = 0; dayOffset < 4; dayOffset++) {
        const date = new Date();
        date.setDate(date.getDate() + dayOffset);
        const dateStr = date.toISOString().split("T")[0];

        const url = `https://api.sofascore.com/api/v1/sport/table-tennis/scheduled-events/${dateStr}`;
        const res = await axios.get(url, {
          headers: SOFA_HEADERS,
          timeout: 10000,
        });
        const events = res.data?.events || [];

        for (const ev of events) {
          const home = ev.homeTeam?.name || ev.homeTeam?.shortName;
          const away = ev.awayTeam?.name || ev.awayTeam?.shortName;
          const tournament =
            ev.tournament?.name ||
            ev.tournament?.category?.name ||
            "Table Tennis";
          const scheduledAt = ev.startTimestamp
            ? new Date(ev.startTimestamp * 1000).toISOString()
            : null;

          if (home && away && home.length > 2 && away.length > 2) {
            matches.push({
              home: home.trim().substring(0, 100),
              away: away.trim().substring(0, 100),
              tournament: tournament.substring(0, 100),
              scheduledAt,
              source: "SofaScore",
              externalId: `sofa_${ev.id}`,
            });
          }
        }
      }
      console.log(`[TT-Scraper] SofaScore: ${matches.length} matches`);
    } catch (err) {
      console.error("[TT-Scraper] SofaScore error:", err.message);
    }
    return matches;
  }

  async scrapeFlashScore() {
    return []; // Skip FlashScore for now
  }

  async scrapeITTFData() {
    console.log("[TT-Scraper] Fetching rankings...");
    return [];
  }

  async scrapeAllSources() {
    const matches = await this.scrapeSofaScore();
    return this.deduplicateMatches(matches);
  }

  deduplicateMatches(matches) {
    const seen = new Map();
    for (const m of matches) {
      const key =
        m.externalId || `${m.home.toLowerCase()}|${m.away.toLowerCase()}`;
      if (!seen.has(key)) seen.set(key, m);
    }
    return [...seen.values()];
  }

  // BATCH INSERT - Much faster!
  async saveMatchesToDB(matches) {
    if (matches.length === 0) return 0;

    console.log(
      `[TT-Scraper] Preparing ${matches.length} matches for batch insert...`,
    );

    // First, get or create all players and tournaments in bulk
    const uniquePlayers = new Set();
    const uniqueTournaments = new Set();

    for (const match of matches) {
      uniquePlayers.add(match.home);
      uniquePlayers.add(match.away);
      uniqueTournaments.add(match.tournament);
    }

    // Batch insert players
    console.log(`[TT-Scraper] Creating ${uniquePlayers.size} players...`);
    const playerIds = new Map();
    for (const name of uniquePlayers) {
      const res = await pool.query(
        "INSERT INTO players (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
        [name],
      );
      playerIds.set(name, res.rows[0].id);
    }

    // Batch insert tournaments
    console.log(
      `[TT-Scraper] Creating ${uniqueTournaments.size} tournaments...`,
    );
    const tournamentIds = new Map();
    for (const name of uniqueTournaments) {
      const res = await pool.query(
        "INSERT INTO tournaments (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
        [name],
      );
      tournamentIds.set(name, res.rows[0].id);
    }

    // Prepare batch insert for matches
    console.log(
      `[TT-Scraper] Inserting ${matches.length} matches in batches...`,
    );
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];

      for (let j = 0; j < batch.length; j++) {
        const m = batch[j];
        const offset = j * 6;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`,
        );
        values.push(
          m.externalId.substring(0, 100),
          tournamentIds.get(m.tournament),
          playerIds.get(m.home),
          playerIds.get(m.away),
          m.scheduledAt || new Date(Date.now() + 12 * 3600000).toISOString(),
          "upcoming",
        );
      }

      const query = `
        INSERT INTO matches (external_id, tournament_id, player_a_id, player_b_id, scheduled_at, status)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (external_id) DO NOTHING
      `;

      const result = await pool.query(query, values);
      inserted += result.rowCount;
      console.log(
        `  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(matches.length / batchSize)}: inserted ${result.rowCount} matches`,
      );
    }

    console.log(`[TT-Scraper] ✅ Inserted ${inserted} new matches`);
    return inserted;
  }
}

export default UnifiedTableTennisScraper;
