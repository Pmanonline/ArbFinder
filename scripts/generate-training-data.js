// table-tennis/scripts/generate-training-data.js
import pool from "../db/client.js";
import { updateElo, expectedScore } from "../utils/elo.js";

async function generateTrainingData() {
  console.log("🎯 Generating synthetic training data for Elo system...\n");

  // Get all unique players
  const { rows: players } = await pool.query(`
    SELECT DISTINCT p.id, p.name 
    FROM players p
    JOIN matches m ON p.id = m.player_a_id OR p.id = m.player_b_id
  `);

  console.log(`Found ${players.length} players. Creating Elo ratings...\n`);

  if (players.length === 0) {
    console.log("No players found. Run scraper first.");
    process.exit(0);
  }

  // Assign initial Elo ratings (1500-2200 range based on name recognition)
  const playerRatings = new Map();
  const topPlayers = [
    "Zhendong",
    "Ma Long",
    "Wang",
    "Harimoto",
    "Ovtcharov",
    "Calderano",
    "Boll",
    "Liang",
    "Lin",
  ];

  for (const player of players) {
    let rating = 1500;
    // Give higher ratings to known top players
    for (const top of topPlayers) {
      if (player.name.includes(top)) {
        rating = 1800 + Math.random() * 300;
        break;
      }
    }
    rating += Math.random() * 200;
    playerRatings.set(player.id, Math.round(rating));
  }

  // BULK INSERT: Prepare all ratings at once
  console.log("💾 Saving initial ratings...");
  const initialRatings = [];
  for (const [id, rating] of playerRatings) {
    initialRatings.push(`(${id}, ${rating}, NOW() - INTERVAL '30 days')`);
  }

  // Batch insert in chunks of 100
  const chunkSize = 100;
  for (let i = 0; i < initialRatings.length; i += chunkSize) {
    const chunk = initialRatings.slice(i, i + chunkSize);
    await pool.query(`
      INSERT INTO player_ratings (player_id, rating_value, effective_date)
      VALUES ${chunk.join(", ")}
      ON CONFLICT DO NOTHING
    `);
    process.stdout.write(`.`);
  }
  console.log(`\n✅ Saved ${initialRatings.length} initial ratings`);

  // Generate matches in memory, then bulk insert
  console.log("\n📊 Generating synthetic match history...");

  const matches = [];
  const ratingUpdates = [];

  // Generate 500 matches (enough for good Elo calibration)
  for (let i = 0; i < 500; i++) {
    // Pick two random players
    const idx1 = Math.floor(Math.random() * players.length);
    let idx2 = Math.floor(Math.random() * players.length);
    while (idx2 === idx1) idx2 = Math.floor(Math.random() * players.length);

    const p1 = players[idx1];
    const p2 = players[idx2];

    let rating1 = playerRatings.get(p1.id);
    let rating2 = playerRatings.get(p2.id);

    const prob1 = expectedScore(rating1, rating2);
    const p1Wins = Math.random() < prob1;

    // Generate realistic set scores
    let setsA, setsB;
    if (p1Wins) {
      setsA = 3;
      setsB = Math.floor(Math.random() * 2) + (Math.random() < 0.3 ? 1 : 0);
      if (setsB > 2) setsB = 2;
    } else {
      setsB = 3;
      setsA = Math.floor(Math.random() * 2) + (Math.random() < 0.3 ? 1 : 0);
      if (setsA > 2) setsA = 2;
    }

    // Calculate new Elo
    const result = updateElo({
      ratingA: rating1,
      ratingB: rating2,
      winner: p1Wins ? "A" : "B",
      setsA: setsA,
      setsB: setsB,
      kFactor: 32,
    });

    // Store rating updates
    ratingUpdates.push({
      playerId: p1.id,
      newRating: result.newRatingA,
      day: i % 30,
    });
    ratingUpdates.push({
      playerId: p2.id,
      newRating: result.newRatingB,
      day: i % 30,
    });

    // Update in-memory ratings
    playerRatings.set(p1.id, result.newRatingA);
    playerRatings.set(p2.id, result.newRatingB);

    if ((i + 1) % 100 === 0) {
      console.log(`  Generated ${i + 1}/500 matches...`);
    }
  }

  // Bulk insert rating updates (in chunks)
  console.log("\n💾 Saving Elo updates...");
  const updates = [];
  for (const u of ratingUpdates) {
    updates.push(
      `(${u.playerId}, ${u.newRating}, NOW() - INTERVAL '1 day' * ${u.day})`,
    );
  }

  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    await pool.query(`
      INSERT INTO player_ratings (player_id, rating_value, effective_date)
      VALUES ${chunk.join(", ")}
      ON CONFLICT DO NOTHING
    `);
    process.stdout.write(`.`);
  }

  console.log(`\n✅ Saved ${updates.length} rating updates`);

  // Show final top ratings
  console.log("\n📈 Final Elo Ratings (Top 20):\n");
  const sorted = Array.from(playerRatings.entries())
    .map(([id, rating]) => ({
      name: players.find((p) => p.id === id)?.name || "Unknown",
      rating,
    }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 20);

  sorted.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name.substring(0, 40)}: ${p.rating}`);
  });

  console.log("\n✅ Training complete!");
  console.log("   Now run: npm run daily");
  console.log(
    "   Value bets will appear when model probability > market odds\n",
  );

  process.exit();
}

generateTrainingData().catch(console.error);
