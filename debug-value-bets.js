import('./services/predictor.js').then(async (m) => {
  const result = await m.generatePredictions();
  console.log('\n📊 DETAILED ANALYSIS OF MATCHES WITH REAL ODDS:\n');
  
  let found = 0;
  for (const bet of result.predictions) {
    if (bet.oddsSource !== 'Estimated') {
      found++;
      console.log(`${found}. ${bet.playerA} vs ${bet.playerB}`);
      console.log(`   Elo: ${bet.ratingA} vs ${bet.ratingB} (diff: ${bet.eloDiff})`);
      console.log(`   Model: ${bet.favoriteProb}% for ${bet.favorite}`);
      console.log(`   Market Odds: ${bet.marketOdds} (${bet.impliedProb}% implied)`);
      console.log(`   Edge: ${bet.edgePercent}%`);
      console.log(`   Source: ${bet.oddsSource} | Margin: ${bet.margin}%`);
      console.log(`   Confidence: ${bet.confidence}\n`);
    }
  }
  
  if (found === 0) {
    console.log('No matches with real odds found in this run.');
  }
  
  process.exit();
});
