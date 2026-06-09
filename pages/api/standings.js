// pages/api/standings.js
// Proxies MLB Stats API to avoid browser CORS issues

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const season = new Date().getFullYear();
    const mlbRes = await fetch(
      `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`
    );

    if (!mlbRes.ok) {
      throw new Error("MLB Stats API returned " + mlbRes.status);
    }

    const data = await mlbRes.json();
    const records = {};

    for (const division of data.records || []) {
      for (const entry of division.teamRecords || []) {
        const fullName = entry.team?.name || "";
        const w = entry.wins ?? "?";
        const l = entry.losses ?? "?";
        const val = { fullName, record: `${w}-${l}`, wins: w, losses: l };

        records[fullName.toLowerCase()] = val;
        // Index by last word too (e.g. "orioles", "yankees", "dodgers")
        const short = fullName.toLowerCase().split(" ").pop();
        records[short] = val;
      }
    }

    // Cache for 5 minutes on Vercel edge
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    return res.status(200).json({ success: true, records });

  } catch (err) {
    console.error("Standings fetch error:", err.message);
    return res.status(500).json({ success: false, error: err.message, records: {} });
  }
}
