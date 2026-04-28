// table-tennis/services/predictor.js
import pool from "../db/client.js";
import { expectedScore } from "../utils/elo.js";
import { fetchBestOdds } from "./odds-service.js";

const MIN_EDGE_PERCENT = 2.0; // Raised from 1% — reduces noise bets
const MAX_EDGE_PERCENT = 15.0; // Tightened — above 15% is almost always a model error
const MIN_ELO_GAMES = 5;
const MIN_GAMES_FOR_VALID_RATING = 5;

// Country/team name filter
const TEAM_EVENT_PATTERN = /^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/;
function looksLikeCountry(name) {
  return (
    TEAM_EVENT_PATTERN.test(name) &&
    !name.includes(".") &&
    name.split(" ").length <= 2
  );
}

function getSofaId(externalId) {
  if (!externalId) return null;
  const match = externalId.match(/sofa_(\d+)/);
  return match ? match[1] : null;
}

/**
 * Blend Elo probability with market-implied probability.
 *
 * The market is generally well-calibrated for these players.
 * We trust Elo more as games_played increases, but never fully ignore the market.
 *
 * eloWeight scale:
 *   <20 games  → 20% Elo, 80% market  (player barely known)
 *   50 games   → 35% Elo, 65% market
 *   100 games  → 45% Elo, 55% market
 *   200+ games → 55% Elo, 45% market  (well established)
 */
function blendProbabilities(eloProb, homeOdds, awayOdds, gamesA, gamesB) {
  const minGames = Math.min(gamesA, gamesB);

  // Market implied probabilities (normalized to remove bookmaker margin)
  const rawImpliedHome = 1 / homeOdds;
  const rawImpliedAway = 1 / awayOdds;
  const total = rawImpliedHome + rawImpliedAway;
  const marketProbHome = rawImpliedHome / total; // margin-free market prob

  // Elo weight grows with experience, capped at 55%
  const eloWeight = Math.min(0.55, 0.2 + minGames / 500);
  const marketWeight = 1 - eloWeight;

  const blendedHome = eloProb * eloWeight + marketProbHome * marketWeight;

  return {
    blendedHome,
    blendedAway: 1 - blendedHome,
    eloWeight: parseFloat(eloWeight.toFixed(2)),
    marketWeight: parseFloat(marketWeight.toFixed(2)),
  };
}

