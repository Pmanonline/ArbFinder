// table-tennis/check-odds.js
import pool from "./db/client.js";

async function checkOdds() {
  console.log("🔍 Checking for matches with real odds...\n");

  const { rows } = await pool.query(`
    SELECT 
      m.id,
      p1.name as player_a,
      p2.name as player_b,
      m.scheduled_at,
      COALESCE(r1.rating_value, 1500) as rating_a,
      COALESCE(r2.rating_value, 1500) as rating_b,
      COALESCE(r1.games_played, 0) as games_a,
      COALESCE(r2.games_played, 0) as games_b
    FROM matches m
    JOIN players p1 ON m.player_a_id = p1.id
    JOIN players p2 ON m.player_b_id = p2.id
    LEFT JOIN LATERAL (
      SELECT rating_value, games_played FROM player_ratings 
      WHERE player_id = p1.id ORDER BY effective_date DESC LIMIT 1
    ) r1 ON true
    LEFT JOIN LATERAL (
      SELECT rating_value, games_played FROM player_ratings 
      WHERE player_id = p2.id ORDER BY effective_date DESC LIMIT 1
    ) r2 ON true
    WHERE m.status = 'upcoming'
      AND m.scheduled_at > NOW()
      AND m.scheduled_at < NOW() + INTERVAL '24 hours'
    ORDER BY m.scheduled_at ASC
    LIMIT 20
  `);

  console.log(`Found ${rows.length} upcoming matches:\n`);

  for (const match of rows) {
    const probA =
      1 / (1 + Math.pow(10, (match.rating_b - match.rating_a) / 400));
    const probB = 1 - probA;
    const favorite = probA > 0.5 ? match.player_a : match.player_b;
    const favoriteProb = Math.max(probA, probB);

    console.log(`${match.player_a} vs ${match.player_b}`);
    console.log(
      `  Elo: ${Math.round(match.rating_a)} vs ${Math.round(match.rating_b)}`,
    );
    console.log(`  Games: ${match.games_a} vs ${match.games_b}`);
    console.log(`  Model: ${favorite} ${(favoriteProb * 100).toFixed(1)}%`);
    console.log(`  Time: ${new Date(match.scheduled_at).toLocaleString()}`);
    console.log("");
  }

  await pool.end();
}

checkOdds().catch(console.error);
