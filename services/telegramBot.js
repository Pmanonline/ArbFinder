// table-tennis/services/telegramBot.js
import TelegramBot from "node-telegram-bot-api";
import { bootstrapElo } from "./elo-bootstrap.js";
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
let isScanning = false;

// Escape special chars for Telegram MarkdownV2
function escapeMarkdownV2(text) {
  if (!text) return "";
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function formatValueBetMessage(bet) {
  // Use the pre-formatted times from predictor
  const timeDisplay = bet.scheduledTimeUtc
    ? `${bet.scheduledTimeUtc} UTC (${bet.scheduledTimeLocal} local)`
    : new Date(bet.scheduledAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      });

  const confidenceEmoji =
    bet.confidence === "HIGH"
      ? "🟢"
      : bet.confidence === "MEDIUM"
        ? "🟡"
        : "🔴";

  const lines = [
    "🎯 *VALUE BET FOUND*",
    "━━━━━━━━━━━━━━━━━━━━",
    `🏓 *${escapeMarkdownV2(bet.playerA)}* vs *${escapeMarkdownV2(bet.playerB)}*`,
    `🏆 ${escapeMarkdownV2(bet.tournament)} \\| ⏰ ${escapeMarkdownV2(timeDisplay)}`,
    "",
    "📊 *Match Winner Market*",
    `Bet on: *${escapeMarkdownV2(bet.favorite)}*`,
    `Odds: \`${escapeMarkdownV2(String(bet.marketOdds))}\` \\| Implied: ${escapeMarkdownV2(String(bet.impliedProb))}%`,
    `Model: ${escapeMarkdownV2(String(bet.favoriteProb))}% \\| Edge: *\\+${escapeMarkdownV2(String(bet.edgePercent))}%*`,
    "",
    "📈 *Elo Ratings*",
    `${escapeMarkdownV2(bet.playerA)}: ${escapeMarkdownV2(String(bet.ratingA))} \\(${escapeMarkdownV2(String(bet.gamesA))}g\\)`,
    `${escapeMarkdownV2(bet.playerB)}: ${escapeMarkdownV2(String(bet.ratingB))} \\(${escapeMarkdownV2(String(bet.gamesB))}g\\)`,
    `Diff: ${escapeMarkdownV2(String(bet.eloDiff))} pts`,
    "",
    `${confidenceEmoji} Confidence: ${escapeMarkdownV2(bet.confidence)}`,
    `💰 Suggested Stake: ${escapeMarkdownV2(bet.stakeSuggestion?.toLocaleString() || "N/A")}`,
    `📡 Source: ${escapeMarkdownV2(bet.oddsSource)}`,
    "",
    `⚠️ *Verification Required*: Check match exists and odds are still available on ${escapeMarkdownV2(bet.oddsSource)} before betting`,
  ];

  return lines.join("\n");
}

function formatScanSummary(valueBets, ouPredictions, runtime) {
  const lines = [
    `✅ *Scan Complete* \\(${escapeMarkdownV2(String(runtime))}s\\)`,
    "━━━━━━━━━━━━━━━━━━━━",
    `🎯 Value bets found: *${valueBets.length}*`,
    `📊 O\\/U predictions: *${ouPredictions.length}*`,
    "",
  ];

  if (valueBets.length === 0 && ouPredictions.length === 0) {
    lines.push("😴 No strong signals right now\\. Try again in 30 minutes\\.");
  } else {
    lines.push("📨 Sending detailed alerts above\\.");
    if (valueBets.length > 0) {
      lines.push("");
      lines.push(
        "⚠️ *Important*: Always verify match exists and odds are still available before betting\\.",
      );
    }
  }

  return lines.join("\n");
}

