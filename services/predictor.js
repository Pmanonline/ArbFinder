// import pool from "../db/client.js";
// import { expectedScore } from "../utils/elo.js";
// import { fetchBestOdds } from "./odds-service.js";

// const MIN_EDGE_PERCENT = 2.0;
// const MAX_EDGE_PERCENT = 15.0;
// const MIN_ELO_GAMES = 5;
// const MIN_GAMES_FOR_VALID_RATING = 5;
// const REQUIRE_REAL_ODDS = true; // NEVER use estimated odds

// // Country/team name filter
// const TEAM_EVENT_PATTERN = /^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/;
// function looksLikeCountry(name) {
//   return (
//     TEAM_EVENT_PATTERN.test(name) &&
//     !name.includes(".") &&
//     name.split(" ").length <= 2
//   );
// }

// function getSofaId(externalId) {
//   if (!externalId) return null;
//   const match = externalId.match(/sofa_(\d+)/);
//   return match ? match[1] : null;
// }

// function blendProbabilities(eloProb, homeOdds, awayOdds, gamesA, gamesB) {
//   const minGames = Math.min(gamesA, gamesB);

//   const rawImpliedHome = 1 / homeOdds;
//   const rawImpliedAway = 1 / awayOdds;
//   const total = rawImpliedHome + rawImpliedAway;
//   const marketProbHome = rawImpliedHome / total;

//   const eloWeight = Math.min(0.55, 0.2 + minGames / 500);
//   const marketWeight = 1 - eloWeight;

//   const blendedHome = eloProb * eloWeight + marketProbHome * marketWeight;

//   return {
//     blendedHome,
//     blendedAway: 1 - blendedHome,
//     eloWeight: parseFloat(eloWeight.toFixed(2)),
//     marketWeight: parseFloat(marketWeight.toFixed(2)),
//   };
// }

// export async function generatePredictions() {
//   console.log(
//     "[TT-Predictor] Generating predictions with MULTI-SOURCE odds...",
//   );

//   const { rows: matches } = await pool.query(`
//     SELECT
//       m.id, m.external_id,
//       p1.id as player_a_id, p1.name as player_a,
//       p2.id as player_b_id, p2.name as player_b,
//       t.name as tournament,
//       m.scheduled_at,
//       COALESCE(r1.rating_value, 1500) as rating_a,
//       COALESCE(r2.rating_value, 1500) as rating_b,
//       COALESCE(r1.games_played, 0) as games_a,
//       COALESCE(r2.games_played, 0) as games_b
//     FROM matches m
//     JOIN players p1 ON m.player_a_id = p1.id
//     JOIN players p2 ON m.player_b_id = p2.id
//     LEFT JOIN tournaments t ON m.tournament_id = t.id
//     LEFT JOIN LATERAL (
//       SELECT rating_value, games_played FROM player_ratings
//       WHERE player_id = p1.id
//         AND games_played >= ${MIN_GAMES_FOR_VALID_RATING}
//       ORDER BY effective_date DESC LIMIT 1
//     ) r1 ON true
//     LEFT JOIN LATERAL (
//       SELECT rating_value, games_played FROM player_ratings
//       WHERE player_id = p2.id
//         AND games_played >= ${MIN_GAMES_FOR_VALID_RATING}
//       ORDER BY effective_date DESC LIMIT 1
//     ) r2 ON true
//     WHERE m.status = 'upcoming'
//       AND m.scheduled_at > NOW()
//       AND m.scheduled_at < NOW() + INTERVAL '24 hours'
//       AND m.player_a_id != m.player_b_id
//       AND t.name NOT ILIKE '%team%'
//       AND t.name NOT ILIKE '%nations%'
//     ORDER BY m.scheduled_at ASC
//     LIMIT 200
//   `);

//   if (matches.length === 0) {
//     console.log("[TT-Predictor] No upcoming matches in next 24h.");
//     return { predictions: [], valueBets: [] };
//   }

//   // Filter country vs country
//   const individualMatches = matches.filter(
//     (m) => !(looksLikeCountry(m.player_a) && looksLikeCountry(m.player_b)),
//   );

//   console.log(
//     `[TT-Predictor] Analyzing ${individualMatches.length} individual matches (next 24h)` +
//       (matches.length !== individualMatches.length
//         ? ` (filtered ${matches.length - individualMatches.length} team events)`
//         : ""),
//   );

