// pages/api/validate.js
// Streaming validate — Pass 1 + MLB Stats run in parallel, Pass 2 streams tokens

export const config = {
  api: { responseLimit: false },
};

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
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const thisYear = new Date().getFullYear();

  const anthropicHeaders = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  // ── SSE setup — stream events to the frontend ─────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ── PASS 1 system prompt ──────────────────────────────────────────────────
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
    "SENTIMENT: Estimate whether chatter is reporter-driven or fan-driven. Note volume and source quality.",
    "GAPS: What you could not find. Write NOTHING FOUND if a section is empty.",
    "",
    "Be brief. Do not pad. Stop at 800 words.",
  ].join("\n");

  // ── PASS 2 system prompt ──────────────────────────────────────────────────
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
    "SENTIMENT RULE: If social sentiment is high but source credibility is low,",
    "classify as FAN_DRIVEN. Discount sentiment from overall score.",
    "High sentiment + high sources = CORROBORATED (sentiment is corroborating).",
    "Low sentiment + high sources = reporter-led early rumor (normal scoring).",
    "Low sentiment + low sources = NOISE.",
    "",
    "RUMOR CLASSIFICATION (pick one): REPORTER_LED | CORROBORATED | FAN_DRIVEN | NOISE",
    "",
    "Return ONLY raw JSON, no markdown, no backticks:",
    '{"verdict":"CORROBORATED|PLAUSIBLE|WEAK|REFUTED|UNVERIFIED","rumor_classification":"REPORTER_LED|CORROBORATED|FAN_DRIVEN|NOISE","sentiment_discounted":true,"credibility_score":0,"fit_score":0,"sentiment_score":0,"overall_likelihood":0,"sources_found":["Byline - Outlet - Date"],"origin_market":"finding or: No credible coverage found.","destination_market":"finding or: No credible coverage found.","national":"national coverage or denials found.","cross_market":{"national_media":{"status":"PARTIAL|CONFIRMED|SILENT","reporters_count":0,"of_total":3},"origin_beat":{"status":"CONFIRMED|SILENT","outlet":""},"destination_beat":{"status":"CONFIRMED|SILENT","outlet":""}},"summary":"1-2 sentences from findings only.","fit_analysis":{"roster":"1 sentence","financial":"1 sentence","strategic":"1 sentence","gm_profile":"GM name, tendencies, modifier applied."},"reasoning":"2-3 sentences citing findings. Note caps applied.","qc_footer":"QC: Markets Y/N | Tiers Y/N | Dates Y/N | GM Y/N | Caps Y/N","tweet":"Under 240 chars. Punchy. Emoji. Player+teams. Verdict signal. #MLBRumors"}',
  ].join("\n");

  try {
    // ── PARALLEL: Pass 1 web search + MLB standings ───────────────────────────
    send("status", { message: "Scanning sources..." });

    const searchUserMsg = [
      'Rumor: "' + rumor + '"',
      gptOutput?.trim() ? "\nPrior context (brief):\n" + gptOutput.substring(0, 500) : "",
      "\nRun the 3 searches now. Return your concise report.",
    ].join("");

    const [searchRes, standingsRes] = await Promise.all([
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          system: searchSystemPrompt,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          tool_choice: { type: "any" },
          messages: [{ role: "user", content: searchUserMsg }],
        }),
      }),
      fetch("https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=" + thisYear + "&standingsTypes=regularSeason")
        .then(r => r.json())
        .catch(() => null),
    ]);

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      throw new Error("Search pass failed (" + searchRes.status + "): " + errText.substring(0, 300));
    }

    const searchData = await searchRes.json();
    if (searchData.error) throw new Error("Search pass error: " + (searchData.error.message || JSON.stringify(searchData.error)));

    const searchBlocks = (searchData.content || []).filter((b) => b.type === "text");
    if (searchBlocks.length === 0) throw new Error("Search pass returned no text. Stop reason: " + searchData.stop_reason);

    const rawFindings = searchBlocks[searchBlocks.length - 1].text;
    const researchFindings = rawFindings.length > 3000
      ? rawFindings.substring(0, 3000) + "\n[truncated for brevity]"
      : rawFindings;

    // Send Pass 1 complete signal so UI can show partial state
    send("status", { message: "Sources scanned. Analyzing..." });

    // ── PASS 2: Streaming analysis ────────────────────────────────────────────
    const analysisUserMsg = [
      'Rumor: "' + rumor + '"',
      "",
      "RESEARCH FINDINGS (" + today + "):",
      researchFindings,
      "",
      standingsRes ? "MLB STANDINGS DATA: Available (use for fit analysis)." : "",
      "",
      "Return the raw JSON verdict.",
    ].join("\n");

    const streamRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        ...anthropicHeaders,
        "anthropic-beta": "messages-2023-12-15",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: analysisSystemPrompt,
        stream: true,
        messages: [{ role: "user", content: analysisUserMsg }],
      }),
    });

    if (!streamRes.ok) {
      const errText = await streamRes.text();
      throw new Error("Analysis pass failed (" + streamRes.status + "): " + errText.substring(0, 300));
    }

    // Stream tokens to client as they arrive
    let fullText = "";
    const decoder = new TextDecoder();

    for await (const chunk of streamRes.body) {
      const lines = decoder.decode(chunk).split("\n").filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            fullText += event.delta.text;
            // Stream each token to the frontend
            send("token", { text: event.delta.text });
          }
        } catch (_) {}
      }
    }

    // Parse the completed JSON
    const cleaned = fullText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1) throw new Error("No JSON found in analysis response.");

    const parsed = JSON.parse(cleaned.substring(first, last + 1));

    // Normalize legacy verdict strings
    const verdictMap = {
      "PLAUSIBLE BUT UNCONFIRMED": "PLAUSIBLE",
      "PLAUSIBLE_BUT_UNCONFIRMED": "PLAUSIBLE",
      "WEAK/SPECULATIVE": "WEAK",
      "WEAK_SPECULATIVE": "WEAK",
    };
    if (verdictMap[parsed.verdict]) parsed.verdict = verdictMap[parsed.verdict];

    // Send final parsed result
    send("result", { success: true, data: parsed, standings: standingsRes });
    res.write("event: done\ndata: {}\n\n");
    res.end();

  } catch (err) {
    console.error("BirdDog Express validate error:", err.message);
    send("error", { success: false, error: err.message });
    res.end();
  }
}
