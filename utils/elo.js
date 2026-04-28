// table-tennis/utils/elo.js

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function marginMultiplier(setsWon, setsLost) {
  const margin = setsWon - setsLost;
  return 1 + 0.25 * margin; // bigger wins give more rating change
}

export function updateElo({
  ratingA,
  ratingB,
  winner, // 'A' or 'B'
  setsA,
  setsB,
  kFactor = 32,
}) {
  const expectedA = expectedScore(ratingA, ratingB);
  const scoreA = winner === "A" ? 1 : 0;

  const multiplier = marginMultiplier(
    winner === "A" ? setsA : setsB,
    winner === "A" ? setsB : setsA,
  );

  const newRatingA = ratingA + kFactor * multiplier * (scoreA - expectedA);
  const newRatingB =
    ratingB + kFactor * multiplier * (1 - scoreA - (1 - expectedA));

  return {
    newRatingA: Math.round(newRatingA),
    newRatingB: Math.round(newRatingB),
    expectedA: expectedA.toFixed(4),
  };
}

export function fairOdds(probability) {
  return probability > 0.01 ? Number((1 / probability).toFixed(2)) : 100;
}

export function calculateEdge(modelProb, marketOdds) {
  const implied = 1 / marketOdds;
  return (modelProb - implied) * 100; // return in percentage
}

export default {
  updateElo,
  fairOdds,
  calculateEdge,
  expectedScore,
};
