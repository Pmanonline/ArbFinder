// table-tennis/services/over-under-predictor.js
import pool from "../db/client.js";
import { expectedScore } from "../utils/elo.js";

/**
 * Over/Under Predictor for Table Tennis
 *
 * CRITICAL FIX: OVER 3.5 SETS and UNDER 74.5 POINTS are mutually exclusive
 * - If match goes to 4+ sets (OVER 3.5), points will almost always exceed 74.5
 * - Only possible exception is extremely low-scoring 3-1 match (rare)
 * - Therefore: OVER 3.5 SETS should imply OVER 74.5 POINTS with high confidence
 */

async function getPlayerSetStats(playerName) {
  try {
    const { rows } = await pool.query(
      `
      SELECT 
        COUNT(*) as total_matches,
        AVG(CASE WHEN winner_id = p.id THEN 1 ELSE 0 END) as win_rate,
        pr.rating_value,
        pr.games_played
      FROM players p
      LEFT JOIN player_ratings pr ON p.id = pr.player_id
      LEFT JOIN matches m ON (m.player_a_id = p.id OR m.player_b_id = p.id)
      WHERE p.name = $1
        AND pr.games_played >= 5
      GROUP BY p.id, pr.rating_value, pr.games_played
      ORDER BY pr.effective_date DESC
      LIMIT 1
    `,
      [playerName],
    );
    if (rows.length === 0) return null;
    return rows[0];
  } catch (_) {
    return null;
  }
}

