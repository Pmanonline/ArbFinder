// table-tennis/services/elo-bootstrap.js
import axios from "axios";
import pool from "../db/client.js";
import { updateElo } from "../utils/elo.js";

const SOFA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
  Referer: "https://www.sofascore.com/",
};
const DELAY = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Progress bar ──────────────────────────────────────────────────────────────
function progress(label, current, total, extra = "") {
  const pct = Math.round((current / total) * 100);
  const filled = Math.round(pct / 2);
  const bar = "█".repeat(filled) + "░".repeat(50 - filled);
  process.stdout.write(
    `\r${label} [${bar}] ${pct}% (${current}/${total}) ${extra}   `,
  );
}

// ── Fetch all finished matches from SofaScore ─────────────────────────────────
async function fetchResults(daysBack) {
  const results = [];
  for (let d = 1; d <= daysBack; d++) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split("T")[0];

    try {
      const url = `https://api.sofascore.com/api/v1/sport/table-tennis/scheduled-events/${dateStr}`;
      const res = await axios.get(url, {
        headers: SOFA_HEADERS,
        timeout: 8000,
      });
      const events = (res.data?.events || []).filter(
        (e) => e.status?.type === "finished",
      );

      for (const ev of events) {
        const home = ev.homeTeam?.name?.trim();
        const away = ev.awayTeam?.name?.trim();
        const homeScore = ev.homeScore?.current ?? ev.homeScore?.normaltime;
        const awayScore = ev.awayScore?.current ?? ev.awayScore?.normaltime;
        if (home && away && homeScore != null && awayScore != null) {
          results.push({
            home,
            away,
            homeScore: +homeScore,
            awayScore: +awayScore,
            date: dateStr,
          });
        }
      }
    } catch (_) {}

    progress("Fetching", d, daysBack, `${results.length} results`);
    await DELAY(250); // slightly more polite rate limiting
  }
  console.log(`\n✅ Fetched ${results.length} completed matches`);
  return results.reverse(); // oldest first for correct Elo ordering
}

// ── Batch upsert all player names → get IDs in one query ────────────────────
async function batchGetOrCreatePlayers(names) {
  const unique = [...new Set(names.map((n) => n.substring(0, 100)))];

  const placeholders = unique.map((_, i) => `($${i + 1})`).join(", ");
  await pool.query(
    `INSERT INTO players (name) VALUES ${placeholders} ON CONFLICT (name) DO NOTHING`,
    unique,
  );

  const res = await pool.query(
    `SELECT id, name FROM players WHERE name = ANY($1)`,
    [unique],
  );

  const map = new Map();
  for (const row of res.rows) map.set(row.name, row.id);
  return map;
}

// ── Batch save all ratings at the end ────────────────────────────────────────
async function batchSaveRatings(ratingCache, playerIdMap) {
  const entries = [...ratingCache.entries()];
  const BATCH = 500;

  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH);
    const vals = [];
    const params = [];
    let idx = 1;

    for (const [name, { rating, games }] of slice) {
      const id = playerIdMap.get(name);
      if (!id) continue;
      vals.push(`($${idx++}, $${idx++}, $${idx++}, CURRENT_DATE)`);
      params.push(id, Math.round(rating), games);
    }

    if (vals.length === 0) continue;

    await pool.query(
      `INSERT INTO player_ratings (player_id, rating_value, games_played, effective_date)
       VALUES ${vals.join(", ")}
       ON CONFLICT (player_id, effective_date)
       DO UPDATE SET rating_value = EXCLUDED.rating_value, games_played = EXCLUDED.games_played`,
      params,
    );

    progress(
      "Saving ratings",
      Math.min(i + BATCH, entries.length),
      entries.length,
      "",
    );
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function bootstrapElo(daysBack = 90) {
  // ← default now 90 days
  console.log(`\n[ELO Bootstrap] Processing last ${daysBack} days...`);
  const t0 = Date.now();

  // 1. Fetch results
  const results = await fetchResults(daysBack);

  // 2. Batch-create all players (one round-trip)
  console.log("\n[ELO Bootstrap] Creating players in bulk...");
  const allNames = results.flatMap((r) => [r.home, r.away]);
  const playerMap = await batchGetOrCreatePlayers(allNames);
  console.log(`✅ ${playerMap.size} unique players`);

  // 3. Compute Elo in memory — no DB reads in the loop
  console.log("\n[ELO Bootstrap] Computing Elo ratings...");
  const ratingCache = new Map(); // name → { rating, games }

  const getR = (name) => ratingCache.get(name) || { rating: 1500, games: 0 };

  for (let i = 0; i < results.length; i++) {
    const m = results[i];
    const rA = getR(m.home);
    const rB = getR(m.away);

    // Lower K-factors → more stable ratings, less overreaction per match
    // Table tennis players play many matches, so ratings converge faster
    const kA = rA.games < 30 ? 24 : rA.games < 100 ? 20 : 16;
    const kB = rB.games < 30 ? 24 : rB.games < 100 ? 20 : 16;

    try {
      const upd = updateElo({
        ratingA: rA.rating,
        ratingB: rB.rating,
        winner: m.homeScore > m.awayScore ? "A" : "B",
        setsA: m.homeScore,
        setsB: m.awayScore,
        kFactor: (kA + kB) / 2,
      });
      ratingCache.set(m.home, { rating: upd.newRatingA, games: rA.games + 1 });
      ratingCache.set(m.away, { rating: upd.newRatingB, games: rB.games + 1 });
    } catch (_) {}

    if (i % 1000 === 0 || i === results.length - 1) {
      progress(
        "Computing Elo",
        i + 1,
        results.length,
        `${ratingCache.size} players rated`,
      );
    }
  }
  console.log();

  // 4. Batch-save ratings
  console.log("\n[ELO Bootstrap] Saving ratings to DB...");
  await batchSaveRatings(ratingCache, playerMap);

  // 5. Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Done in ${elapsed}s`);
  console.log(`   Matches processed : ${results.length}`);
  console.log(`   Players rated     : ${ratingCache.size}`);

  // Top 10
  const top10 = [...ratingCache.entries()]
    .sort((a, b) => b[1].rating - a[1].rating)
    .slice(0, 10);

  console.log("\n🏆 Top 10 players:");
  top10.forEach(([name, { rating, games }], i) => {
    console.log(
      `  ${i + 1}. ${name.padEnd(25)} ${Math.round(rating)} Elo  (${games} games)`,
    );
  });

  // Verify DB
  const { rows } = await pool.query(
    "SELECT COUNT(*) as cnt FROM player_ratings WHERE effective_date = CURRENT_DATE",
  );
  console.log(`\n📦 DB check: ${rows[0].cnt} rating rows saved for today`);
}

// Standalone entry point
const isMain = process.argv[1].endsWith("elo-bootstrap.js");
if (isMain) {
  const days = parseInt(process.argv[2] || "90"); // ← default 90
  bootstrapElo(days)
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export default bootstrapElo;
