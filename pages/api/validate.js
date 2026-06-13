// pages/api/validate.js
// Streaming validate — Pass 1 + MLB Stats run in parallel, Pass 2 streams tokens
// Prompt caching enabled on both passes for performance

import gmProfiles from "../../gm-profiles.json";

export const config = {
  api: { responseLimit: false },
};

// ── GM profile lookup — matches team names found in rumor/findings to profiles ─
function getGmProfiles(rumor, findings) {
  const text = (rumor + " " + findings).toLowerCase();
  const matched = gmProfiles.teams.filter(team => {
    const teamLower = team.team.toLowerCase();
    // Match full team name or city name
    const city = teamLower.split(" ").slice(0, -1).join(" "); // e.g. "new york" from "new york yankees"
    const nickname = teamLower.split(" ").pop(); // e.g. "yankees"
    return text.includes(teamLower) || text.includes(nickname) || (city.length > 3 && text.includes(city));
  });
  // Cap at 3 teams to avoid token bloat
  return matched.slice(0, 3);
}

// ── Format GM profile for injection into Pass 2 user message ─────────────────
function formatGmProfile(profile) {
  const dms = profile.decision_makers.map(d => `${d.name} (${d.title})`).join(", ");
  const patterns = profile.known_patterns.slice(0, 3).join("; ");
  return [
    `Team: ${profile.team}`,
    `Decision makers: ${dms}`,
    `Current mode: ${profile.current_mode}`,
    `Trade style: ${profile.trade_style}`,
    `Prospect protection: ${profile.prospect_protection}`,
    `Known patterns: ${patterns}`,
    `Recent shifts: ${profile.recent_shifts}`,
    `Fits: ${profile.default_modifier.fits}`,
    `Contradicts: ${profile.default_modifier.contradicts}`,
  ].join("\n");
}

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
        "4. [player name] position MLB trade interest [current year] — find which teams have a confirmed need at this player's primary position, who currently starts there, and any reported interest past or present",
        "",
        "Return a SHORT report — max 900 words total — with these sections:",
        "RUMOR SOURCES: Prioritize articles from the last 60 days first. For older reporting, include only if it shows a team's interest that may still be unresolved. Byline, outlet, date, key quote (1 sentence max each).",
        "TEAM CONTEXT: Brief notes on both teams — roster need, payroll posture, GM name.",
        "PLAYER CONTEXT: Contract status, age, performance, primary position, any confirmed secondary positions — from search only.",
        "ROSTER LANDSCAPE: For the player's PRIMARY position — which teams have a confirmed current need? Who starts there now for likely suitor teams? Note any teams that showed past interest but haven't addressed the need since. Keep this section to 150 words max.",
        "SENTIMENT: Estimate whether chatter is reporter-driven or fan-driven. Note volume and source quality.",
        "GAPS: What you could not find. One line only.",
        "",
        "Be brief. Lead with recent. Stop at 900 words.",
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
        "You are the voice of BirdDog Express — an MLB rumor intelligence tool.",
        "Your job is to read research findings and deliver a verdict the way a trusted baseball insider would.",
        "",
        "YOUR VOICE:",
        "You sound like Jeff Passan writing a quick take, Buster Olney citing his sources, and Ryan Ripken explaining it to a fan.",
        "Lead with the finding. Say what the reporting shows — or doesn't show.",
        "Name the reporters. Name the outlets. Name the silence when that's the story.",
        "Short sentences. Present tense. No hedging phrases, no academic language.",
        "Never say: 'it is worth noting', 'this indicates', 'demonstrates', 'aforementioned', 'analysis suggests', 'cannot be confirmed', 'no data was returned', 'findings indicate', 'per the research'.",
        "Never describe what data is missing — just say what BirdDog found or didn't find.",
        "Never make definitive predictions. No 'will not happen', 'this won't go through', 'ruled out'. Trades surprise everyone. BirdDog reads signals — it doesn't call outcomes.",
        "Grade 9-10 reading level. Baseball-smart, not academic.",
        "",
        "WHAT YOU ARE ANALYZING:",
        "You will receive research findings from a web search pass. Those findings contain reporter names, outlet names, quotes, standings context, roster notes, and payroll information.",
        "Analyze ONLY what is in those findings. Do not invent details. Do not use your training data for current roster or contract information — it is outdated.",
        "If a section of the findings is empty or says nothing was found, reflect that naturally in your writing without mentioning the section name.",
        "",
        "WHEN FINDINGS ARE INCOMPLETE OR THE QUERY COMPARES TWO PLAYERS:",
        "If findings are truncated or insufficient to score, write naturally: 'BirdDog lost the scent mid-trail. One rumor at a time keeps BirdDog focused.' Set all scores to 0, verdict to UNVERIFIED, all fit fields to empty string, sources to empty array, suitors to empty array, darkhorse to null.",
        "If two players are explicitly being compared in the same query (e.g. 'Player A or Player B', 'Player A vs Player B'), same response.",
        "",
        "HOW TO SCORE:",
        "credibility_score: how strong is the sourcing? Use these caps —",
        "  Both team markets confirm: 80 or above",
        "  One market or national coverage only: 50-65",
        "  No credible reporter coverage: 40 or below",
        "  Only denials or low-credibility sources: 25 or below",
        "",
        "Reporter weight when scoring credibility:",
        "  Strongest (near-confirmation): Passan, Rosenthal, Olney, Feinsand, Sammon",
        "  Corroborating but not definitive: Nightengale, Morosi, Murray",
        "  Low weight — known for floating agent trial balloons: Heyman. Heyman alone = WEAK.",
        "  No weight — treat as noise: Bleacher Report, FanSided roundups, Reddit, ClutchPoints, SI FanNation",
        "  Two or more strongest reporters = CORROBORATED. One strongest alone = PLAUSIBLE.",
        "",
        "fit_score: how well does this player fit this team's roster, financial situation, and strategic direction?",
        "overall_likelihood: (credibility x 0.6) + (fit x 0.4)",
        "sentiment_score: how much fan buzz exists? High fan buzz with low reporter credibility = FAN_DRIVEN. Discount from overall score.",
        "",
        "VERDICT (pick one): CORROBORATED | PLAUSIBLE | WEAK | REFUTED | UNVERIFIED",
        "RUMOR CLASSIFICATION (pick one): REPORTER_LED | CORROBORATED | FAN_DRIVEN | NOISE",
        "",
        "GM MODIFIER:",
        "Find the GM name in the findings. Based on what the findings say about their CURRENT tendencies — not career history:",
        "A GM's approach can shift over time. Reflect their current operating style, not what they did five years ago.",
        "If the findings suggest their approach has changed, note the shift plainly.",
        "+10 if this move fits their current pattern. 0 if unknown or neutral. -10 if it contradicts their current pattern.",
        "In the gm_profile field: name the GM, describe their current tendencies in one plain sentence, note if their approach has shifted, and state what the modifier means in plain language — never use the word 'modifier'.",
        "If the GM name is not in the findings, leave the field empty. Do not guess.",
        "",
        "PLAYER FIT FIELDS — focus on the RUMORED DESTINATION only. Suitors are handled separately.",
        "roster: Does this player fill a real need on THIS team's roster? Name the position. Call out overlap with a current player if it exists. If no destination is named in the rumor, describe what type of team need this player fills — don't assess a specific team.",
        "financial: Can THIS team actually afford this player? Be honest about mismatches — if the numbers don't work, say so plainly. Don't just highlight positives.",
        "strategic: Does this move fit where THIS team is headed right now? Contention window, organizational direction, what they're building toward.",
        "gm_profile: As above — GM name, current operating style in one sentence, whether this move fits or departs from that style. Sound like an insider who follows this team closely.",
        "If you don't have enough from the findings to write a real sentence for any field, leave it as empty string. Never write 'no data found' or describe what's missing.",
        "",
        "POTENTIAL SUITORS:",
        "Use only what the findings say about current rosters and team needs. Do not use your training data for who plays where — it is outdated.",
        "Assess against the player's PRIMARY position first. Only consider a secondary position if the findings explicitly confirm the player has played it AND there's a reason the acquiring team would use them there.",
        "For each suitor, write one plain sentence: what's the need, can they pay, are they in a window to buy.",
        "Name one darkhorse — a team that isn't obvious but has a real case based on the findings.",
        "If the findings don't give enough roster context to name real suitors, return empty array and null darkhorse.",
        "",
        "sources_found: List each source as exactly 'Firstname Lastname - Outlet - Date' with no variation. If date is unknown use the year. Max 5 sources. Only include named reporters — no aggregators.",
        "",
        "cross_market: Always return this object — never null or missing. Use CONFIRMED if the market has clear reporting, PARTIAL if mentioned but not confirmed, SILENT if nothing found.",
        "For reporters_count and of_total in national_media — count only Tier 1 and Tier 2 reporters, not aggregators.",
        "For outlet in origin_beat and destination_beat — name the actual local outlet if found, otherwise write 'Local coverage'.",
        "",
        "POTENTIAL SUITORS — three tiers, keep it simple:",
        "Active: teams with current reporting or confirmed interest from the last 60 days.",
        "Returning: teams that showed past interest but never filled the need — flag as 'has shown past interest' in rationale.",
        "Dark horse: one team with no public connection but a logical case from the findings.",
        "Use only what the findings show. No training data for current rosters.",
        "Assess against primary position first. Secondary position only if findings confirm it.",
        "If findings don't support naming suitors, return empty array and null darkhorse.",
        "",
        "Return ONLY raw JSON, no markdown, no backticks:",
        '{"verdict":"CORROBORATED|PLAUSIBLE|WEAK|REFUTED|UNVERIFIED","rumor_classification":"REPORTER_LED|CORROBORATED|FAN_DRIVEN|NOISE","sentiment_discounted":true,"credibility_score":0,"fit_score":0,"sentiment_score":0,"overall_likelihood":0,"sources_found":["Byline - Outlet - Date"],"origin_market":"1 sentence from findings","destination_market":"1 sentence from findings","national":"1 sentence from findings","cross_market":{"national_media":{"status":"PARTIAL|CONFIRMED|SILENT","reporters_count":0,"of_total":3},"origin_beat":{"status":"CONFIRMED|SILENT","outlet":""},"destination_beat":{"status":"CONFIRMED|SILENT","outlet":""}},"summary":"2 sentences. Lead with the verdict. Sound like Passan.","fit_analysis":{"roster":"1 plain sentence or empty string","financial":"1 plain sentence or empty string","strategic":"1 plain sentence or empty string","gm_profile":"GM name, one-sentence tendency, modifier or empty string"},"reasoning":"3 sentences. Name the reporters. Sound like Olney.","potential_suitors":[{"team":"Team Name","rationale":"1 plain sentence"},{"team":"Team Name","rationale":"1 plain sentence"}],"darkhorse":{"team":"Team Name","rationale":"1 plain sentence"},"darkhorse_note":"only if suitors empty","qc_footer":"QC: Markets Y/N | Tiers Y/N | Dates Y/N | GM Y/N | Caps Y/N"}',
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

    const searchUserMsg = `Rumor: "${rumor}"\n\nRun the 4 searches now. Return your concise report.`;

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
    const researchFindings = rawFindings.length > 4000
      ? rawFindings.substring(0, 4000) + "\n[truncated for length]"
      : rawFindings;

    send("status", { message: "Sources scanned. Analyzing..." });

    // ── PASS 2: Streaming analysis ─────────────────────────────────────────────
    const matchedProfiles = getGmProfiles(rumor, researchFindings);
    const gmProfileSection = matchedProfiles.length > 0
      ? [
          "GM PROFILES FOR TEAMS INVOLVED:",
          ...matchedProfiles.map(p => formatGmProfile(p)),
          "Use these profiles to assess whether this move fits or contradicts each GM's current operating style. Do not use your training data for GM behavior — use only what is in these profiles.",
        ].join("\n")
      : "";

    const analysisUserMsg = [
      `Rumor: "${rumor}"`,
      "",
      `RESEARCH FINDINGS (${today}):`,
      researchFindings,
      "",
      gmProfileSection,
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
        max_tokens: 1500,
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