function escapeMarkdown(text) {
  if (!text) return "";
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// Plain text formatter for O/U (no markdown to avoid escaping issues)
function formatOverUnderMessagePlain(ou) {
  if (!ou?.scheduledAt) return null;

  const time = new Date(ou.scheduledAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });

  const confidenceEmoji =
    ou.confidence === "HIGH" ? "🟢" : ou.confidence === "MEDIUM" ? "🟡" : "🔴";

  const setsRec = ou.sets?.recommendation;
  const ptsRec = ou.points?.recommendation;

  let setsLine = "";
  if (setsRec && setsRec !== "NO BET") {
    const isOver = setsRec.includes("OVER");
    const prob = isOver ? ou.sets.probOver : ou.sets.probUnder;
    const edge = isOver ? ou.sets.edgeOver : ou.sets.edgeUnder;
    const odds = isOver ? ou.sets.estOddsOver : ou.sets.estOddsUnder;
    setsLine = `Sets Market (O/U 3.5): ${setsRec} @ ~${odds} | Prob: ${prob}% | Edge: +${edge}%`;
  }

  let ptsLine = "";
  if (ptsRec && ptsRec !== "NO BET" && ou.confidence !== "LOW") {
    const isOver = ptsRec.includes("OVER");
    const prob = isOver ? ou.points.probOver : ou.points.probUnder;
    const edge = isOver ? ou.points.edgeOver : ou.points.edgeUnder;
    const odds = isOver ? ou.points.estOddsOver : ou.points.estOddsUnder;
    ptsLine = `Points Market (O/U 74.5): ${ptsRec} @ ~${odds} | Prob: ${prob}% | Edge: +${edge}%`;
  }

  if (!setsLine && !ptsLine) return null;

  const lines = [
    "📊 OVER/UNDER PREDICTION",
    "━━━━━━━━━━━━━━━━━━━━",
    `${ou.playerA} vs ${ou.playerB}`,
    `${ou.tournament || "Table Tennis"} | ${time} UTC`,
    `Elo gap: ${ou.eloDiff} pts`,
    "",
    setsLine,
    ptsLine,
    "",
    `${ou.narrative || ""}`,
    `${confidenceEmoji} Confidence: ${ou.confidence}`,
  ];

  return lines.filter((l) => l !== "").join("\n");
}

async function runScan(chatId, triggeredBy = "scheduled") {
  if (isScanning) {
    await bot.sendMessage(
      chatId,
      "⏳ A scan is already in progress\\. Please wait\\.",
      { parse_mode: "MarkdownV2" },
    );
    return;
  }

  isScanning = true;
  const startTime = Date.now();

  try {
    const { default: generatePredictions } = await import("./predictor.js");
    const { generateOverUnderPredictions } =
      await import("./over-under-predictor.js");

    await bot.sendMessage(
      chatId,
      "🔍 *Starting scan\\.\\.\\.*\nRefreshing Elo → Scraping → Predicting",
      { parse_mode: "MarkdownV2" },
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

    // Step 3: Get upcoming matches
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

    // Step 7: Send O/U alerts (plain text, no markdown)
    let ouSent = 0;
    for (const ou of ouPredictions.slice(0, MAX_ALERTS)) {
      const msg = formatOverUnderMessagePlain(ou);
      if (!msg) continue;
      try {
        await bot.sendMessage(chatId, msg); // No parse_mode = plain text
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
      { parse_mode: "MarkdownV2" },
    );
  } finally {
    isScanning = false;
  }
}

export function startBot() {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log("[TT-Bot] Telegram bot started with polling...");

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      `🏓 *ArbFinder Table Tennis Bot*\n\n` +
        `Commands:\n` +
        `/scan \\- Run a fresh prediction scan now\n` +
        `/status \\- Show database stats\n` +
        `/help \\- Show this message\n\n` +
        `Automatic scans run daily at *03:00 UTC*\\.\n\n` +
        `⚠️ *Important*: Always verify odds on the bookmaker site before betting\\.`,
      { parse_mode: "MarkdownV2" },
    );
  });

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
        `• Over\\/Under 74\\.5 Points\n\n` +
        `⚠️ *Disclaimer*: Predictions are based on models\\. Always verify odds and match existence before betting\\.`,
      { parse_mode: "MarkdownV2" },
    );
  });

  bot.onText(/\/scan/, async (msg) => {
    const chatId = msg.chat.id;
    await runScan(chatId, "manual");
  });

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

  bot.on("polling_error", (err) => {
    console.error("[TT-Bot] Polling error:", err.message);
  });

  return { bot, runScan };
}

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
  const msg = formatOverUnderMessagePlain(ou);
  if (!msg) return;
  try {
    await bot.sendMessage(CHAT_ID, msg);
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
      `👤 Active players: ${stats.activePlayers?.toLocaleString()}\n\n` +
      `⚠️ *Disclaimer*: Always verify odds on the bookmaker site before betting\\.`;

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
