// table-tennis/services/telegramBot.js
// Interactive Telegram bot with /scan command support
import TelegramBot from "node-telegram-bot-api";
import generatePredictions from "./predictor.js";
import { bootstrapElo } from "./elo-bootstrap.js";
import { generateOverUnderPredictions } from "./over-under-predictor.js";
import UnifiedTableTennisScraper from "../scrapers/unified-scraper.js";
import pool from "../db/client.js";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN =
  process.env.TT_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID =
  process.env.TT_CHAT_ID || process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN) throw new Error("Telegram bot token not set in environment");

let bot;
let isScanning = false; // prevent concurrent scans

// ── Message formatters ────────────────────────────────────────────────────────

function formatValueBetMessage(bet) {
  const time = new Date(bet.scheduledAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  const confidenceEmoji =
    bet.confidence === "HIGH"
      ? "🟢"
      : bet.confidence === "MEDIUM"
        ? "🟡"
        : "🔴";

  return (
    `🎯 *VALUE BET FOUND*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏓 *${escapeMarkdown(bet.playerA)}* vs *${escapeMarkdown(bet.playerB)}*\n` +
    `🏆 ${escapeMarkdown(bet.tournament)} | ⏰ ${time} UTC\n\n` +
    `📊 *Match Winner Market*\n` +
    `Bet on: *${escapeMarkdown(bet.favorite)}*\n` +
    `Odds: \`${bet.marketOdds}\` | Implied: ${bet.impliedProb}%\n` +
    `Model: ${bet.favoriteProb}% | Edge: *+${bet.edgePercent}%*\n\n` +
    `📈 *Elo Ratings*\n` +
    `${escapeMarkdown(bet.playerA)}: ${bet.ratingA} (${bet.gamesA}g)\n` +
    `${escapeMarkdown(bet.playerB)}: ${bet.ratingB} (${bet.gamesB}g)\n` +
    `Diff: ${bet.eloDiff} pts\n\n` +
    `${confidenceEmoji} Confidence: ${bet.confidence}\n` +
    `💰 Suggested Stake: ${bet.stakeSuggestion?.toLocaleString() || "N/A"}\n` +
    `📡 Source: ${bet.oddsSource}`
  );
}

function formatOverUnderMessage(ou) {
  const time = new Date(ou.scheduledAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  const confidenceEmoji =
    ou.confidence === "HIGH" ? "🟢" : ou.confidence === "MEDIUM" ? "🟡" : "🔴";

  const setsRec = ou.sets.recommendation;
  const ptsRec = ou.points.recommendation;

  let setsLine = "";
  if (setsRec !== "NO BET") {
    const isOver = setsRec.includes("OVER");
    const prob = isOver ? ou.sets.probOver : ou.sets.probUnder;
    const edge = isOver ? ou.sets.edgeOver : ou.sets.edgeUnder;
    const odds = isOver ? ou.sets.estOddsOver : ou.sets.estOddsUnder;
    setsLine =
      `📐 *Sets Market (O/U 3.5)*\n` +
      `Bet: *${setsRec}* @ ~${odds}\n` +
      `Prob: ${prob}% | Edge: *+${edge}%*\n`;
  }

  let ptsLine = "";
  if (ptsRec !== "NO BET" && ou.confidence !== "LOW") {
    const isOver = ptsRec.includes("OVER");
    const prob = isOver ? ou.points.probOver : ou.points.probUnder;
    const edge = isOver ? ou.points.edgeOver : ou.points.edgeUnder;
    const odds = isOver ? ou.points.estOddsOver : ou.points.estOddsUnder;
    ptsLine =
      `🔢 *Points Market (O/U 74.5)*\n` +
      `Bet: *${ptsRec}* @ ~${odds}\n` +
      `Prob: ${prob}% | Edge: *+${edge}%*\n`;
  }

  if (!setsLine && !ptsLine) return null;

  return (
    `📊 *OVER/UNDER PREDICTION*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏓 *${escapeMarkdown(ou.playerA)}* vs *${escapeMarkdown(ou.playerB)}*\n` +
    `🏆 ${escapeMarkdown(ou.tournament || "Table Tennis")} | ⏰ ${time} UTC\n` +
    `📉 Elo gap: ${ou.eloDiff} pts\n\n` +
    (setsLine ? setsLine + "\n" : "") +
    (ptsLine ? ptsLine + "\n" : "") +
    `💬 ${escapeMarkdown(ou.narrative)}\n` +
    `${confidenceEmoji} Confidence: ${ou.confidence}`
  );
}

function formatScanSummary(valueBets, ouPredictions, runtime) {
  return (
    `✅ *Scan Complete* (${runtime}s)\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎯 Value bets found: *${valueBets.length}*\n` +
    `📊 O/U predictions: *${ouPredictions.length}*\n\n` +
    (valueBets.length === 0 && ouPredictions.length === 0
      ? "😴 No strong signals right now\\. Try again in 30 minutes\\."
      : "📨 Sending detailed alerts above\\.")
  );
}

function escapeMarkdown(text) {
  if (!text) return "";
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

// ── Core scan function ────────────────────────────────────────────────────────

async function runScan(chatId, triggeredBy = "scheduled") {
  if (isScanning) {
    await bot.sendMessage(
      chatId,
      "⏳ A scan is already in progress\\. Please wait\\.",
      {
        parse_mode: "MarkdownV2",
      },
    );
    return;
  }

  isScanning = true;
  const startTime = Date.now();

  try {
    await bot.sendMessage(
      chatId,
      "🔍 *Starting scan\\.\\.\\.*\nRefreshing Elo → Scraping → Predicting",
      {
        parse_mode: "MarkdownV2",
      },
    );

    // Step 1: Elo refresh
    try {
      await bootstrapElo(7);
    } catch (e) {
      console.warn("Elo refresh failed:", e.message);
    }

    // Step 2: Scrape fresh matches
    try {
      const scraper = new UnifiedTableTennisScraper();
      await scraper.init();
      const scraped = await scraper.scrapeAllSources();
      await scraper.saveMatchesToDB(scraped);
      await scraper.close();
    } catch (e) {
      console.warn("Scrape failed:", e.message);
    }

    // Step 3: Get upcoming matches for O/U prediction
    const { rows: upcomingMatches } = await pool.query(`
      SELECT 
        m.id, m.external_id,
        p1.name as player_a, p2.name as player_b,
        t.name as tournament, m.scheduled_at,
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
        WHERE player_id = p1.id AND games_played >= 5
        ORDER BY effective_date DESC LIMIT 1
      ) r1 ON true
      LEFT JOIN LATERAL (
        SELECT rating_value, games_played FROM player_ratings 
        WHERE player_id = p2.id AND games_played >= 5
        ORDER BY effective_date DESC LIMIT 1
      ) r2 ON true
      WHERE m.status = 'upcoming'
        AND m.scheduled_at > NOW()
        AND m.scheduled_at < NOW() + INTERVAL '24 hours'
        AND m.player_a_id != m.player_b_id
      ORDER BY m.scheduled_at ASC
      LIMIT 100
    `);

    // Step 4: Generate value bets
    const { valueBets } = await generatePredictions();

    // Step 5: Generate O/U predictions
    const ouPredictions = await generateOverUnderPredictions(upcomingMatches);

    const runtime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Step 6: Send value bet alerts (max 10)
    const MAX_ALERTS = 10;
    for (const bet of valueBets.slice(0, MAX_ALERTS)) {
      try {
        await bot.sendMessage(chatId, formatValueBetMessage(bet), {
          parse_mode: "MarkdownV2",
        });
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        console.error("Failed to send value bet:", e.message);
      }
    }

    // Step 7: Send O/U alerts (max 10)
    let ouSent = 0;
    for (const ou of ouPredictions.slice(0, MAX_ALERTS)) {
      const msg = formatOverUnderMessage(ou);
      if (!msg) continue;
      try {
        await bot.sendMessage(chatId, msg, { parse_mode: "MarkdownV2" });
        await new Promise((r) => setTimeout(r, 1000));
        ouSent++;
      } catch (e) {
        console.error("Failed to send O/U prediction:", e.message);
      }
    }

    // Step 8: Summary
    await bot.sendMessage(
      chatId,
      formatScanSummary(valueBets, ouPredictions.slice(0, ouSent), runtime),
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    console.error("Scan error:", err);
    await bot.sendMessage(
      chatId,
      `❌ Scan failed: ${escapeMarkdown(err.message)}`,
      {
        parse_mode: "MarkdownV2",
      },
    );
  } finally {
    isScanning = false;
  }
}

// ── Bot commands ──────────────────────────────────────────────────────────────

export function startBot() {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });

  console.log("[TT-Bot] Telegram bot started with polling...");

  // /start — welcome message
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      `🏓 *ArbFinder Table Tennis Bot*\n\n` +
        `Commands:\n` +
        `/scan \\- Run a fresh prediction scan now\n` +
        `/status \\- Show database stats\n` +
        `/help \\- Show this message\n\n` +
        `Automatic scans run daily at *03:00 UTC*\\.`,
      { parse_mode: "MarkdownV2" },
    );
  });

  // /help
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      `🏓 *ArbFinder Commands*\n\n` +
        `/scan \\- Rescan now for value bets \\+ O\\/U predictions\n` +
        `/status \\- Database stats \\(players, matches, ratings\\)\n` +
        `/start \\- Welcome message\n\n` +
        `*Markets covered:*\n` +
        `• Match Winner \\(value bet vs Elo model\\)\n` +
        `• Over\\/Under 3\\.5 Sets\n` +
        `• Over\\/Under 74\\.5 Points`,
      { parse_mode: "MarkdownV2" },
    );
  });

  // /scan — manual trigger
  bot.onText(/\/scan/, async (msg) => {
    const chatId = msg.chat.id;
    await runScan(chatId, "manual");
  });

  // /status — DB stats
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const [players, upcoming, ratings] = await Promise.all([
        pool.query("SELECT COUNT(*) as c FROM players"),
        pool.query(
          "SELECT COUNT(*) as c FROM matches WHERE status = 'upcoming' AND scheduled_at > NOW() AND scheduled_at < NOW() + INTERVAL '24 hours'",
        ),
        pool.query(
          "SELECT COUNT(DISTINCT player_id) as c FROM player_ratings WHERE effective_date >= CURRENT_DATE",
        ),
      ]);

      await bot.sendMessage(
        chatId,
        `📊 *Database Status*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 Total players: *${parseInt(players.rows[0].c).toLocaleString()}*\n` +
          `📅 Upcoming \\(24h\\): *${parseInt(upcoming.rows[0].c).toLocaleString()}*\n` +
          `📈 Rated today: *${parseInt(ratings.rows[0].c).toLocaleString()}*`,
        { parse_mode: "MarkdownV2" },
      );
    } catch (e) {
      await bot.sendMessage(chatId, `❌ Error: ${escapeMarkdown(e.message)}`, {
        parse_mode: "MarkdownV2",
      });
    }
  });

  // Handle polling errors gracefully
  bot.on("polling_error", (err) => {
    console.error("[TT-Bot] Polling error:", err.message);
  });

  return { bot, runScan };
}

