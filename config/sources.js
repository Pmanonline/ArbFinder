// table-tennis/config/sources.js
export const DATA_SOURCES = {
  SOFASCORE: {
    name: "SofaScore",
    baseUrl: "https://www.sofascore.com",
    endpoints: {
      upcoming: "/table-tennis",
      results: "/table-tennis/results",
      live: "/table-tennis/live",
      player: "/player/{id}",
      h2h: "/api/v1/event/{id}/h2h",
    },
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  },
  FLASHSCORE: {
    name: "FlashScore",
    baseUrl: "https://www.flashscore.com",
    endpoints: {
      upcoming: "/table-tennis",
      results: "/table-tennis/results",
      live: "/table-tennis/live",
    },
  },
  TABLETENNIS11: {
    name: "TableTennis11",
    baseUrl: "https://www.tabletennis11.com",
    endpoints: {
      ranking: "/ittf-ranking",
      players: "/players",
    },
  },
  ITTF: {
    name: "ITTF",
    baseUrl: "https://www.ittf.com",
    endpoints: {
      rankings: "/rankings",
      events: "/tournaments",
    },
  },
};
