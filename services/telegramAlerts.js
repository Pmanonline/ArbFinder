// table-tennis/services/telegramAlerts.js
import TT_CONFIG from "../config.ts";

let bot = null;

async function getBot() {
  const token =
    TT_CONFIG.telegramBotToken ||
    process.env.TT_BOT_TOKEN ||
    process.env.BOT_TOKEN;
  const chatId =
    TT_CONFIG.telegramChatId || process.env.TT_CHAT_ID || process.env.CHAT_ID;

  if (!bot && token && token !== "your_telegram_bot_token_here") {
    const { default: TelegramBot } = await import("node-telegram-bot-api");
    bot = new TelegramBot(token, { polling: false });
    console.log("[TT-Alerts] Bot initialized");
  }
  return bot;
}

export async function sendValueBetAlert(valueBet) {
  const botInstance = await getBot();
  const chatId =
    TT_CONFIG.telegramChatId || process.env.TT_CHAT_ID || process.env.CHAT_ID;

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

  const message = `
🏓 *TABLE TENNIS VALUE BET* ${edgeEmoji}

*${valueBet.playerA}* vs *${valueBet.playerB}*
🏆 ${valueBet.tournament || "Table Tennis"}
⏰ ${valueBet.scheduledAt ? new Date(valueBet.scheduledAt).toLocaleString() : "Upcoming"}

📊 *Model Analysis*
   ${valueBet.favorite} win probability: *${valueBet.favoriteProb}%*
   Elo Diff: ${valueBet.eloDiff || "N/A"}

💰 *Market Odds*: ${valueBet.marketOdds}
   Implied probability: ${(100 / valueBet.marketOdds).toFixed(1)}%

🎯 *Edge*: *+${valueBet.edgePercent}%* ${valueBet.modelConfidence || ""}

💵 *Suggested Stake*: ₦${valueBet.stakeSuggestion?.toLocaleString() || "10,000"}

_Model: Elo v1.0 | Track your bets for CLV analysis_
  `.trim();

  try {
    await botInstance.sendMessage(chatId, message, {
      parse_mode: "Markdown",
    });
    console.log(
      `[TT-Alerts] ✅ Alert sent for ${valueBet.playerA} vs ${valueBet.playerB}`,
    );
  } catch (err) {
    console.error("[TT-Alerts] Failed to send:", err.message);
  }
}

export async function sendDailyReport(stats) {
  const botInstance = await getBot();
  const chatId =
    TT_CONFIG.telegramChatId || process.env.TT_CHAT_ID || process.env.CHAT_ID;

  if (!botInstance || !chatId) return;

  const message = `
📈 *TABLE TENNIS DAILY REPORT*

📊 *Today's Overview*
   Upcoming matches: ${stats.totalMatches}
   Value bets found: ${stats.valueBets}
   
🎯 *Top Opportunity*
   ${stats.topMatch || "None found yet"}
   Edge: ${stats.topEdge || "N/A"}

⚡ *Model Status*
   Active players (30d): ${stats.activePlayers}
   Avg Elo rating: ${stats.avgElo || "N/A"}

💡 *Tip*: Value bets appear when model probability > market implied probability
  `.trim();

  try {
    await botInstance.sendMessage(chatId, message, {
      parse_mode: "Markdown",
    });
    console.log("[TT-Alerts] ✅ Daily report sent");
  } catch (err) {
    console.error("[TT-Alerts] Failed to send daily report:", err.message);
  }
}