//   const predictions = [];
//   const valueBets = [];
//   let oddsFound = 0;
//   let oddsNotFound = 0;
//   let skipped = {
//     noRealOdds: 0,
//     lowGames: 0,
//     negativeEdge: 0,
//     lowConfidence: 0,
//   };

//   for (const match of individualMatches) {
//     // Skip if not enough games
//     if (match.games_a < MIN_ELO_GAMES && match.games_b < MIN_ELO_GAMES) {
//       skipped.lowGames++;
//       continue;
//     }

//     // Raw Elo probability
//     const eloProbA = expectedScore(match.rating_a, match.rating_b);
//     const eloDiff = Math.abs(match.rating_a - match.rating_b);

//     // MUST have real odds
//     const sofaId = getSofaId(match.external_id);
//     let odds = null;

//     if (sofaId) {
//       odds = await fetchBestOdds(
//         sofaId,
//         `${match.player_a} vs ${match.player_b}`,
//         match.player_a,
//         match.player_b,
//         match.id,
//       );
//     }

//     // Skip if no real odds found
//     if (!odds) {
//       console.log(
//         `[TT-Predictor] ⏭️ Skipping ${match.player_a} vs ${match.player_b}: No odds found`,
//       );
//       oddsNotFound++;
//       skipped.noRealOdds++;
//       continue;
//     }

//     // Verify odds are from a real bookmaker source
//     const isRealBookmaker =
//       odds.source === "SofaScore" ||
//       odds.source?.includes("TheOddsAPI") ||
//       odds.source?.includes("FlashScore");

//     if (!isRealBookmaker && REQUIRE_REAL_ODDS) {
//       console.log(
//         `[TT-Predictor] ⏭️ Skipping ${match.player_a} vs ${match.player_b}: Source ${odds.source} not a real bookmaker`,
//       );
//       skipped.noRealOdds++;
//       continue;
//     }

//     oddsFound++;

//     // Blend Elo with market
//     const blend = blendProbabilities(
//       eloProbA,
//       odds.homeOdds,
//       odds.awayOdds,
//       match.games_a,
//       match.games_b,
//     );

//     const favProb =
//       blend.blendedHome >= blend.blendedAway
//         ? blend.blendedHome
//         : blend.blendedAway;
//     const favOdds =
//       blend.blendedHome >= blend.blendedAway ? odds.homeOdds : odds.awayOdds;
//     const favPlayer =
//       blend.blendedHome >= blend.blendedAway ? match.player_a : match.player_b;

//     const impliedProb = 1 / favOdds;
//     const edge = (favProb - impliedProb) * 100;

//     // Skip negative or low edge
//     if (edge < MIN_EDGE_PERCENT) {
//       skipped.negativeEdge++;
//       continue;
//     }

//     // Skip unrealistically high edge (model error)
//     if (edge > MAX_EDGE_PERCENT) {
//       console.log(
//         `[TT-Predictor] ⚠️ Skipping ${match.player_a} vs ${match.player_b}: Edge ${edge.toFixed(1)}% exceeds cap`,
//       );
//       skipped.negativeEdge++;
//       continue;
//     }

//     const minGames = Math.min(match.games_a, match.games_b);
//     const confidence = minGames < 10 ? "MEDIUM" : "HIGH";

//     if (confidence === "LOW") {
//       skipped.lowConfidence++;
//       continue;
//     }

//     // Quarter-Kelly stake sizing
//     const kellyFraction = Math.max(
//       0,
//       ((favProb * favOdds - 1) / (favOdds - 1)) * 0.25,
//     );
//     const bankroll = 100000;
//     const stake = Math.min(
//       50000,
//       Math.max(5000, Math.round((bankroll * kellyFraction) / 1000) * 1000),
//     );

//     // Format time for display
//     const scheduledTime = new Date(match.scheduled_at);
//     const utcTime = scheduledTime.toLocaleTimeString([], {
//       hour: "2-digit",
//       minute: "2-digit",
//       hour12: false,
//       timeZone: "UTC",
//     });
//     const localTime = scheduledTime.toLocaleTimeString([], {
//       hour: "2-digit",
//       minute: "2-digit",
//       hour12: false,
//     });

