// pages/api/validate.js
// Streaming validate — Pass 1 + MLB Stats run in parallel, Pass 2 streams tokens
// Prompt caching enabled on both passes for performance

export const config = {
  api: { responseLimit: false },
};

// ── User-facing error messages — never expose raw API errors publicly ─────────
function userFacingError(status, rawMessage) {
  if (status === 429) return { code: "RATE_LIMIT",   message: "The phone lines are jammed. Step away from the hot stove and try again in a bit." };
  if (status === 401) return { code: "AUTH",         message: "Locked out of the front office. Give us a minute." };
  if (status === 529) return { code: "OVERLOADED",   message: "Everyone's on a call with their agent. Check back in a moment." };
  if (status >= 500)  return { code: "SERVER_ERROR", message: "That one hit the foul pole. Try again." };
  if (rawMessage?.toLowerCase().includes("timeout")) return { code: "TIMEOUT", message: "The GM has us on hold still. Check back later." };
  if (rawMessage?.toLowerCase().includes("no text")) return { code: "EMPTY",   message: "Whiffed on that one. Try rephrasing the rumor." };
  return { code: "UNKNOWN", message: "Even Gold Glovers boot one sometimes. Try catching the next rumor." };
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
    return res.status(400).json({ error: "Can't get a hit if you don't step up to the plate." });
  }

  if (rumor.trim().length > 255) {
    return res.status(400).json({ error: "Working the count a little too hard. Keep it under 255 characters." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Locked out of the front office. Give us a minute." });
  }

  const today    = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const thisYear = new Date().getFullYear();

  // ── Headers — include prompt caching beta ─────────────────────────────────
  const anthropicHeaders = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "prompt-caching-2024-07-31",
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

  // ── PASS 1 system prompt — structured for caching ─────────────────────────
  // The static rules are marked cacheable. Today's date is appended as a
  // separate non-cached block so it doesn't bust the cache daily.
  const searchSystemPrompt = [
    {
      type: "text",
      text: [
        "You are an MLB research assistant. Run web searches and return only what you find. Be concise.",
        "Your training data is STALE. Every fact must come from a search result.",
        "",
        "Run exactly 4 searches:",
        "1. [player name] trade rumors [current year]",
        "2. [origin team] [destination team] trade [current year]",
        "3. [player name] contract salary [current year]",
        "4. [player name] primary position positional flexibility preference [current year] — find their primary position, any confirmed secondary positions, whether they have played multiple positions, and any public statements from the player or team about positional preference or flexibility",
        "",
        "Return a SHORT report — max 900 words total — with these sections:",
        "RUMOR SOURCES: Articles found. Byline, outlet, date, key quote (1 sentence max each).",
        "TEAM CONTEXT: Brief notes on both teams — roster need, payroll posture, GM name.",
        "PLAYER CONTEXT: Contract status, age, performance, primary position, any confirmed secondary positions — from search only.",
        "ROSTER LANDSCAPE: For the player's PRIMARY position, which teams have a confirmed need? Who currently starts at that position for likely suitor teams? Note any teams where the player would be asked to move to a secondary position. Use only what the search returns — do not guess.",
        "SENTIMENT: Estimate whether chatter is reporter-driven or fan-driven. Note volume and source quality.",
        "GAPS: What you could not find. Write NOTHING FOUND if a section is empty.",
        "",
        "Be brief. Do not pad. Stop at 900 words.",
      ].join("\n"),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: "TODAY IS: " + today + ". Use " + thisYear + " as the current year in all searches.",
    },
  ];

  // ── PASS 2 system prompt — structured for caching ─────────────────────────
  const analysisSystemPrompt = [
    {
      type: "text",
      text: [
        "You are an MLB rumor analyst for BirdDog Express. Analyze ONLY the research findings provided.",
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
        "NEVER make definitive statements about whether a trade will or will not happen. BirdDog measures likelihood and fit — it does not predict outcomes. Never use language like 'will not', 'is not being traded', 'this won't happen', 'ruled out.' Even when reporters say something is unlikely, trades happen. Instead use: 'no active framework has surfaced', 'signals point against it', 'nothing in the findings supports this yet', 'low likelihood based on current reporting.'",
        "",
        "RULES: Analyze only what is in the findings. No memory. No invented details.",
        "If a section says NOTHING FOUND, apply the confidence cap and note it.",
        "INCOMPLETE FINDINGS RULE: If the research findings are truncated, cut off, or too incomplete to score, do NOT fabricate numbers or issue a technical error. Instead set verdict to UNVERIFIED, all scores to 0, set summary to exactly: 'BirdDog lost the scent mid-trail. One rumor at a time keeps BirdDog focused.' and set reasoning to exactly: 'BirdDog lost the scent mid-trail. One rumor at a time keeps BirdDog focused.'",
        "COMPARATIVE QUERY RULE: ONLY applies when two or more player names are explicitly present in the same rumor AND are being directly compared against each other (e.g. 'Player A or Player B', 'Player A vs Player B', 'most likely between Player A and Player B'). A single player rumor with a question like 'is the market cooling?' is NOT comparative. When this rule applies: set verdict to UNVERIFIED, all scores to 0, set summary and reasoning to exactly: 'BirdDog lost the scent mid-trail. One rumor at a time keeps BirdDog focused.'",
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
        "REPORTER CREDIBILITY WEIGHTS:",
        "Tier 1 — strongest signal, treat as near-confirmation: Passan (ESPN), Rosenthal (The Athletic), Olney (ESPN), Feinsand (MLB.com), Sammon (The Athletic).",
        "Tier 2 — corroborating signal, meaningful but not definitive: Nightengale (USA Today), Morosi (MLB Network), Murray (FanSided).",
        "Tier 3 — rumor plant, low weight: Heyman (MLB Network). Fast but known for floating agent-driven trial balloons. A Heyman report alone does not confirm a rumor.",
        "Aggregators (Bleacher Report, FanSided roundups, Reddit): no credibility weight. Treat as noise.",
        "Two or more Tier 1 reporters = CORROBORATED. One Tier 1 alone = PLAUSIBLE. Heyman alone = WEAK.",
        "",
        "RUMOR CLASSIFICATION (pick one): REPORTER_LED | CORROBORATED | FAN_DRIVEN | NOISE",
        "",
        "POTENTIAL SUITORS:",
        "Use the ROSTER LANDSCAPE section from the research findings as your primary source for suitor identification.",
        "DO NOT use your training data for current roster information — it is stale and will be wrong.",
        "Only suggest teams whose current roster situation is confirmed by the research findings.",
        "POSITION RULES:",
        "— Assess suitors against the player's PRIMARY position first. That is the default need a team must have.",
        "— A player's secondary position is only relevant if: (a) the findings confirm they have played it, AND (b) the acquiring team has a confirmed plan or need to use them there.",
        "— Do NOT assume a team would move a player to a secondary position without evidence from the findings.",
        "— If a player has stated a positional preference, note it and factor it into fit.",
        "For each suitor evaluate based ONLY on what the findings show:",
        "1. ROSTER FIT — does the team have a confirmed need at the player's PRIMARY position? Flag positional overlap clearly.",
        "2. PAYROLL SPACE — can they absorb the contract based on known payroll posture in the findings?",
        "3. COMPETITIVE WINDOW — are they likely buyers based on standings or deadline context?",
        "4. GM TENDENCY — does this type of move fit their known approach per the findings?",
        "If no destination is named in the rumor, identify the most logical landing spots based on the player's primary position and which teams the findings show have a genuine need.",
        "Also identify ONE darkhorse — a non-obvious fit with a logical case supported by the findings.",
        "If the ROSTER LANDSCAPE section is NOTHING FOUND or insufficient, return an empty suitors array and explain in darkhorse_note.",
        "",
        "Return ONLY raw JSON, no markdown, no backticks:",
        '{"verdict":"CORROBORATED|PLAUSIBLE|WEAK|REFUTED|UNVERIFIED","rumor_classification":"REPORTER_LED|CORROBORATED|FAN_DRIVEN|NOISE","sentiment_discounted":true,"credibility_score":0,"fit_score":0,"sentiment_score":0,"overall_likelihood":0,"sources_found":["Byline - Outlet - Date"],"origin_market":"finding or: No credible coverage found.","destination_market":"finding or: No credible coverage found.","national":"national coverage or denials found.","cross_market":{"national_media":{"status":"PARTIAL|CONFIRMED|SILENT","reporters_count":0,"of_total":3},"origin_beat":{"status":"CONFIRMED|SILENT","outlet":""},"destination_beat":{"status":"CONFIRMED|SILENT","outlet":""}},"summary":"2 sentences max. Lead with the verdict. Cite the signal by name.","fit_analysis":{"roster":"1 sentence","financial":"1 sentence","strategic":"1 sentence","gm_profile":"GM name, known tendencies, modifier applied."},"reasoning":"3 sentences max. Say what the sources did or did not do. Be direct.","potential_suitors":[{"team":"Team Name","rationale":"1 sentence — roster need, payroll fit, competitive window"},{"team":"Team Name","rationale":"1 sentence"}],"darkhorse":{"team":"Team Name","rationale":"1 sentence — the non-obvious case"},"darkhorse_note":"Only populated if suitors array is empty — explain why","qc_footer":"QC: Markets Y/N | Tiers Y/N | Dates Y/N | GM Y/N | Caps Y/N"}',
      ].join("\n"),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: "TODAY IS: " + today,
    },
  ];

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
          max_tokens: 2500,
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

    const rawFindings = searchBlocks[searchBlocks.length - 1].text;
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
      headers: anthropicHeaders,
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
      send("error", { success: false, error: "Whiffed on that one. Try rephrasing the rumor." });
      return res.end();
    }

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
