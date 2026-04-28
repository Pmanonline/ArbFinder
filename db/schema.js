// table-tennis/db/schema.js
import pool from "./client.js";

const schemaSQL = `
-- Players Table
CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  country VARCHAR(100),
  handedness VARCHAR(20),
  birth_date DATE,
  ittf_rank INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tournaments Table
CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  league VARCHAR(100),
  tier VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Matches Table
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  external_id VARCHAR(100) UNIQUE,
  tournament_id INTEGER REFERENCES tournaments(id),
  player_a_id INTEGER REFERENCES players(id),
  player_b_id INTEGER REFERENCES players(id),
  scheduled_at TIMESTAMP,
  completed_at TIMESTAMP,
  winner_id INTEGER REFERENCES players(id),
  best_of INTEGER DEFAULT 5,
  status VARCHAR(50) DEFAULT 'upcoming',
  final_score_a INTEGER,
  final_score_b INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Match Sets Table
CREATE TABLE IF NOT EXISTS match_sets (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  player_a_points INTEGER,
  player_b_points INTEGER,
  winner_id INTEGER REFERENCES players(id)
);

-- Player Ratings (Elo)
CREATE TABLE IF NOT EXISTS player_ratings (
  id SERIAL PRIMARY KEY,
  player_id INTEGER REFERENCES players(id),
  rating_value NUMERIC(10,2) NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Model Predictions
CREATE TABLE IF NOT EXISTS model_predictions (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  market_type VARCHAR(50),
  model_version VARCHAR(50) DEFAULT 'v1',
  predicted_prob NUMERIC(6,4),
  edge_percent NUMERIC(6,4),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Bets Tracking (for backtesting & analytics)
CREATE TABLE IF NOT EXISTS bets (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  market_type VARCHAR(50),
  selection VARCHAR(100),
  bookmaker VARCHAR(100),
  odds_taken NUMERIC(8,3),
  closing_odds NUMERIC(8,3),
  model_prob NUMERIC(6,4),
  outcome SMALLINT, -- 1=win, 0=loss
  profit_loss NUMERIC(12,2),
  placed_at TIMESTAMP,
  settled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add some useful indexes
CREATE INDEX IF NOT EXISTS idx_matches_scheduled ON matches(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player_a_id, player_b_id);
CREATE INDEX IF NOT EXISTS idx_player_ratings_player ON player_ratings(player_id, effective_date);
`;

async function runSchema() {
  try {
    console.log("[TT-Schema] 🚀 Applying Table Tennis database schema...");

    await pool.query(schemaSQL);

    console.log("[TT-Schema] ✅ Schema applied successfully!");

    // Verify tables were created
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

    console.log(`[TT-Schema] Found ${result.rows.length} tables now:`);
    result.rows.forEach((row) => console.log(`   - ${row.table_name}`));
  } catch (err) {
    console.error("[TT-Schema] ❌ Failed to apply schema:", err.message);
  } finally {
    await pool.end();
  }
}

runSchema();