//     const bet = {
//       matchId: match.id,
//       externalId: match.external_id,
//       playerA: match.player_a,
//       playerB: match.player_b,
//       tournament: match.tournament || "Table Tennis",
//       scheduledAt: match.scheduled_at,
//       scheduledTimeUtc: utcTime,
//       scheduledTimeLocal: localTime,
//       favorite: favPlayer,
//       eloProbA: (eloProbA * 100).toFixed(1),
//       blendedProbA: (blend.blendedHome * 100).toFixed(1),
//       favoriteProb: (favProb * 100).toFixed(1),
//       ratingA: Math.round(match.rating_a),
//       ratingB: Math.round(match.rating_b),
//       gamesA: match.games_a,
//       gamesB: match.games_b,
//       eloDiff: eloDiff.toFixed(0),
//       eloWeight: blend.eloWeight,
//       homeOdds: odds.homeOdds,
//       awayOdds: odds.awayOdds,
//       marketOdds: favOdds,
//       impliedProb: (impliedProb * 100).toFixed(1),
//       edgePercent: edge.toFixed(1),
//       margin: ((odds.margin - 1) * 100).toFixed(1),
//       oddsSource: odds.source,
//       confidence,
//       stakeSuggestion: stake,
//     };

//     predictions.push(bet);
//     valueBets.push(bet);
//   }

//   valueBets.sort(
//     (a, b) => parseFloat(b.edgePercent) - parseFloat(a.edgePercent),
//   );

//   console.log(`\n[TT-Predictor] ── Results ──────────────────────────────`);
//   console.log(`   Real odds found : ${oddsFound}`);
//   console.log(`   No real odds    : ${oddsNotFound}`);
//   console.log(`   Skipped (no real bookie odds) : ${skipped.noRealOdds}`);
//   console.log(`   Skipped (low games)           : ${skipped.lowGames}`);
//   console.log(`   Skipped (negative/low edge)   : ${skipped.negativeEdge}`);
//   console.log(
//     `   Value bets (≥${MIN_EDGE_PERCENT}% edge): ${valueBets.length}`,
//   );
//   console.log(`────────────────────────────────────────────────────────`);

//   if (valueBets.length > 0) {
//     console.log("\n🎯 TOP VALUE BETS (ONLY REAL BOOKIE ODDS):");
//     valueBets.slice(0, 10).forEach((b, i) => {
//       console.log(`\n  ${i + 1}. ${b.playerA} vs ${b.playerB}`);
//       console.log(
//         `     Time       : ${b.scheduledTimeUtc} UTC (${b.scheduledTimeLocal} local)`,
//       );
//       console.log(`     Tournament : ${b.tournament}`);
//       console.log(`     Real odds from: ${b.oddsSource}`);
//       console.log(`     Favorite   : ${b.favorite} @ ${b.marketOdds} odds`);
//       console.log(
//         `     Model prob : ${b.favoriteProb}% | Implied: ${b.impliedProb}% | Edge: +${b.edgePercent}%`,
//       );
//       console.log(
//         `     Confidence : ${b.confidence} | Stake: ${b.stakeSuggestion.toLocaleString()}`,
//       );
//     });
//   }

//   return { predictions, valueBets };
// }

// export default generatePredictions;

// table-tennis/services/predictor.js
import pool from "../db/client.js";
import { expectedScore } from "../utils/elo.js";
import { fetchBestOdds } from "./odds-service.js";

const MIN_EDGE_PERCENT = 2.0;
const MAX_EDGE_PERCENT = 25.0; // Increased - allow higher edges when market is wrong
const MIN_ELO_GAMES = 5;
const MIN_GAMES_FOR_VALID_RATING = 5;
const REQUIRE_REAL_ODDS = true;

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
 * Smarter probability blending:
 * - When Elo gap is large (>150), trust Elo more even with fewer games
 * - When market odds are very different from Elo, investigate why
 * - Don't let market completely override strong Elo signals
 */