// ── Standalone send functions (used by index-predict.js scheduled run) ────────

export async function sendValueBetAlertBot(bet) {
  if (!bot) return;
  try {
    await bot.sendMessage(CHAT_ID, formatValueBetMessage(bet), {
      parse_mode: "MarkdownV2",
    });
  } catch (e) {
    console.error("[TT-Bot] Failed to send value bet:", e.message);
  }
}

export async function sendOverUnderAlertBot(ou) {
  if (!bot) return;
  const msg = formatOverUnderMessage(ou);
  if (!msg) return;
  try {
    await bot.sendMessage(CHAT_ID, msg, { parse_mode: "MarkdownV2" });
  } catch (e) {
    console.error("[TT-Bot] Failed to send O/U alert:", e.message);
  }
}

export async function sendDailyReportBot(stats) {
  if (!bot) return;
  try {
    const msg =
      `📋 *Daily Report*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⏱ Runtime: ${escapeMarkdown(stats.runtime)}s\n` +
      `📊 Matches analyzed: *${stats.totalMatches}*\n` +
      `🎯 Value bets: *${stats.valueBets}*\n` +
      `📐 O\\/U predictions: *${stats.ouPredictions || 0}*\n` +
      (stats.topMatch
        ? `🏆 Top bet: ${escapeMarkdown(stats.topMatch)} \\(\\+${escapeMarkdown(stats.topEdge)}\\)\n`
        : "") +
      `👤 Active players: ${stats.activePlayers?.toLocaleString()}`;

    await bot.sendMessage(CHAT_ID, msg, { parse_mode: "MarkdownV2" });
  } catch (e) {
    console.error("[TT-Bot] Failed to send daily report:", e.message);
  }
}

export default {
  startBot,
  sendValueBetAlertBot,
  sendOverUnderAlertBot,
  sendDailyReportBot,
};
