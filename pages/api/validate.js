// pages/api/validate.js
// Streaming validate — Pass 1 + MLB Stats run in parallel, Pass 2 streams tokens

export const config = {
  api: { responseLimit: false },
};

// ── User-facing error messages — never expose raw API errors publicly ─────────
function userFacingError(status, rawMessage) {
  if (status === 429) return { code: "RATE_LIMIT",   message: "High demand right now — please try again in 30 seconds." };
  if (status === 401) return { code: "AUTH",         message: "Service configuration error. Please try again later." };
  if (status === 529) return { code: "OVERLOADED",   message: "Our analysis service is temporarily busy. Please try again in a moment." };
  if (status >= 500)  return { code: "SERVER_ERROR", message: "Something went wrong on our end. Please try again." };
  if (rawMessage?.toLowerCase().includes("timeout")) return { code: "TIMEOUT", message: "This is taking longer than expected. Please try again." };
  if (rawMessage?.toLowerCase().includes("no text")) return { code: "EMPTY",   message: "We couldn't analyze that rumor. Try rephrasing it." };
  return { code: "UNKNOWN", message: "Something went wrong. Please try again." };
}

// ── Retry wrapper — one retry on 429 with 15s backoff ────────────────────────
async function fetchWithRetry(url, options, retries = 1, delayMs = 15000) {
  const res = await fetch(url, options);
  if (res.status === 429 && retries > 0) {
    await new Promise(r => setTimeout(r, delayMs));
    return fetchWithRetry(url, options, retries - 1, delayMs);
  }
  return res;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { rumor } = req.body;

  if (!rumor?.trim()) {
    return res.status(400).json({ error: "Please enter a valid MLB rumor to validate." });
  }

  if (rumor.trim().length > 255) {
    return res.status(400).json({ error: "Rumor must be 255 characters or less." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Service configuration error. Please try again later." });
  }

  const today    = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const thisYear = new Date().getFullYear();

  const anthropicHeaders = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  // ── SSE setup ──────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  // ── PASS 1 system prompt ───────────────────────────────────────────────────
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
    "TEAM CONTEXT: Brief notes on both teams — roster need, payroll posture, GM name.",
    "PLAYER CONTEXT: Contract status, age, performance — from search only.",
    "SENTIMENT: Estimate whether chatter is reporter-driven or fan-driven. Note volume and source quality.",
    "GAPS: What you could not find. Write NOTHING FOUND if a section is empty.",
    "",
    "Be brief. Do not pad. Stop at 800 words.",
  ].join("\n");

  // ── PASS 2 system prompt ───────────────────────────────────────────────────
  const analysisSystemPrompt = [
    "You are an MLB rumor analyst for BirdDog Express. Analyze ONLY the research findings provided.",
    "TODAY IS: " + today,
    "",
    "VOICE AND TONE:",
    "Write like a trusted baseball insider giving a quick verdict to a fan who just saw a rumor on X.",
    "Lead with the finding — don't wind up, just say it.",
    "Cite the signal by name — say 'no beat reporter has picked this up' not 'credibility is low'.",
    "Sound like Passan writing, Olney sourcing, Ripken talking.",
    "Short sentences. Active voice. No padding.",
    "Never use: 'it is worth noting', 'this indicates', 'demonstrates', 'aforementioned', 'it should be noted', 'analysis suggests'.",
    "Grade 9-10 reading level. Baseball-smart but not academic.",
    "Summary: max 2 sentences. Reasoning: max 3 sentences.",
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
    "GM MODIFIER: Review the GM name found in TEAM CONTEXT.",
    "Research their known tendencies: FA appetite, trade style, prospect value.",
    "+10 if this rumor matches their known behavior.",
    "0 if neutral or unknown.",
    "-10 if this rumor contradicts their known behavior.",
    "State the GM name, their tendencies, and modifier applied in gm_profile.",
    "",
    "SCORING: overall = (credibility * 0.6) + (fit * 0.4)",
    "",
    "SENTIMENT RULE:",
    "High sentiment + low sources = FAN_DRIVEN. Discount sentiment from overall score.",
    "High sentiment + high sources = CORROBORATED.",
    "Low sentiment + high sources = REPORTER_LED.",
    "Low sentiment + low sources = NOISE.",
    "",
    "RUMOR CLASSIFICATION (pick one): REPORTER_LED | CORROBORATED | FAN_DRIVEN | NOISE",
    "",
    "Return ONLY raw JSON, no markdown, no backticks:",
    '{"verdict":"CORROBORATED|PLAUSIBLE|WEAK|REFUTED|UNVERIFIED","rumor_classification":"REPORTER_LED|CORROBORATED|FAN_DRIVEN|NOISE","sentiment_discounted":true,"credibility_score":0,"fit_score":0,"sentiment_score":0,"overall_likelihood":0,"sources_found":["Byline - Outlet - Date"],"origin_market":"finding or: No credible coverage found.","destination_market":"finding or: No credible coverage found.","national":"national coverage or denials found.","cross_market":{"national_media":{"status":"PARTIAL|CONFIRMED|SILENT","reporters_count":0,"of_total":3},"origin_beat":{"status":"CONFIRMED|SILENT","outlet":""},"destination_beat":{"status":"CONFIRMED|SILENT","outlet":""}},"summary":"2 sentences max. Lead with the verdict. Cite the signal by name.","fit_analysis":{"roster":"1 sentence","financial":"1 sentence","strategic":"1 sentence","gm_profile":"GM name, known tendencies, modifier applied."},"reasoning":"3 sentences max. Say what the sources did or did not do. Be direct.","qc_footer":"QC: Markets Y/N | Tiers Y/N | Dates Y/N | GM Y/N | Caps Y/N"}',
  ].join("\n");

  try {
    send("status", { message: "Scanning sources..." });

    const searchUserMsg = `Rumor: "${rumor}"\n\nRun the 3 searches now. Return your concise report.`;

    // ── PARALLEL: Pass 1 + MLB standings ──────────────────────────────────────
    const [searchRes, standingsRes] = await Promise.all([
      fetchWithRetry("https://api.anthropic.com/v1/messages", {
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
      fetch(`https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${thisYear}&standingsTypes=regularSeason`)
        .then(r => r.json())
        .catch(() => null),
    ]);

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      console.error("BirdDog Pass 1 error:", searchRes.status, errText.substring(0, 500));
      const { message } = userFacingError(searchRes.status, errText);
      send("error", { success: false, error: message });
      return res.end();
    }

    const searchData = await searchRes.json();
    if (searchData.error) {
      console.error("BirdDog Pass 1 API error:", JSON.stringify(searchData.error));
      const { message } = userFacingError(0, searchData.error.message);
      send("error", { success: false, error: message });
      return res.end();
    }

    const searchBlocks = (searchData.content || []).filter(b => b.type === "text");
    if (searchBlocks.length === 0) {
      console.error("BirdDog Pass 1 no text. Stop reason:", searchData.stop_reason);
      const { message } = userFacingError(0, "no text");
      send("error", { success: false, error: message });
      return res.end();
    }

    const rawFindings    = searchBlocks[searchBlocks.length - 1].text;
    const researchFindings = rawFindings.length > 3000
      ? rawFindings.substring(0, 3000) + "\n[truncated]"
      : rawFindings;

    send("status", { message: "Sources scanned. Analyzing..." });

    // ── PASS 2: Streaming analysis ─────────────────────────────────────────────
    const analysisUserMsg = [
      `Rumor: "${rumor}"`,
      "",
      `RESEARCH FINDINGS (${today}):`,
      researchFindings,
      "",
      standingsRes ? "MLB STANDINGS DATA: Available (use for fit analysis)." : "",
      "",
      "Return the raw JSON verdict.",
    ].join("\n");

    const streamRes = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { ...anthropicHeaders, "anthropic-beta": "messages-2023-12-15" },
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
      console.error("BirdDog Pass 2 error:", streamRes.status, errText.substring(0, 500));
      const { message } = userFacingError(streamRes.status, errText);
      send("error", { success: false, error: message });
      return res.end();
    }

    // ── Stream tokens ──────────────────────────────────────────────────────────
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
            send("token", { text: event.delta.text });
          }
        } catch (_) {}
      }
    }

    // ── Parse final JSON ───────────────────────────────────────────────────────
    const cleaned = fullText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const first   = cleaned.indexOf("{");
    const last    = cleaned.lastIndexOf("}");

    if (first === -1 || last === -1) {
      console.error("BirdDog no JSON in response. Raw:", fullText.substring(0, 300));
      const { message } = userFacingError(0, "no text");
      send("error", { success: false, error: message });
      return res.end();
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned.substring(first, last + 1));
    } catch (jsonErr) {
      console.error("BirdDog JSON parse error:", jsonErr.message, "Raw:", cleaned.substring(0, 300));
      send("error", { success: false, error: "We couldn't analyze that rumor. Try rephrasing it." });
      return res.end();
    }

    // Normalize legacy verdict strings
    const verdictMap = {
      "PLAUSIBLE BUT UNCONFIRMED": "PLAUSIBLE",
      "PLAUSIBLE_BUT_UNCONFIRMED": "PLAUSIBLE",
      "WEAK/SPECULATIVE": "WEAK",
      "WEAK_SPECULATIVE":  "WEAK",
    };
    if (verdictMap[parsed.verdict]) parsed.verdict = verdictMap[parsed.verdict];

    send("result", { success: true, data: parsed, standings: standingsRes });
    res.write("event: done\ndata: {}\n\n");
    res.end();

  } catch (err) {
    console.error("BirdDog unhandled error:", err.message);
    const { message } = userFacingError(0, err.message);
    try { send("error", { success: false, error: message }); } catch (_) {}
    res.end();
  }
}