function blendProbabilities(
  eloProb,
  homeOdds,
  awayOdds,
  gamesA,
  gamesB,
  eloDiff,
) {
  const minGames = Math.min(gamesA, gamesB);

  // Raw market implied probabilities
  const rawImpliedHome = 1 / homeOdds;
  const rawImpliedAway = 1 / awayOdds;
  const total = rawImpliedHome + rawImpliedAway;
  const marketProbHome = rawImpliedHome / total;

  // Calculate how much the market disagrees with Elo
  const marketDisagreement = Math.abs(eloProb - marketProbHome);

  // Base Elo weight - higher when players have more games OR Elo gap is large
  let eloWeight;

  if (eloDiff > 200) {
    // Large Elo gap - trust Elo significantly more
    eloWeight = Math.min(0.75, 0.5 + minGames / 400);
  } else if (eloDiff > 100) {
    // Moderate gap
    eloWeight = Math.min(0.65, 0.35 + minGames / 300);
  } else {
    // Close match - trust market more
    eloWeight = Math.min(0.5, 0.2 + minGames / 300);
  }

  // If market disagrees strongly with Elo, increase Elo weight (market might be wrong)
  if (marketDisagreement > 0.15) {
    eloWeight = Math.min(0.8, eloWeight + 0.1);
  }

  const marketWeight = 1 - eloWeight;
  const blendedHome = eloProb * eloWeight + marketProbHome * marketWeight;

  return {
    blendedHome,
    blendedAway: 1 - blendedHome,
    eloWeight: parseFloat(eloWeight.toFixed(2)),
    marketWeight: parseFloat(marketWeight.toFixed(2)),
    marketDisagreement: parseFloat(marketDisagreement.toFixed(2)),
  };
}

