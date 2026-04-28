// table-tennis/services/analytics.js
import pool from "../db/client.js";

class TableTennisAnalytics {
  // Calculate player form based on last N matches
  async calculatePlayerForm(playerId, matches = 10) {
    const result = await pool.query(
      `
      SELECT 
        COUNT(*) as total_matches,
        SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END) as wins,
        AVG(player_a_points + player_b_points) as avg_points,
        STDDEV(player_a_points + player_b_points) as point_volatility
      FROM matches m
      JOIN match_sets ms ON m.id = ms.match_id
      WHERE (player_a_id = $1 OR player_b_id = $1)
        AND m.completed_at > NOW() - INTERVAL '30 days'
      ORDER BY m.completed_at DESC
      LIMIT $2
    `,
      [playerId, matches],
    );

    if (result.rows.length === 0) return null;

    const stats = result.rows[0];
    return {
      winRate: stats.wins / stats.total_matches,
      avgPoints: Math.round(stats.avg_points),
      volatility: Math.round(stats.point_volatility),
      totalMatches: parseInt(stats.total_matches),
    };
  }

  // Calculate fatigue index
  async calculateFatigueIndex(playerId, matchDate) {
    const result = await pool.query(
      `
      SELECT 
        COUNT(*) as matches_today,
        EXTRACT(HOUR FROM (MIN(m.scheduled_at) - NOW())) as rest_hours
      FROM matches m
      WHERE (player_a_id = $1 OR player_b_id = $1)
        AND DATE(m.scheduled_at) = DATE($2)
        AND m.scheduled_at < $2
    `,
      [playerId, matchDate],
    );

    const stats = result.rows[0];
    let fatigueScore = 0;

    if (stats.matches_today >= 3) fatigueScore += 0.15;
    else if (stats.matches_today === 2) fatigueScore += 0.08;

    if (stats.rest_hours < 2) fatigueScore += 0.1;
    else if (stats.rest_hours < 4) fatigueScore += 0.05;

    return {
      fatigueScore,
      matchesToday: parseInt(stats.matches_today),
      restHours: Math.round(stats.rest_hours),
    };
  }

  // Calculate surface/venue advantage
  async calculateHomeAdvantage(playerId, tournamentId) {
    const result = await pool.query(
      `
      SELECT 
        COUNT(*) as matches,
        SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END) as wins
      FROM matches m
      JOIN tournaments t ON m.tournament_id = t.id
      WHERE (player_a_id = $1 OR player_b_id = $1)
        AND t.id = $2
    `,
      [playerId, tournamentId],
    );

    if (result.rows[0].matches === 0) return 0;
    return result.rows[0].wins / result.rows[0].matches;
  }

  // Predict match outcome with advanced metrics
  async predictMatchOutcome(matchId, eloProb, marketOdds) {
    const match = await pool.query(
      `
      SELECT m.*, 
             p1.name as player_a_name, p2.name as player_b_name,
             t.name as tournament_name
      FROM matches m
      JOIN players p1 ON m.player_a_id = p1.id
      JOIN players p2 ON m.player_b_id = p2.id
      LEFT JOIN tournaments t ON m.tournament_id = t.id
      WHERE m.id = $1
    `,
      [matchId],
    );

    if (match.rows.length === 0) return null;

    const matchData = match.rows[0];

    // Get form metrics
    const formA = await this.calculatePlayerForm(matchData.player_a_id);
    const formB = await this.calculatePlayerForm(matchData.player_b_id);

    // Get fatigue metrics
    const fatigueA = await this.calculateFatigueIndex(
      matchData.player_a_id,
      matchData.scheduled_at,
    );
    const fatigueB = await this.calculateFatigueIndex(
      matchData.player_b_id,
      matchData.scheduled_at,
    );

    // Combine probabilities
    let adjustedProb = eloProb;

    // Adjust for form
    if (formA && formB) {
      const formDiff = formA.winRate - formB.winRate;
      adjustedProb += formDiff * 0.1;
    }

    // Adjust for fatigue
    const fatigueDiff = fatigueB.fatigueScore - fatigueA.fatigueScore;
    adjustedProb += fatigueDiff * 0.05;

    // Cap at reasonable bounds
    adjustedProb = Math.max(0.35, Math.min(0.85, adjustedProb));

    const impliedProb = 1 / marketOdds;
    const edge = (adjustedProb - impliedProb) * 100;

    return {
      matchId,
      playerA: matchData.player_a_name,
      playerB: matchData.player_b_name,
      baseProb: eloProb,
      adjustedProb: adjustedProb,
      formA: formA?.winRate || 0.5,
      formB: formB?.winRate || 0.5,
      fatigueA: fatigueA,
      fatigueB: fatigueB,
      edge: edge,
      recommendation: edge > 5 ? "STRONG BET" : edge > 2 ? "VALUE" : "AVOID",
    };
  }
}

export default TableTennisAnalytics;
