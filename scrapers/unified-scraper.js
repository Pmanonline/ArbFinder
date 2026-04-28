// table-tennis/scrapers/unified-scraper.js
import axios from "axios";
import pool from "../db/client.js";

const SOFA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Referer: "https://www.sofascore.com/",
  Origin: "https://www.sofascore.com",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

// Leagues that typically have betting odds on major bookmakers
const SUPPORTED_LEAGUES = [
  // Ukrainian leagues (best coverage)
  "Setka Cup",
  "Ukr. Setka Cup",
  "TT Cup",

  // Russian leagues
  "Russian Liga Pro",
  "Liga Pro",
  "Russia Liga Pro",
  "TT Russian League",

  // Czech leagues
  "Czech Liga",
  "Czech Republic",
  "Czech Open",
  "Czech Pro Series",

  // Belarus leagues
  "Belarus Premier League",
  "Belarus Open",
  "Belarus Liga Pro",

  // European leagues
  "Poland Ekstraklasa",
  "Germany Bundesliga",
  "France Pro A",
  "Sweden Elitserien",
  "Austria Bundesliga",
  "TT Elite Series",
  "TT Star Series",

  // International tournaments
  "ITTF World Tour",
  "WTT Series",
  "WTT Champions",
  "WTT Star Contender",
  "European Championship",
  "World Championship",

  // Other known leagues
  "TT Masters",
  "Pro Series",
  "Elite Series",
  "Champions League",
];

// Leagues to EXCLUDE (no betting odds or team events)
const EXCLUDED_LEAGUES = [
  "Youth",
  "Junior",
  "U19",
  "U21",
  "U23",
  "Cadet",
  "Women",
  "Team Event",
  "Nations",
  "World Team",
  "European Team",
  "Mixed Doubles",
  "Doubles",
  "Qualifications",
  "Qualification",
  "Qualifying",
];

function shouldIncludeMatch(tournament, playerA, playerB) {
  if (!tournament) return true;

  const tournamentLower = tournament.toLowerCase();

  // Check excluded patterns
  for (const exclude of EXCLUDED_LEAGUES) {
    if (tournamentLower.includes(exclude.toLowerCase())) {
      return false;
    }
  }

  // Check if it's a supported league
  const isSupported = SUPPORTED_LEAGUES.some((league) =>
    tournamentLower.includes(league.toLowerCase()),
  );

  // Also include if both players look like individuals (have initials with dots)
  // This catches unclassified leagues that are still individual matches
  const hasPlayerInitials =
    (playerA && (playerA.includes(".") || /[A-Z]\./.test(playerA))) ||
    (playerB && (playerB.includes(".") || /[A-Z]\./.test(playerB)));

  // Check for common European names (indicates individual match)
  const europeanNamePattern = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+[A-Z]\.)?$/;
  const looksLikeIndividual =
    europeanNamePattern.test(playerA) && europeanNamePattern.test(playerB);

  // Exclude country vs country
  const isCountryMatch =
    playerA &&
    /^[A-Z][a-z]+$/.test(playerA) &&
    playerA.length < 20 &&
    playerB &&
    /^[A-Z][a-z]+$/.test(playerB) &&
    playerB.length < 20;

  if (isCountryMatch) return false;

  return isSupported || hasPlayerInitials || looksLikeIndividual;
}

class UnifiedTableTennisScraper {
  async init() {
    console.log("[TT-Scraper] Scraper initialized (league-filtered mode)");
  }

  async close() {
    console.log("[TT-Scraper] Scraper closed");
  }

  async scrapeSofaScore() {
    const matches = [];
    let totalScraped = 0;
    let totalFiltered = 0;

    try {
      // Fetch today + next 7 days for better coverage
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const date = new Date();
        date.setDate(date.getDate() + dayOffset);
        const dateStr = date.toISOString().split("T")[0];

        const url = `https://api.sofascore.com/api/v1/sport/table-tennis/scheduled-events/${dateStr}`;
        const res = await axios.get(url, {
          headers: SOFA_HEADERS,
          timeout: 15000,
        });
        const events = res.data?.events || [];
        totalScraped += events.length;

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
            if (shouldIncludeMatch(tournament, home, away)) {
              matches.push({
                home: home.trim().substring(0, 100),
                away: away.trim().substring(0, 100),
                tournament: tournament.substring(0, 100),
                scheduledAt,
                source: "SofaScore",
                externalId: `sofa_${ev.id}`,
                tournamentId: ev.tournament?.id,
                categoryId: ev.tournament?.category?.id,
              });
            } else {
              totalFiltered++;
            }
          }
        }

        // Small delay between day requests
        await new Promise((r) => setTimeout(r, 200));
      }

      console.log(
        `[TT-Scraper] SofaScore: ${matches.length} matches kept (filtered ${totalFiltered} from ${totalScraped} total)`,
      );
    } catch (err) {
      console.error("[TT-Scraper] SofaScore error:", err.message);
    }
    return matches;
  }

  async scrapeFlashScore() {
    // FlashScore integration - can be added later
    return [];
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
    const unique = [...seen.values()];
    if (matches.length !== unique.length) {
      console.log(
        `[TT-Scraper] Deduplicated: ${matches.length} → ${unique.length} unique matches`,
      );
    }
    return unique;
  }

  async saveMatchesToDB(matches) {
    if (matches.length === 0) return 0;

    console.log(
      `[TT-Scraper] Preparing ${matches.length} matches for batch insert...`,
    );

    const uniquePlayers = new Set();
    const uniqueTournaments = new Set();

    for (const match of matches) {
      uniquePlayers.add(match.home);
      uniquePlayers.add(match.away);
      uniqueTournaments.add(match.tournament);
    }

    console.log(`[TT-Scraper] Creating ${uniquePlayers.size} players...`);
    const playerIds = new Map();
    for (const name of uniquePlayers) {
      const res = await pool.query(
        "INSERT INTO players (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
        [name],
      );
      playerIds.set(name, res.rows[0].id);
    }

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
