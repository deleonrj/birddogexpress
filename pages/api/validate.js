// pages/api/validate.js
// Serverless function — runs on Vercel, keeps ANTHROPIC_API_KEY server-side

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { rumor, gptOutput } = req.body;

  if (!rumor?.trim()) {
    return res.status(400).json({ error: "Rumor is required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured in Vercel environment variables" });
  }

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const thisYear = new Date().getFullYear();

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  // ── PASS 1: Focused search — 3 searches max, concise output ───────────────
  const searchSystemPrompt = [
    "You are an MLB research assistant. Run web searches and return only what you find. Be concise.",
    "TODAY IS: " + today + ". Your training data is STALE. Every fact must come from a search result.",
    "",
    "Run exactly 3 searches:",
    "1. [player name] trade rumors " + thisYear,
    "2. [origin team] [destination team] trade " + thisYear,
    "3. [player name] contract salary " + thisYear,
    "",
    "Return a SHORT report — max 800 words total — with these sections:",
    "RUMOR SOURCES: Articles found. Byline, outlet, date, key quote (1 sentence max each).",
    "TEAM CONTEXT: Brief notes on both teams from search — roster need, payroll posture, GM name.",
    "PLAYER CONTEXT: Contract status, age, performance — from search only.",
    "GAPS: What you could not find. Write NOTHING FOUND if a section is empty.",
    "",
    "Be brief. Do not pad. Stop at 800 words.",
  ].join("\n");

  // ── PASS 2: Analysis — compact JSON output ────────────────────────────────
  const analysisSystemPrompt = [
    "You are an MLB rumor analyst for BirdDog Express. Analyze ONLY the research findings provided.",
    "TODAY IS: " + today,
    "",
    "RULES: Analyze only what is in the findings. No memory. No invented details.",
    "If a section says NOTHING FOUND, apply the confidence cap and note it.",
    "",
    "CLASSIFICATION:",
    "CORROBORATED: 2+ independent Tier-1 sources confirm.",
    "PLAUSIBLE: 1 credible source; logic consistent.",
    "WEAK: Aggregators or low-credibility sources only.",
    "REFUTED: Credible denial found.",
    "UNVERIFIED: Cannot determine.",
    "",
    "CONFIDENCE CAPS:",
    "Both markets confirm: credibility >= 80",
    "One market or national only: credibility 50-65",
    "No credible coverage: credibility <= 40",
    "Denial or only low-cred: credibility <= 25",
    "",
    "GM MODIFIER: +10 matches known behavior | 0 neutral | -10 contradicts",
    "SCORING: overall = (credibility * 0.6) + (fit * 0.4)",
    "",
    "Return ONLY raw JSON, no markdown, no backticks:",
    '{"verdict":"CORROBORATED|PLAUSIBLE|WEAK|REFUTED|UNVERIFIED","credibility_score":0,"fit_score":0,"overall_likelihood":0,"sources_found":["Byline - Outlet - Date"],"origin_market":"finding or: No credible coverage found; confidence capped.","destination_market":"finding or: No credible coverage found; confidence capped.","national":"national coverage or denials found.","summary":"1-2 sentences from findings only.","fit_analysis":{"roster":"1 sentence","financial":"1 sentence","strategic":"1 sentence","market_factors":"1 sentence","gm_profile":"GM name, tendencies from search, modifier applied."},"reasoning":"2-3 sentences citing findings. Note caps applied.","qc_footer":"QC: Markets Y/N | Tiers Y/N | Dates Y/N | GM Y/N | Caps Y/N","tweet":"Under 240 chars. Punchy. Emoji. Player+teams. Verdict signal. #MLBRumors"}',
  ].join("\n");

  try {
    // ── PASS 1 ────────────────────────────────────────────────────────────────
    const searchUserMsg = [
      'Rumor: "' + rumor + '"',
      gptOutput?.trim() ? "\nPrior context (brief):\n" + gptOutput.substring(0, 500) : "",
      "\nRun the 3 searches now. Return your concise report.",
    ].join("");

    const searchRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: searchSystemPrompt,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: searchUserMsg }],
      }),
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      throw new Error("Search pass failed (" + searchRes.status + "): " + errText.substring(0, 300));
    }

    const searchData = await searchRes.json();
    if (searchData.error) throw new Error("Search pass error: " + (searchData.error.message || JSON.stringify(searchData.error)));

    const searchBlocks = (searchData.content || []).filter((b) => b.type === "text");
    if (searchBlocks.length === 0) throw new Error("Search pass returned no text. Stop reason: " + searchData.stop_reason);

    // Trim findings to 3000 chars max before passing to analysis
    const rawFindings = searchBlocks[searchBlocks.length - 1].text;
    const researchFindings = rawFindings.length > 3000 ? rawFindings.substring(0, 3000) + "\n[truncated for brevity]" : rawFindings;

    // ── PASS 2 ────────────────────────────────────────────────────────────────
    const analysisUserMsg = [
      'Rumor: "' + rumor + '"',
      "",
      "RESEARCH FINDINGS (" + today + "):",
      researchFindings,
      "",
      "Return the raw JSON verdict.",
    ].join("\n");

    const analysisRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: analysisSystemPrompt,
        messages: [{ role: "user", content: analysisUserMsg }],
      }),
    });

    if (!analysisRes.ok) {
      const errText = await analysisRes.text();
      throw new Error("Analysis pass failed (" + analysisRes.status + "): " + errText.substring(0, 300));
    }

    const analysisData = await analysisRes.json();
    if (analysisData.error) throw new Error("Analysis pass error: " + (analysisData.error.message || JSON.stringify(analysisData.error)));

    const analysisBlocks = (analysisData.content || []).filter((b) => b.type === "text");
    if (analysisBlocks.length === 0) throw new Error("Analysis pass returned no text. Stop reason: " + analysisData.stop_reason);

    const rawText = analysisBlocks[analysisBlocks.length - 1].text;

    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1) throw new Error("No JSON found in analysis response. Raw: " + rawText.substring(0, 200));

    const parsed = JSON.parse(cleaned.substring(first, last + 1));

    const verdictMap = {
      "PLAUSIBLE BUT UNCONFIRMED": "PLAUSIBLE",
      "PLAUSIBLE_BUT_UNCONFIRMED": "PLAUSIBLE",
      "WEAK/SPECULATIVE": "WEAK",
      "WEAK_SPECULATIVE": "WEAK",
    };
    if (verdictMap[parsed.verdict]) parsed.verdict = verdictMap[parsed.verdict];

    return res.status(200).json({ success: true, data: parsed });

  } catch (err) {
    console.error("BirdDog Express validate error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
