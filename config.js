// table-tennis/config.js
import dotenv from "dotenv";
dotenv.config();

export const TT_CONFIG = {
  // Elo settings
  defaultKFactor: 32,
  eliteKFactor: 20,
  newPlayerKFactor: 40,

  // Edge thresholds
  minPreMatchEdge: 0.04, // 4% (as decimal)
  minLiveEdge: 0.09, // 9%
  minPreMatchEdgePercent: 6, // 6% (as percentage for alerts)

  // Alert settings
  minModelProbability: 0.58,

  // Betting
  baseStake: 10000,
  maxStakePercent: 0.05,

  // Scraping
  scrapeIntervalMinutes: 30,
  backtestLookbackDays: 180,

  // Telegram (from env)
  telegramBotToken: process.env.TT_BOT_TOKEN || process.env.BOT_TOKEN,
  telegramChatId: process.env.TT_CHAT_ID || process.env.CHAT_ID,

  // Database
  databaseUrl: process.env.DATABASE_URL,

  // Markets
  targetMarkets: ["match_winner", "over_under_sets"],
};

export default TT_CONFIG;