export async function predictOverUnder(
  ratingA,
  ratingB,
  gamesA,
  gamesB,
  playerA,
  playerB,
) {
  const eloDiff = Math.abs(ratingA - ratingB);
  const winProbFav = expectedScore(
    Math.max(ratingA, ratingB),
    Math.min(ratingA, ratingB),
  );

  // Calculate probability of OVER 3.5 SETS (match goes to 4+ sets)
  let probOver35Sets;
  if (eloDiff >= 400) probOver35Sets = 0.18;
  else if (eloDiff >= 300) probOver35Sets = 0.27;
  else if (eloDiff >= 200) probOver35Sets = 0.38;
  else if (eloDiff >= 150) probOver35Sets = 0.46;
  else if (eloDiff >= 100) probOver35Sets = 0.54;
  else if (eloDiff >= 50) probOver35Sets = 0.6;
  else probOver35Sets = 0.65;

  const minGames = Math.min(gamesA, gamesB);
  if (minGames < 20) probOver35Sets += 0.05;
  if (minGames > 200) probOver35Sets -= 0.03;
  probOver35Sets = Math.max(0.12, Math.min(0.82, probOver35Sets));
  const probUnder35Sets = 1 - probOver35Sets;

  // CRITICAL FIX: OVER 3.5 SETS strongly implies OVER 74.5 POINTS
  // In table tennis, a 4-set match averages ~65-80 points
  // A 5-set match averages ~80-110 points
  // Therefore: P(OVER 74.5) should be HIGH when P(OVER 3.5) is HIGH

  // Probability of 5 sets
  let probFiveSets;
  if (eloDiff >= 300) probFiveSets = 0.05;
  else if (eloDiff >= 200) probFiveSets = 0.1;
  else if (eloDiff >= 100) probFiveSets = 0.18;
  else if (eloDiff >= 50) probFiveSets = 0.25;
  else probFiveSets = 0.3;

  // Probability of exactly 4 sets
  const probFourSets = probOver35Sets - probFiveSets;

  // Points probability model:
  // - 3-0 match (3 sets): typically 33-45 points → UNDER 74.5 (95% of time)
  // - 3-1 match (4 sets): typically 50-80 points → OVER 74.5 ~30-40% of time (close/long sets)
  // - 3-2 match (5 sets): typically 75-110 points → OVER 74.5 ~90% of time

  const probOver745IfThreeSets = 0.02; // 3-set match almost always UNDER
  const probOver745IfFourSets = 0.35; // 4-set match: 35% chance of OVER (close sets)
  const probOver745IfFiveSets = 0.9; // 5-set match: 90% chance of OVER

  // Weighted probability
  let probOver745Points =
    probUnder35Sets * probOver745IfThreeSets +
    probFourSets * probOver745IfFourSets +
    probFiveSets * probOver745IfFiveSets;

  probOver745Points = Math.max(0.05, Math.min(0.85, probOver745Points));
  const probUnder745Points = 1 - probOver745Points;

  // LOGIC FIX: Recommendations must be consistent
  // If OVER 3.5 SETS is strongly predicted, points should NOT be UNDER
  let sets35Rec = "NO BET";
  let pts745Rec = "NO BET";

  // Sets recommendation
  if (probOver35Sets > 0.55) {
    sets35Rec = "OVER 3.5 SETS";
  } else if (probUnder35Sets > 0.6) {
    sets35Rec = "UNDER 3.5 SETS";
  }

  // Points recommendation - CONSISTENCY CHECK
  if (sets35Rec === "OVER 3.5 SETS") {
    // If we expect OVER 3.5 sets, OVER 74.5 points is more likely
    if (probOver745Points > 0.55) {
      pts745Rec = "OVER 74.5 PTS";
    } else if (probUnder745Points > 0.65) {
      pts745Rec = "UNDER 74.5 PTS";
    }
  } else if (sets35Rec === "UNDER 3.5 SETS") {
    // If we expect UNDER 3.5 sets, UNDER 74.5 points is more likely
    if (probUnder745Points > 0.6) {
      pts745Rec = "UNDER 74.5 PTS";
    } else if (probOver745Points > 0.55) {
      pts745Rec = "OVER 74.5 PTS";
    }
  } else {
    // No strong sets prediction, evaluate points independently
    if (probOver745Points > 0.55) {
      pts745Rec = "OVER 74.5 PTS";
    } else if (probUnder745Points > 0.6) {
      pts745Rec = "UNDER 74.5 PTS";
    }
  }

  // PREVENT CONTRADICTORY PREDICTIONS
  // OVER 3.5 SETS + UNDER 74.5 PTS is almost impossible in real table tennis
  if (sets35Rec === "OVER 3.5 SETS" && pts745Rec === "UNDER 74.5 PTS") {
    console.log(
      `[OU] Warning: Contradiction detected for ${playerA} vs ${playerB} - OVER 3.5 sets doesn't make sense with UNDER 74.5 points`,
    );
    // Override points to "NO BET" or force OVER
    pts745Rec = probOver745Points > 0.4 ? "OVER 74.5 PTS" : "NO BET";
  }

  // UNDER 3.5 SETS + OVER 74.5 PTS is also very unlikely
  if (sets35Rec === "UNDER 3.5 SETS" && pts745Rec === "OVER 74.5 PTS") {
    console.log(
      `[OU] Warning: Contradiction detected for ${playerA} vs ${playerB} - UNDER 3.5 sets with OVER 74.5 points is unlikely`,
    );
    pts745Rec = "NO BET";
  }

  // Edge calculation (estimated market odds)
  const typicalOver35Odds = eloDiff > 200 ? 2.5 : eloDiff > 100 ? 2.0 : 1.75;
  const typicalUnder35Odds = eloDiff > 200 ? 1.45 : eloDiff > 100 ? 1.75 : 2.0;
  const typicalOver745Odds = 2.8; // Realistic odds for OVER 74.5
  const typicalUnder745Odds = 1.4; // UNDER 74.5 is typically shorter odds

  const edgeOver35 = (probOver35Sets - 1 / typicalOver35Odds) * 100;
  const edgeUnder35 = (probUnder35Sets - 1 / typicalUnder35Odds) * 100;
  const edgeOver745 = (probOver745Points - 1 / typicalOver745Odds) * 100;
  const edgeUnder745 = (probUnder745Points - 1 / typicalUnder745Odds) * 100;

  // Narrative explanation
  let narrative = "";
  if (sets35Rec === "OVER 3.5 SETS") {
    if (probFiveSets > 0.2) {
      narrative = `Expected competitive match (${eloDiff} Elo gap). 5 sets likely → high total points expected.`;
    } else {
      narrative = `Close match (${eloDiff} Elo gap). Expect 4+ sets with decent total points.`;
    }
  } else if (sets35Rec === "UNDER 3.5 SETS") {
    narrative = `One-sided match (${eloDiff} Elo gap). Expected 3-0 or 3-1 → low total points.`;
  } else {
    if (eloDiff < 100) {
      narrative = `Very evenly matched (${eloDiff} Elo gap). Hard to predict set/pount totals.`;
    } else {
      narrative = `Moderate gap (${eloDiff} Elo). Could go either way on totals.`;
    }
  }

  return {
    playerA,
    playerB,
    ratingA: Math.round(ratingA),
    ratingB: Math.round(ratingB),
    eloDiff: Math.round(eloDiff),
    winProbFav: (winProbFav * 100).toFixed(1),

    sets: {
      market: "Over/Under 3.5 Sets",
      probOver: (probOver35Sets * 100).toFixed(1),
      probUnder: (probUnder35Sets * 100).toFixed(1),
      recommendation: sets35Rec,
      edgeOver: edgeOver35.toFixed(1),
      edgeUnder: edgeUnder35.toFixed(1),
      estOddsOver: typicalOver35Odds,
      estOddsUnder: typicalUnder35Odds,
    },

    points: {
      market: "Over/Under 74.5 Points",
      probOver: (probOver745Points * 100).toFixed(1),
      probUnder: (probUnder745Points * 100).toFixed(1),
      recommendation: pts745Rec,
      edgeOver: edgeOver745.toFixed(1),
      edgeUnder: edgeUnder745.toFixed(1),
      estOddsOver: typicalOver745Odds,
      estOddsUnder: typicalUnder745Odds,
    },

    narrative,
    confidence: minGames >= 30 ? "HIGH" : minGames >= 10 ? "MEDIUM" : "LOW",
  };
}

export async function generateOverUnderPredictions(matches) {
  const ouPredictions = [];

  for (const match of matches) {
    try {
      const ou = await predictOverUnder(
        match.rating_a || 1500,
        match.rating_b || 1500,
        match.games_a || 0,
        match.games_b || 0,
        match.player_a,
        match.player_b,
      );

      // Only include matches with clear recommendations
      const hasSetsBet = ou.sets.recommendation !== "NO BET";
      const hasPointsBet =
        ou.points.recommendation !== "NO BET" && ou.confidence !== "LOW";

      if (hasSetsBet || hasPointsBet) {
        ouPredictions.push({
          ...ou,
          matchId: match.id,
          tournament: match.tournament,
          scheduledAt: match.scheduled_at,
          externalId: match.external_id,
        });
      }
    } catch (err) {
      // Silently skip errors
    }
  }

  return ouPredictions;
}

export default { predictOverUnder, generateOverUnderPredictions };
