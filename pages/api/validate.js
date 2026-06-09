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

  // ── PROMPTS ───────────────────────────────────────────────────────────────

  const searchSystemPrompt = [
    "You are an MLB research assistant. Your ONLY job is to run web searches and return what you find.",
    "TODAY IS: " + today + ". Your training data is STALE — treat everything you think you know as potentially wrong.",
    "",
    "ABSOLUTE RULE: You have NO reliable knowledge about current MLB. Every single fact you state must come directly from a web search result you run right now. If you cannot find it via search, say so explicitly.",
    "",
    "Run ALL of these searches before responding (replace bracketed placeholders with actual names from the rumor):",
    "1. [player name] [team] trade rumors " + thisYear,
    "2. [player name] [team] MLB latest news " + thisYear,
    "3. [origin team] roster needs payroll " + thisYear,
    "4. [destination team] roster needs payroll " + thisYear,
    "5. [origin team GM name] trade deadline approach " + thisYear,
    "6. [destination team GM name] roster moves " + thisYear,
    "7. [player name] contract salary arbitration " + thisYear,
    "",
    "Return a plain text report with these exact sections:",
    "RUMOR SOURCES: Every article or post found. Byline, outlet, date, URL, exact language used.",
    "ORIGIN TEAM CONTEXT: What searches revealed about this team right now. Roster, needs, payroll, news.",
    "DESTINATION TEAM CONTEXT: Same for destination team.",
    "GM PROFILES: What searches revealed about each team GM. Recent quotes, transaction history.",
    "PLAYER CONTEXT: Contract status, performance, age — from search results only.",
    "GAPS: Anything you could NOT find via search. Do not guess or fill gaps from memory.",
    "",
    "Do NOT use any fact not found in a search result. If you find nothing for a section, write NOTHING FOUND.",
  ].join("\n");

  const analysisSystemPrompt = [
    "You are an expert MLB rumor analyst for BirdDog Express. Analyze ONLY the live research findings provided. Do not use your own knowledge.",
    "",
    "TODAY IS: " + today,
    "",
    "STRICT RULES:",
    "- Analyze ONLY the search findings provided. Do not supplement with your own knowledge.",
    "- If a finding is missing (NOTHING FOUND), apply the appropriate confidence cap and state it.",
    "- Do not invent trade packages, contract figures, or player valuations.",
    "- Every claim in your JSON must trace back to the provided research findings.",
    "",
    "CLASSIFICATION:",
    "- CORROBORATED: 1+ credible outlet in each market OR multiple independent Tier-1s confirm.",
    "- PLAUSIBLE: One market or national mentions; logic consistent with findings.",
    "- WEAK: Aggregators or low-threshold social only.",
    "- REFUTED: Credible denial or contradiction found.",
    "- UNVERIFIED: Cannot determine from provided findings.",
    "",
    "CONFIDENCE CAPS (enforce strictly):",
    "- Both markets corroborate: credibility_score >= 80",
    "- One market or national only: credibility_score 50-65",
    "- No credible market coverage but plausible: credibility_score <= 40",
    "- Explicit denial or only low-cred chatter: credibility_score <= 25",
    "",
    "GM ALIGNMENT MODIFIER: +10 if rumor matches GM behavior found in research; 0 if neutral; -10 if contradicts.",
    "SCORING: overall_likelihood = (credibility_score * 0.6) + (fit_score * 0.4)",
    "",
    "Return ONLY raw JSON — no markdown, no backticks, no preamble:",
    "{",
    '  "verdict": "CORROBORATED" or "PLAUSIBLE" or "WEAK" or "REFUTED" or "UNVERIFIED",',
    '  "credibility_score": number 0-100,',
    '  "fit_score": number 0-100,',
    '  "overall_likelihood": number 0-100,',
    '  "sources_found": ["Byline - Outlet - Date - URL if available"],',
    '  "origin_market": "What research found, or: No credible coverage found; confidence capped.",',
    '  "destination_market": "What research found, or: No credible coverage found; confidence capped.",',
    '  "national": "National coverage or denials found in research.",',
    '  "summary": "1-2 sentence factual summary based only on search findings.",',
    '  "fit_analysis": {',
    '    "roster": "Based on search findings only.",',
    '    "financial": "Based on search findings only.",',
    '    "strategic": "Based on search findings only.",',
    '    "market_factors": "Based on search findings only.",',
    '    "gm_profile": "GM name, what research revealed, alignment modifier applied."',
    "  },",
    '  "reasoning": "2-3 sentences. Cite only what was found in research. State any confidence caps applied.",',
    '  "qc_footer": "QC: Markets covered Y/N | Source tiers checked Y/N | Dates verified Y/N | GM tendencies from search Y/N | Confidence caps Y/N",',
    '  "tweet": "Under 240 chars. Punchy. Relevant emoji, player, teams, verdict signal. End with #MLBRumors."',
    "}",
  ].join("\n");

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  try {
    // ── PASS 1: Search pass ────────────────────────────────────────────────
    const searchUserMsg = [
      'MLB rumor to research: "' + rumor + '"',
      gptOutput?.trim() ? "\nPrior analysis context:\n" + gptOutput : "",
      "\n\nToday is " + today + ". Run ALL searches now, substituting actual player/team names from the rumor above.",
      "Return your full structured report: RUMOR SOURCES / ORIGIN TEAM CONTEXT / DESTINATION TEAM CONTEXT / GM PROFILES / PLAYER CONTEXT / GAPS.",
    ].join("\n");

    const searchRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
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
    const researchFindings = searchBlocks[searchBlocks.length - 1].text;

    // ── PASS 2: Analysis pass ──────────────────────────────────────────────
    const analysisUserMsg = [
      'Original rumor: "' + rumor + '"',
      "",
      "LIVE RESEARCH FINDINGS (gathered via web search, " + today + "):",
      researchFindings,
      "",
      "Analyze ONLY the above findings. Do not supplement with your own knowledge. Return the raw JSON verdict.",
    ].join("\n");

    const analysisRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
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

    // Extract JSON from response
    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1) throw new Error("No JSON found in analysis response. Raw: " + rawText.substring(0, 200));

    const parsed = JSON.parse(cleaned.substring(first, last + 1));

    // Normalize verdict
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