export async function generatePredictions() {
  console.log(
    "[TT-Predictor] Generating predictions with MULTI-SOURCE odds...",
  );

  const { rows: matches } = await pool.query(`
    SELECT 
      m.id, m.external_id,
      p1.id as player_a_id, p1.name as player_a,
      p2.id as player_b_id, p2.name as player_b,
      t.name as tournament,
      m.scheduled_at,
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
      WHERE player_id = p1.id 
        AND games_played >= ${MIN_GAMES_FOR_VALID_RATING}
      ORDER BY effective_date DESC LIMIT 1
    ) r1 ON true
    LEFT JOIN LATERAL (
      SELECT rating_value, games_played FROM player_ratings 
      WHERE player_id = p2.id 
        AND games_played >= ${MIN_GAMES_FOR_VALID_RATING}
      ORDER BY effective_date DESC LIMIT 1
    ) r2 ON true
    WHERE m.status = 'upcoming'
      AND m.scheduled_at > NOW()
      AND m.scheduled_at < NOW() + INTERVAL '24 hours'
      AND m.player_a_id != m.player_b_id
      AND t.name NOT ILIKE '%team%'
      AND t.name NOT ILIKE '%nations%'
    ORDER BY m.scheduled_at ASC
    LIMIT 200
  `);

  if (matches.length === 0) {
    console.log("[TT-Predictor] No upcoming matches in next 24h.");
    return { predictions: [], valueBets: [] };
  }

  // Filter country vs country
  const individualMatches = matches.filter(
    (m) => !(looksLikeCountry(m.player_a) && looksLikeCountry(m.player_b)),
  );

  console.log(
    `[TT-Predictor] Analyzing ${individualMatches.length} individual matches (next 24h)` +
      (matches.length !== individualMatches.length
        ? ` (filtered ${matches.length - individualMatches.length} team events)`
        : ""),
  );

  const predictions = [];
  const valueBets = [];
  let oddsFound = 0;
  let oddsEstimated = 0;
  let oddsNotFound = 0;
  let skipped = { lowEloDiff: 0, edgeOutOfRange: 0, negativeEdge: 0 };

  for (const match of individualMatches) {
    // Raw Elo probability (before blending)
    const eloProbA = expectedScore(match.rating_a, match.rating_b);
    const eloProbB = 1 - eloProbA;
    const eloDiff = Math.abs(match.rating_a - match.rating_b);
    const bothUnrated =
      match.games_a < MIN_ELO_GAMES && match.games_b < MIN_ELO_GAMES;

    // Fetch real odds
    const sofaId = getSofaId(match.external_id);
    let odds = null;

    if (sofaId) {
      odds = await fetchBestOdds(
        sofaId,
        `${match.player_a} vs ${match.player_b}`,
        match.player_a,
        match.player_b,
        match.id,
      );
      if (odds) {
        oddsFound++;
      } else {
        oddsNotFound++;
      }
    }

    // Fallback: estimated odds for large Elo gaps only
    if (!odds) {
      if (eloDiff < 200 || bothUnrated) {
        skipped.lowEloDiff++;
        continue;
      }
      // Fair odds — edge must come from Elo diverging significantly from market norms
      odds = {
        homeOdds: parseFloat((1 / eloProbA).toFixed(3)),
        awayOdds: parseFloat((1 / eloProbB).toFixed(3)),
        margin: 1.0,
        source: "Estimated",
      };
      oddsEstimated++;
    }

    // Blend Elo with market for final probability
    const blend = blendProbabilities(
      eloProbA,
      odds.homeOdds,
      odds.awayOdds,
      match.games_a,
      match.games_b,
    );

    const favProb =
      blend.blendedHome >= blend.blendedAway
        ? blend.blendedHome
        : blend.blendedAway;
    const favOdds =
      blend.blendedHome >= blend.blendedAway ? odds.homeOdds : odds.awayOdds;
    const favPlayer =
      blend.blendedHome >= blend.blendedAway ? match.player_a : match.player_b;

    const impliedProb = 1 / favOdds;
    const edge = (favProb - impliedProb) * 100;

    // Filter out implausible edges
    if (edge > MAX_EDGE_PERCENT) {
      console.log(
        `[TT-Predictor] ⚠️  Skipping ${match.player_a} vs ${match.player_b}: blended edge ${edge.toFixed(1)}% still exceeds cap — Elo likely stale`,
      );
      skipped.edgeOutOfRange++;
      continue;
    }

    if (edge < -5) {
      skipped.negativeEdge++;
      continue;
    }

    const minGames = Math.min(match.games_a, match.games_b);
    const confidence = bothUnrated
      ? "LOW"
      : minGames < 10
        ? "MEDIUM"
        : minGames < 30
          ? "MEDIUM"
          : "HIGH";

    // Quarter-Kelly stake sizing on blended probability
    const kellyFraction = Math.max(
      0,
      ((favProb * favOdds - 1) / (favOdds - 1)) * 0.25,
    );
    const bankroll = 100000;
    const stake = Math.min(
      50000,
      Math.max(5000, Math.round((bankroll * kellyFraction) / 1000) * 1000),
    );

    const bet = {
      matchId: match.id,
      externalId: match.external_id,
      playerA: match.player_a,
      playerB: match.player_b,
      tournament: match.tournament || "Table Tennis",
      scheduledAt: match.scheduled_at,
      favorite: favPlayer,
      eloProbA: (eloProbA * 100).toFixed(1), // raw Elo
      blendedProbA: (blend.blendedHome * 100).toFixed(1), // after market blend
      favoriteProb: (favProb * 100).toFixed(1),
      ratingA: Math.round(match.rating_a),
      ratingB: Math.round(match.rating_b),
      gamesA: match.games_a,
      gamesB: match.games_b,
      eloDiff: eloDiff.toFixed(0),
      eloWeight: blend.eloWeight,
      homeOdds: odds.homeOdds,
      awayOdds: odds.awayOdds,
      marketOdds: favOdds,
      impliedProb: (impliedProb * 100).toFixed(1),
      edgePercent: edge.toFixed(1),
      margin: ((odds.margin - 1) * 100).toFixed(1),
      oddsSource: odds.source,
      confidence,
      stakeSuggestion: stake,
    };

    predictions.push(bet);

    if (edge >= MIN_EDGE_PERCENT && confidence !== "LOW") {
      valueBets.push(bet);
    }
  }

  valueBets.sort(
    (a, b) => parseFloat(b.edgePercent) - parseFloat(a.edgePercent),
  );

  console.log(`\n[TT-Predictor] ── Results ──────────────────────────────`);
  console.log(`   Real odds found : ${oddsFound}`);
  console.log(`   Estimated odds  : ${oddsEstimated}`);
  console.log(`   No odds / skip  : ${oddsNotFound}`);
  console.log(`   Skipped (low Elo diff)   : ${skipped.lowEloDiff}`);
  console.log(`   Skipped (edge > cap)     : ${skipped.edgeOutOfRange}`);
  console.log(`   Skipped (negative edge)  : ${skipped.negativeEdge}`);
  console.log(
    `   Value bets (≥${MIN_EDGE_PERCENT}% edge, HIGH/MEDIUM confidence): ${valueBets.length}`,
  );
  console.log(`────────────────────────────────────────────────────────`);

  if (valueBets.length > 0) {
    console.log("\n🎯 TOP VALUE BETS:");
    valueBets.slice(0, 10).forEach((b, i) => {
      const scheduled = new Date(b.scheduledAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      console.log(`\n  ${i + 1}. ${b.playerA} vs ${b.playerB} @ ${scheduled}`);
      console.log(`     Tournament : ${b.tournament}`);
      console.log(
        `     Elo        : ${b.ratingA} (${b.gamesA}g) vs ${b.ratingB} (${b.gamesB}g) — diff: ${b.eloDiff}`,
      );
      console.log(
        `     Elo prob   : ${b.eloProbA}% → Blended: ${b.blendedProbA}% (Elo weight: ${(b.eloWeight * 100).toFixed(0)}%)`,
      );
      console.log(`     Favorite   : ${b.favorite} @ ${b.marketOdds} odds`);
      console.log(
        `     Model prob : ${b.favoriteProb}% | Implied: ${b.impliedProb}% | Edge: +${b.edgePercent}%`,
      );
      console.log(
        `     Confidence : ${b.confidence} | Source: ${b.oddsSource} | Stake: ${b.stakeSuggestion.toLocaleString()}`,
      );
    });
  }

  return { predictions, valueBets };
}

export default generatePredictions;
