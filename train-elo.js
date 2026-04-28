// table-tennis/scripts/train-elo.js
import pool from "./db/client.js";
import { updateElo, expectedScore } from "./utils/elo.js";

async function trainEloWithExistingMatches() {
  console.log("🎯 Training Elo system with existing matches...");

  // Get all completed matches with winners
  const { rows: matches } = await pool.query(`
    SELECT 
      m.id, m.player_a_id, m.player_b_id, m.winner_id,
      p1.name as player_a, p2.name as player_b,
      COALESCE(r1.rating_value, 1500) as rating_a,
      COALESCE(r2.rating_value, 1500) as rating_b
    FROM matches m
    JOIN players p1 ON m.player_a_id = p1.id
    JOIN players p2 ON m.player_b_id = p2.id
    LEFT JOIN LATERAL (
      SELECT rating_value FROM player_ratings 
      WHERE player_id = p1.id ORDER BY effective_date DESC LIMIT 1
    ) r1 ON true
    LEFT JOIN LATERAL (
      SELECT rating_value FROM player_ratings 
      WHERE player_id = p2.id ORDER BY effective_date DESC LIMIT 1
    ) r2 ON true
    WHERE m.status = 'completed' AND m.winner_id IS NOT NULL
    LIMIT 500
  `);

  console.log(`Found ${matches.length} completed matches to train on`);

  let trained = 0;
  for (const match of matches) {
    const winnerIsA = match.winner_id === match.player_a_id;
    const expectedA = expectedScore(match.rating_a, match.rating_b);

    // Simulate 3-0 win for training (we don't have set scores)
    const result = updateElo({
      ratingA: match.rating_a,
      ratingB: match.rating_b,
      winner: winnerIsA ? "A" : "B",
      setsA: winnerIsA ? 3 : 0,
      setsB: winnerIsA ? 0 : 3,
      kFactor: 32,
    });

    await pool.query(
      `INSERT INTO player_ratings (player_id, rating_value, effective_date)
       VALUES ($1, $2, CURRENT_DATE)`,
      [match.player_a_id, result.newRatingA],
    );
    await pool.query(
      `INSERT INTO player_ratings (player_id, rating_value, effective_date)
       VALUES ($1, $2, CURRENT_DATE)`,
      [match.player_b_id, result.newRatingB],
    );

    trained++;
    if (trained % 50 === 0) console.log(`Trained ${trained} matches...`);
  }

  console.log(`✅ Trained Elo system on ${trained} matches`);
  process.exit();
}

trainEloWithExistingMatches().catch(console.error);