// Check if odds look suspicious (possible injury, news, or market error)
function isSuspiciousOdds(eloProb, marketOdds, favEloDiff) {
  const impliedProb = 1 / marketOdds;
  const difference = Math.abs(eloProb - impliedProb);

  // If market is offering 2.5+ on a heavy favorite (>70% Elo), odds are suspicious
  if (eloProb > 0.7 && marketOdds > 2.0) {
    return {
      suspicious: true,
      reason: "Heavy favorite has unusually high odds",
    };
  }

  // If difference > 20%, odds might be wrong or stale
  if (difference > 0.2) {
    return {
      suspicious: true,
      reason: `Large discrepancy: Elo ${(eloProb * 100).toFixed(0)}% vs Market ${(impliedProb * 100).toFixed(0)}%`,
    };
  }

  return { suspicious: false };
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
  let oddsNotFound = 0;
  let skipped = {
    noRealOdds: 0,
    lowGames: 0,
    negativeEdge: 0,
    lowConfidence: 0,
  };

  for (const match of individualMatches) {
    // Skip if not enough games for BOTH players
    if (match.games_a < MIN_ELO_GAMES && match.games_b < MIN_ELO_GAMES) {
      skipped.lowGames++;
      continue;
    }

    // Raw Elo probability
    const eloProbA = expectedScore(match.rating_a, match.rating_b);
    const eloProbFav = Math.max(eloProbA, 1 - eloProbA);
    const eloDiff = Math.abs(match.rating_a - match.rating_b);
    const favEloRating = Math.max(match.rating_a, match.rating_b);

    // Get real odds
    const sofaId = getSofaId(match.external_id);
    let odds = null;

    if (sofaId) {
      odds = await fetchBestOdds(
        sofaId,
        `${match.player_a} vs ${match.player_b}`,
        match.player_a,
        match.player_b,
        match.id,
        match.tournament,
      );
    }

    if (!odds) {
      oddsNotFound++;
      skipped.noRealOdds++;
      continue;
    }

    const isRealBookmaker =
      odds.source === "SofaScore" ||
      odds.source?.includes("TheOddsAPI") ||
      odds.source?.includes("FlashScore");

    if (!isRealBookmaker && REQUIRE_REAL_ODDS) {
      skipped.noRealOdds++;
      continue;
    }

    oddsFound++;

    // Check for suspicious odds
    const favOdds =
      odds.homeOdds < odds.awayOdds ? odds.homeOdds : odds.awayOdds;
    const suspicious = isSuspiciousOdds(eloProbFav, favOdds, eloDiff);

    if (suspicious.suspicious) {
      console.log(
        `[TT-Predictor] ⚠️ Suspicious odds for ${match.player_a} vs ${match.player_b}: ${suspicious.reason}`,
      );
    }

    // Smarter blending
    const blend = blendProbabilities(
      eloProbA,
      odds.homeOdds,
      odds.awayOdds,
      match.games_a,
      match.games_b,
      eloDiff,
    );

    const favProb =
      blend.blendedHome >= blend.blendedAway
        ? blend.blendedHome
        : blend.blendedAway;
    const favOddsFinal =
      blend.blendedHome >= blend.blendedAway ? odds.homeOdds : odds.awayOdds;
    const favPlayer =
      blend.blendedHome >= blend.blendedAway ? match.player_a : match.player_b;

    const impliedProb = 1 / favOddsFinal;
    const edge = (favProb - impliedProb) * 100;

    // Skip negative edge
    if (edge < MIN_EDGE_PERCENT) {
      skipped.negativeEdge++;
      continue;
    }

    // Cap unrealistic edges (but allow higher now)
    if (edge > MAX_EDGE_PERCENT) {
      console.log(
        `[TT-Predictor] ⚠️ Skipping ${match.player_a} vs ${match.player_b}: Edge ${edge.toFixed(1)}% exceeds cap`,
      );
      skipped.negativeEdge++;
      continue;
    }

    // Confidence based on games played AND Elo gap
    const minGames = Math.min(match.games_a, match.games_b);
    let confidence = "MEDIUM";

    if (minGames >= 30 && eloDiff > 100) {
      confidence = "HIGH";
    } else if (minGames >= 50) {
      confidence = "HIGH";
    } else if (minGames >= 15) {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }

    if (confidence === "LOW") {
      skipped.lowConfidence++;
      continue;
    }

    // Quarter-Kelly stake (higher when confidence is HIGH)
    const kellyMultiplier = confidence === "HIGH" ? 0.35 : 0.2;
    const kellyFraction = Math.max(
      0,
      ((favProb * favOddsFinal - 1) / (favOddsFinal - 1)) * kellyMultiplier,
    );
    const bankroll = 100000;
    const stake = Math.min(
      50000,
      Math.max(5000, Math.round((bankroll * kellyFraction) / 1000) * 1000),
    );

    const scheduledTime = new Date(match.scheduled_at);
    const utcTime = scheduledTime.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    const localTime = scheduledTime.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const bet = {
      matchId: match.id,
      externalId: match.external_id,
      playerA: match.player_a,
      playerB: match.player_b,
      tournament: match.tournament || "Table Tennis",
      scheduledAt: match.scheduled_at,
      scheduledTimeUtc: utcTime,
      scheduledTimeLocal: localTime,
      favorite: favPlayer,
      rawEloProb: (eloProbFav * 100).toFixed(1),
      blendedProb: (favProb * 100).toFixed(1),
      ratingA: Math.round(match.rating_a),
      ratingB: Math.round(match.rating_b),
      gamesA: match.games_a,
      gamesB: match.games_b,
      eloDiff: eloDiff.toFixed(0),
      eloWeight: blend.eloWeight,
      marketOdds: favOddsFinal,
      impliedProb: (impliedProb * 100).toFixed(1),
      edgePercent: edge.toFixed(1),
      oddsSource: odds.source,
      confidence,
      stakeSuggestion: stake,
      marketDisagreement: blend.marketDisagreement,
    };

    predictions.push(bet);
    valueBets.push(bet);
  }

  valueBets.sort(
    (a, b) => parseFloat(b.edgePercent) - parseFloat(a.edgePercent),
  );

  console.log(`\n[TT-Predictor] ── Results ──────────────────────────────`);
  console.log(`   Real odds found : ${oddsFound}`);
  console.log(`   No real odds    : ${oddsNotFound}`);
  console.log(`   Value bets found: ${valueBets.length}`);
  console.log(`────────────────────────────────────────────────────────`);

  if (valueBets.length > 0) {
    console.log("\n🎯 TOP VALUE BETS:");
    valueBets.slice(0, 10).forEach((b, i) => {
      console.log(`\n  ${i + 1}. ${b.playerA} vs ${b.playerB}`);
      console.log(`     Time       : ${b.scheduledTimeUtc} UTC`);
      console.log(`     Tournament : ${b.tournament}`);
      console.log(
        `     RAW Elo prob: ${b.rawEloProb}% → Blended: ${b.blendedProb}%`,
      );
      console.log(`     Favorite   : ${b.favorite} @ ${b.marketOdds}`);
      console.log(
        `     Edge: +${b.edgePercent}% | Confidence: ${b.confidence}`,
      );
      if (parseFloat(b.rawEloProb) > 70) {
        console.log(
          `     🔥 HIGH VALUE: Elo says ${b.rawEloProb}% but market offers ${b.marketOdds} (${b.impliedProb}% implied)!`,
        );
      }
    });
  }

  return { predictions, valueBets };
}

export default generatePredictions;
