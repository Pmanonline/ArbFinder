// table-tennis/services/telegramAlerts.js
import TT_CONFIG from "../config.js";

let bot = null;

// Escape special chars for Telegram MarkdownV2
function escapeV2(text) {
  if (!text) return "";
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

async function getBot() {
  const token =
    TT_CONFIG.telegramBotToken ||
    process.env.TT_BOT_TOKEN ||
    process.env.BOT_TOKEN;

  if (!bot && token && token !== "your_telegram_bot_token_here") {
    const { default: TelegramBot } = await import("node-telegram-bot-api");
    bot = new TelegramBot(token, { polling: false });
    console.log("[TT-Alerts] Bot initialized");
  }
  return bot;
}

function getChatId() {
  return (
    TT_CONFIG.telegramChatId || process.env.TT_CHAT_ID || process.env.CHAT_ID
  );
}

export async function sendValueBetAlert(valueBet) {
  const botInstance = await getBot();
  const chatId = getChatId();

  if (!botInstance || !chatId) {
    console.log("[TT-Alerts] Telegram not configured - skipping alert");
    return;
  }

  const edgeEmoji =
    valueBet.edgePercent >= 12
      ? "🔴🔴🔴"
      : valueBet.edgePercent >= 8
        ? "🟠🟠"
        : valueBet.edgePercent >= 5
          ? "🟡"
          : "⚪";

  const confidenceEmoji =
    valueBet.confidence === "HIGH"
      ? "🟢"
      : valueBet.confidence === "MEDIUM"
        ? "🟡"
        : "🔴";

  const scheduledStr = valueBet.scheduledAt
    ? escapeV2(new Date(valueBet.scheduledAt).toLocaleString())
    : "Upcoming";

  const message = [
    `🏓 *TABLE TENNIS VALUE BET* ${edgeEmoji}`,
    "",
    `*${escapeV2(valueBet.playerA)}* vs *${escapeV2(valueBet.playerB)}*`,
    `🏆 ${escapeV2(valueBet.tournament || "Table Tennis")}`,
    `⏰ ${scheduledStr} UTC`,
    "",
    `📊 *Model Analysis*`,
    `   Bet on: *${escapeV2(valueBet.favorite)}*`,
    `   Win probability: *${escapeV2(String(valueBet.favoriteProb))}%*`,
    `   Elo ratings: ${escapeV2(String(valueBet.ratingA))} \\(${escapeV2(String(valueBet.gamesA))}g\\) vs ${escapeV2(String(valueBet.ratingB))} \\(${escapeV2(String(valueBet.gamesB))}g\\)`,
    `   Elo diff: ${escapeV2(String(valueBet.eloDiff || "N/A"))} pts`,
    "",
    `💰 *Market Odds*: \`${escapeV2(String(valueBet.marketOdds))}\``,
    `   Implied probability: ${escapeV2((100 / valueBet.marketOdds).toFixed(1))}%`,
    `   Edge: *\\+${escapeV2(String(valueBet.edgePercent))}%*`,
    "",
    `${confidenceEmoji} Confidence: *${escapeV2(valueBet.confidence || "MEDIUM")}*`,
    `📡 Source: ${escapeV2(valueBet.oddsSource || "SofaScore")}`,
    `💵 Suggested Stake: ₦${escapeV2(valueBet.stakeSuggestion?.toLocaleString() || "10,000")}`,
    "",
    `_Model: Elo v1\\.0 \\| Track your bets for CLV analysis_`,
  ].join("\n");

  try {
    await botInstance.sendMessage(chatId, message, {
      parse_mode: "MarkdownV2",
    });
    console.log(
      `[TT-Alerts] ✅ Alert sent for ${valueBet.playerA} vs ${valueBet.playerB}`,
    );
  } catch (err) {
    console.error("[TT-Alerts] Failed to send:", err.message);
  }
}

export async function sendOverUnderAlert(ou) {
  const botInstance = await getBot();
  const chatId = getChatId();

  if (!botInstance || !chatId) return;
  const msg = formatOverUnderMessage(ou); // reuse same plain-text formatter
  if (!msg) return;

  const confidenceEmoji =
    ou.confidence === "HIGH" ? "🟢" : ou.confidence === "MEDIUM" ? "🟡" : "🔴";

  const scheduledStr = ou.scheduledAt
    ? escapeV2(
        new Date(ou.scheduledAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        }),
      )
    : "Upcoming";

  const setsRec = ou.sets?.recommendation;
  const ptsRec = ou.points?.recommendation;

  let setsLine = "";
  if (setsRec && setsRec !== "NO BET") {
    const isOver = setsRec.includes("OVER");
    const prob = isOver ? ou.sets.probOver : ou.sets.probUnder;
    const edge = isOver ? ou.sets.edgeOver : ou.sets.edgeUnder;
    const odds = isOver ? ou.sets.estOddsOver : ou.sets.estOddsUnder;
    setsLine = [
      `📐 *Sets Market \\(O/U 3\\.5\\)*`,
      `   Bet: *${escapeV2(setsRec)}* @ ~${escapeV2(String(odds))}`,
      `   Prob: ${escapeV2(String(prob))}% \\| Edge: *\\+${escapeV2(String(edge))}%*`,
    ].join("\n");
  }

  let ptsLine = "";
  if (ptsRec && ptsRec !== "NO BET" && ou.confidence !== "LOW") {
    const isOver = ptsRec.includes("OVER");
    const prob = isOver ? ou.points.probOver : ou.points.probUnder;
    const edge = isOver ? ou.points.edgeOver : ou.points.edgeUnder;
    const odds = isOver ? ou.points.estOddsOver : ou.points.estOddsUnder;
    ptsLine = [
      `🔢 *Points Market \\(O/U 74\\.5\\)*`,
      `   Bet: *${escapeV2(ptsRec)}* @ ~${escapeV2(String(odds))}`,
      `   Prob: ${escapeV2(String(prob))}% \\| Edge: *\\+${escapeV2(String(edge))}%*`,
    ].join("\n");
  }

  if (!setsLine && !ptsLine) return; // nothing worth sending

  const lines = [
    `📊 *OVER\\/UNDER PREDICTION*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏓 *${escapeV2(ou.playerA)}* vs *${escapeV2(ou.playerB)}*`,
    `🏆 ${escapeV2(ou.tournament || "Table Tennis")} \\| ⏰ ${scheduledStr} UTC`,
    `📉 Elo gap: ${escapeV2(String(ou.eloDiff))} pts`,
    "",
    setsLine,
    setsLine && ptsLine ? "" : null,
    ptsLine,
    "",
    `💬 _${escapeV2(ou.narrative)}_`,
    `${confidenceEmoji} Confidence: ${escapeV2(ou.confidence)}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  try {
    await botInstance.sendMessage(chatId, msg); // No parse_mode
    console.log(
      `[TT-Alerts] ✅ O/U alert sent for ${ou.playerA} vs ${ou.playerB}`,
    );
  } catch (err) {
    console.error("[TT-Alerts] Failed to send O/U alert:", err.message);
  }
}

export async function sendDailyReport(stats) {
  const botInstance = await getBot();
  const chatId = getChatId();

  if (!botInstance || !chatId) return;

  const message = [
    `📈 *TABLE TENNIS DAILY REPORT*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 *Today's Overview*`,
    `   Upcoming matches: *${escapeV2(String(stats.totalMatches || 0))}*`,
    `   Value bets found: *${escapeV2(String(stats.valueBets || 0))}*`,
    `   O\\/U predictions: *${escapeV2(String(stats.ouPredictions || 0))}*`,
    `   Runtime: ${escapeV2(String(stats.runtime || "N/A"))}s`,
    "",
    `🎯 *Top Opportunity*`,
    `   ${escapeV2(stats.topMatch || "None found today")}`,
    `   Edge: ${escapeV2(String(stats.topEdge || "N/A"))}`,
    "",
    `⚡ *Model Status*`,
    `   Active players \\(30d\\): ${escapeV2(String(stats.activePlayers?.toLocaleString() || "N/A"))}`,
    `   Avg Elo rating: ${escapeV2(String(stats.avgElo || "N/A"))}`,
    "",
    `💡 _Value bets appear when model probability \\> market implied probability_`,
  ].join("\n");

  try {
    await botInstance.sendMessage(chatId, message, {
      parse_mode: "MarkdownV2",
    });
    console.log("[TT-Alerts] ✅ Daily report sent");
  } catch (err) {
    console.error("[TT-Alerts] Failed to send daily report:", err.message);
  }
}

export default { sendValueBetAlert, sendOverUnderAlert, sendDailyReport };
