// table-tennis/services/odds-service.js
import axios from "axios";

const SOFA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
  Referer: "https://www.sofascore.com/",
};

// Source 1: SofaScore API
// Replace fetchSofaScoreOdds entirely
async function fetchSofaScoreOdds(eventId) {
  try {
    const url = `https://api.sofascore.com/api/v1/event/${eventId}/odds/1/all`;
    const res = await axios.get(url, { headers: SOFA_HEADERS, timeout: 6000 });
    const markets = res.data?.markets || [];

    const winnerMarket =
      markets.find(
        (m) =>
          m.marketName?.toLowerCase().includes("full time") ||
          m.marketName?.toLowerCase().includes("winner") ||
          m.marketName?.toLowerCase().includes("match") ||
          m.marketName?.toLowerCase() === "h2h",
      ) || markets[0];

    if (!winnerMarket) return null;

    const choices = winnerMarket.choices || [];
    const homeChoice = choices.find((c) => c.name === "1");
    const awayChoice = choices.find((c) => c.name === "2");

    if (!homeChoice || !awayChoice) return null;

    // Convert fractional string "2/5" → decimal 1.40
    function fractionalToDecimal(fracStr) {
      if (!fracStr) return null;
      const str = String(fracStr).trim();
      if (str.includes("/")) {
        const [num, den] = str.split("/").map(Number);
        if (!den || den === 0) return null;
        return 1 + num / den; // "2/5" → 1 + 0.4 = 1.40
      }
      const val = parseFloat(str);
      return val > 1 ? val : null; // Already decimal
    }

    const home = fractionalToDecimal(
      homeChoice.fractionalValue || homeChoice.initialFractionalValue,
    );
    const away = fractionalToDecimal(
      awayChoice.fractionalValue || awayChoice.initialFractionalValue,
    );

    if (!home || !away || home <= 1.01 || away <= 1.01) return null;
    if (home > 50 || away > 50) return null; // Sanity cap

    const margin = 1 / home + 1 / away;

    console.log(
      `[Odds] ✓ Found via SofaScore: ${home.toFixed(2)} / ${away.toFixed(2)} (margin: ${((margin - 1) * 100).toFixed(1)}%)`,
    );

    return {
      homeOdds: parseFloat(home.toFixed(3)),
      awayOdds: parseFloat(away.toFixed(3)),
      margin,
      source: "SofaScore",
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return null;
  }
}
// Source 2: The Odds API (requires API key)
async function fetchTheOddsApi(matchName) {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://api.the-odds-api.com/v4/sports/table_tennis/odds/?apiKey=${apiKey}&regions=eu&markets=h2h`;
    const res = await axios.get(url, { timeout: 6000 });
    const events = res.data || [];

    // Find matching event
    const event = events.find(
      (e) =>
        e.home_team?.toLowerCase().includes(matchName.toLowerCase()) ||
        e.away_team?.toLowerCase().includes(matchName.toLowerCase()),
    );

    if (!event || !event.bookmakers?.length) return null;

    // Get best odds from all bookmakers
    let bestHome = 0;
    let bestAway = 0;
    let bestBookmaker = "";

    for (const bookmaker of event.bookmakers) {
      const market = bookmaker.markets?.find((m) => m.key === "h2h");
      if (market && market.outcomes?.length >= 2) {
        const homeOutcome = market.outcomes.find(
          (o) => o.name === event.home_team,
        );
        const awayOutcome = market.outcomes.find(
          (o) => o.name === event.away_team,
        );
        if (homeOutcome && awayOutcome) {
          if (homeOutcome.price > bestHome) {
            bestHome = homeOutcome.price;
            bestAway = awayOutcome.price;
            bestBookmaker = bookmaker.title;
          }
        }
      }
    }

    if (bestHome === 0) return null;

    const margin = 1 / bestHome + 1 / bestAway;
    return {
      homeOdds: bestHome,
      awayOdds: bestAway,
      margin,
      source: `TheOddsAPI (${bestBookmaker})`,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return null;
  }
}

// Source 3: OddsPortal (scraping - fallback)
async function fetchOddsPortal(matchName, playerA, playerB) {
  try {
    // Simplified - in production you'd scrape or use their API
    // For now, return null as this requires more work
    return null;
  } catch (err) {
    return null;
  }
}

// Source 4: FlashScore (via their widget API)
async function fetchFlashScoreOdds(matchId) {
  try {
    const url = `https://d.flashscore.com/x/feed/f_1_${matchId}_en_1`;
    const res = await axios.get(url, {
      headers: {
        "User-Agent": SOFA_HEADERS["User-Agent"],
        "x-fsign": "SW9D1eZo",
      },
      timeout: 6000,
    });

    // Parse pipe-separated response
    const lines = (res.data || "").split("¬");
    let homeOdds = null;
    let awayOdds = null;

    for (const line of lines) {
      if (line.startsWith("AE÷")) {
        const parts = line.split("÷");
        const odds = parseFloat(parts[2]);
        if (parts[1] === "1") homeOdds = odds;
        if (parts[1] === "2") awayOdds = odds;
      }
    }

    if (homeOdds && awayOdds) {
      const margin = 1 / homeOdds + 1 / awayOdds;
      return {
        homeOdds,
        awayOdds,
        margin,
        source: "FlashScore",
        timestamp: new Date().toISOString(),
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Source 5: Local bookmaker odds from your arb-finder database
async function fetchLocalBookmakerOdds(matchId, playerA, playerB) {
  try {
    // Query your existing arbitrage data
    const { default: pool } = await import("../db/client.js");
    const res = await pool.query(
      `SELECT bookmaker, odds, market_type 
       FROM odds_snapshots 
       WHERE match_id = $1 AND market_type = 'match_winner'
       ORDER BY captured_at DESC LIMIT 1`,
      [matchId],
    );

    if (res.rows.length === 0) return null;

    // This would need mapping from your existing odds structure
    // For now, return null as template
    return null;
  } catch (err) {
    return null;
  }
}

// Main function - try multiple sources
export async function fetchBestOdds(
  eventId,
  matchName,
  playerA,
  playerB,
  matchId,
) {
  const sources = [
    { name: "SofaScore", fn: () => fetchSofaScoreOdds(eventId) },
    { name: "TheOddsAPI", fn: () => fetchTheOddsApi(matchName) },
    { name: "FlashScore", fn: () => fetchFlashScoreOdds(eventId) },
  ];

  console.log(`[Odds] Fetching odds for ${playerA} vs ${playerB}...`);

  for (const source of sources) {
    const odds = await source.fn();
    if (odds && odds.homeOdds > 1.01 && odds.awayOdds > 1.01) {
      console.log(
        `[Odds] ✓ Found via ${source.name}: ${odds.homeOdds} / ${odds.awayOdds}`,
      );
      return odds;
    }
  }

  console.log(`[Odds] ✗ No odds found for ${playerA} vs ${playerB}`);
  return null;
}

// Batch fetch odds for multiple matches
export async function fetchBatchOdds(matches) {
  const results = [];

  for (const match of matches) {
    const sofaId = match.external_id?.match(/sofa_(\d+)/)?.[1];
    const odds = await fetchBestOdds(
      sofaId,
      `${match.player_a} vs ${match.player_b}`,
      match.player_a,
      match.player_b,
      match.id,
    );

    results.push({
      matchId: match.id,
      odds,
    });

    // Rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

export default {
  fetchSofaScoreOdds,
  fetchTheOddsApi,
  fetchFlashScoreOdds,
  fetchBestOdds,
  fetchBatchOdds,
};
