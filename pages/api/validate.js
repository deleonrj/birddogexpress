// pages/api/validate.js
// Streaming validate — Pass 1 + MLB Stats run in parallel, Pass 2 streams tokens
// Prompt caching enabled on both passes for performance

import gmProfiles from "../../gm-profiles.json";

export const config = {
  api: { responseLimit: false },
};

// ── GM profile lookup — matches team names in rumor/findings to profiles ──────
function getGmProfiles(rumor, findings) {
  const text = (rumor + " " + findings).toLowerCase();
  const matched = gmProfiles.teams.filter(team => {
    const teamLower = team.team.toLowerCase();
    const parts = teamLower.split(" ");
    const nickname = parts[parts.length - 1];
    const city = parts.slice(0, -1).join(" ");
    return (
      text.includes(teamLower) ||
      (nickname.length > 3 && text.includes(nickname)) ||
      (city.length > 3 && text.includes(city))
    );
  });
  return matched.slice(0, 3);
}

// ── Extract player name from free-text rumor ──────────────────────────────────
// Looks for known patterns: "Is [Name]", "[Name] to the", "[Name] trade", etc.
// Returns best guess at player name or null if not found.
function extractPlayerName(rumor) {
  const text = rumor.trim();

  // Pattern 1: "Is [Firstname Lastname]" or "Will [Firstname Lastname]"
  const p1 = text.match(/^(?:is|will|could|would|should|can)\s+([A-Z][a-záéíóúñü]+(?:\s+[A-Z][a-záéíóúñü]+){1,2})/i);
  if (p1) return p1[1].trim();

  // Pattern 2: "[Name] to the [Team]" or "[Name] trade" or "[Name] available"
  const p2 = text.match(/^([A-Z][a-záéíóúñü]+(?:\s+[A-Z][a-záéíóúñü]+){1,2})\s+(?:to\s+the|trade|available|being|possibly|could|rumor|linked)/i);
  if (p2) return p2[1].trim();

  // Pattern 3: "about [Name]" or "for [Name]"
  const p3 = text.match(/(?:about|for|acquire|targeting|pursuing|interested\s+in)\s+([A-Z][a-záéíóúñü]+(?:\s+[A-Z][a-záéíóúñü]+){1,2})/i);
  if (p3) return p3[1].trim();

  // Pattern 4: Any capitalized two-word name sequence
  const p4 = text.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  if (p4) return p4[1].trim();

  return null;
}

// ── Fetch contract status from MLB Stats API ──────────────────────────────────
// Step 1: Name search → get player ID
// Step 2: Player details → get service time, arb status, contract years
// Returns structured contract status string or null on failure
async function fetchContractStatus(playerName) {
  if (!playerName) return null;
  try {
    // Step 1: Search for player by name
    const searchUrl = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(playerName)}&sportIds=1`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();

    const people = searchData?.people;
    if (!people?.length) return null;

    // Pick the active player with the closest name match
    const player = people.find(p => p.active) || people[0];
    const playerId = player?.id;
    if (!playerId) return null;

    // Step 2: Get player details with service time and contract info
    const detailUrl = `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=currentContract,stats(type=career,sportId=1)`;
    const detailRes = await fetch(detailUrl);
    if (!detailRes.ok) return null;
    const detailData = await detailRes.json();

    const person = detailData?.people?.[0];
    if (!person) return null;

    // Extract service time
    const serviceTime = person.mlbDebutDate
      ? Math.floor((new Date() - new Date(person.mlbDebutDate)) / (365.25 * 24 * 60 * 60 * 1000))
      : null;

    // Extract contract details
    const contract = person.currentContract;
    const contractEnd = contract?.endDate ? new Date(contract.endDate).getFullYear() : null;
    const currentYear = new Date().getFullYear();

    // Determine arb status from service time
    // MLB arb rules: eligible after 3 years service (or Super Two: top 22% between 2-3 years)
    let arbStatus = null;
    if (serviceTime !== null) {
      if (serviceTime < 3) arbStatus = "pre-arb";
      else if (serviceTime < 6) {
        const arbYear = Math.min(Math.floor(serviceTime) - 2, 3);
        arbStatus = `arb year ${arbYear} of 3`;
      }
    }

    // Build contract status string
    if (contractEnd) {
      const yearsRemaining = contractEnd - currentYear;
      if (yearsRemaining <= 0) {
        return `RENTAL — contract expires after ${currentYear} season`;
      } else if (yearsRemaining === 1) {
        return `CONTROLLABLE — 1 year remaining on contract (through ${contractEnd})${arbStatus ? `, ${arbStatus}` : ""}`;
      } else {
        return `CONTROLLABLE — ${yearsRemaining} years remaining on contract (through ${contractEnd})${arbStatus ? `, ${arbStatus}` : ""}`;
      }
    }

    // No contract end date — use service time to infer
    if (arbStatus) {
      return `CONTROLLABLE — ${arbStatus} (service time: ~${serviceTime} years)`;
    }

    return null;
  } catch (err) {
    console.error("BirdDog contract lookup error:", err.message);
    return null;
  }
}

// ── Format contract status for Pass 2 injection ───────────────────────────────
function formatContractSection(playerName, contractStatus) {
  if (!contractStatus) return "";
  return [
    "PLAYER CONTRACT STATUS (from MLB Stats API — authoritative, not training data):",
    `Player: ${playerName}`,
    `Status: ${contractStatus}`,
    "Use this classification in the financial field. Do not reclassify based on training data or web search findings.",
  ].join("\n");
}
// Accepts the raw MLB Stats API standingsRes response.
// Returns { "Baltimore Orioles": { wins, losses, divisionRank, gamesBack, division } }
function buildStandingsLookup(standingsRes) {
  const lookup = {};
  if (!standingsRes?.records) return lookup;
  for (const divRecord of standingsRes.records) {
    const division = divRecord.division?.name || "";
    for (const tr of divRecord.teamRecords || []) {
      const name = tr.team?.name;
      if (!name) continue;
      lookup[name] = {
        wins: tr.wins,
        losses: tr.losses,
        divisionRank: tr.divisionRank,
        gamesBack: tr.gamesBack === "-" ? "0" : (tr.gamesBack || "0"),
        division,
      };
    }
  }
  return lookup;
}

// ── Format GM profile with live record injected at runtime ────────────────────
// liveRecord comes from buildStandingsLookup — never stored in gm-profiles.json
function formatGmProfile(profile, liveRecord) {
  const dms = profile.decision_makers.map(d => `${d.name} (${d.title})`).join(", ");
  const patterns = profile.known_patterns.slice(0, 3).join("; ");

  // Live record line — only from API, never from profile JSON
  const recordLine = liveRecord
    ? `Current record (LIVE): ${liveRecord.wins}-${liveRecord.losses}, ` +
      `${liveRecord.divisionRank === "1" ? "1st" : liveRecord.divisionRank === "2" ? "2nd" : liveRecord.divisionRank === "3" ? "3rd" : liveRecord.divisionRank + "th"} in ${liveRecord.division}` +
      (parseFloat(liveRecord.gamesBack) > 0 ? `, ${liveRecord.gamesBack} GB` : ", division leader")
    : "Current record: not available";

  return [
    `Team: ${profile.team}`,
    recordLine,
    `Decision makers: ${dms}`,
    `Operating mode: ${profile.current_mode}`,
    `Trade style: ${profile.trade_style}`,
    `Prospect protection: ${profile.prospect_protection}`,
    `Known patterns: ${patterns}`,
    `Recent shifts: ${profile.recent_shifts}`,
    `Fits this GM: ${profile.default_modifier.fits}`,
    `Contradicts this GM: ${profile.default_modifier.contradicts}`,
  ].join("\n");
}

// ── Build full standings summary for Pass 2 — all 30 teams, live records ──────
// This replaces the vague "MLB STANDINGS DATA: Available" flag so Pass 2 never
// falls back to training data for any team record.
function buildStandingsSummary(standingsRes) {
  if (!standingsRes?.records) return "";
  const lines = ["LIVE MLB STANDINGS (from MLB Stats API — use these records, never your training data):"];
  for (const divRecord of standingsRes.records) {
    const division = divRecord.division?.name || "";
    lines.push(`\n${division}:`);
    for (const tr of divRecord.teamRecords || []) {
      const name = tr.team?.name || "";
      const wins = tr.wins;
      const losses = tr.losses;
      const rank = tr.divisionRank;
      const gb = tr.gamesBack === "-" ? "—" : tr.gamesBack;
      lines.push(`  ${name}: ${wins}-${losses}, ${rank}${rank === "1" ? "st" : rank === "2" ? "nd" : rank === "3" ? "rd" : "th"} (${gb} GB)`);
    }
  }
  return lines.join("\n");
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
        "PLAYER CONTEXT: From search results only — do not use training data.",
        "  CONTRACT EXTENSION CONTEXT: Search for any reports of extension talks, player preference to stay or leave, or team interest in extending the player. This is the ONLY contract information Pass 1 needs to find — contract structure (years remaining, arb status) comes from a separate live API source.",
        "  If extension talks are active or likely, note it explicitly: EXTENSION CONTEXT: [what you found].",
        "  If no extension context found, write EXTENSION CONTEXT: None reported.",
        "  Age, performance, primary position, any confirmed secondary positions.",
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
        "A GM profile for the teams involved is provided below in the user message under GM PROFILES FOR TEAMS INVOLVED. Use that profile — do not search the findings for GM tendencies and do not use your training data.",
        "If no profile is provided for a team, leave the gm_profile field as empty string.",
        "+10 if this move fits their current pattern. 0 if unknown or neutral. -10 if it contradicts their current pattern.",
        "In the gm_profile field: name the GM, describe their current tendencies in one plain sentence, and state in plain language whether this move fits or contradicts their pattern. Never use the word 'modifier'.",
        "",
        "PLAYER FIT FIELDS — focus on the RUMORED DESTINATION only. Suitors are handled separately.",
        "roster: Does this player fill a real need on THIS team's roster? Name the position. Call out overlap with a current player if it exists. If no destination is named in the rumor, describe what type of team need this player fills — don't assess a specific team.",
        "financial: The player's contract status is provided above in PLAYER CONTRACT STATUS — use that classification exactly, do not reclassify from training data or web search. State it plainly: 'Ward is a rental' or 'Skubal is controllable with 2 years remaining'. If extension context was found in research findings, upgrade RENTAL to EXTENSION CANDIDATE and explain. Then assess whether THIS team can afford the player. A rental costs fewer prospects than a controllable player. If no contract status was injected, leave this field empty.",
        "strategic: Does this move fit where THIS team is headed right now? Factor in the contract type — a rental is a one-postseason bet, a controllable player is a franchise asset, an extension candidate is both. State which one this is and whether it fits the team's window.",
        "gm_profile: Use the injected GM profile — name the GM, their current operating style in one sentence, whether this move fits or contradicts that style.",
        "If you don't have enough from the findings to write a real sentence for any field, leave it as empty string. Never write 'no data found' or describe what's missing.",
        "",
        "POTENTIAL SUITORS — three tiers, keep it simple:",
        "Active: teams with current reporting or confirmed interest from the last 60 days.",
        "Returning: teams that showed past interest but never filled the need — flag as 'has shown past interest' in rationale.",
        "Dark horse: one team with no public connection but a logical case from the findings.",
        "Use only what the findings show. No training data for current rosters.",
        "Assess against primary position first. Secondary position only if findings confirm it.",
        "If findings don't support naming suitors, return empty array and null darkhorse.",
        "",
        "sources_found: List each source as exactly 'Firstname Lastname - Outlet - Date' with no variation. If date is unknown use the year. Max 5 sources. Only include named reporters — no aggregators.",
        "",
        "cross_market: Always return this object — never null or missing. Use CONFIRMED if the market has clear reporting, PARTIAL if mentioned but not confirmed, SILENT if nothing found.",
        "For reporters_count and of_total in national_media — count only Tier 1 and Tier 2 reporters, not aggregators.",
        "For outlet in origin_beat and destination_beat — name the actual local outlet if found, otherwise write 'Local coverage'.",
        "",
        "Return ONLY raw JSON, no markdown, no backticks:",
        '{"verdict":"CORROBORATED|PLAUSIBLE|WEAK|REFUTED|UNVERIFIED","rumor_classification":"REPORTER_LED|CORROBORATED|FAN_DRIVEN|NOISE","sentiment_discounted":true,"credibility_score":0,"fit_score":0,"sentiment_score":0,"overall_likelihood":0,"sources_found":["Firstname Lastname - Outlet - Date"],"origin_market":"1 sentence from findings","destination_market":"1 sentence from findings","national":"1 sentence from findings","cross_market":{"national_media":{"status":"PARTIAL|CONFIRMED|SILENT","reporters_count":0,"of_total":3},"origin_beat":{"status":"CONFIRMED|SILENT","outlet":""},"destination_beat":{"status":"CONFIRMED|SILENT","outlet":""}},"summary":"2 sentences. Lead with the verdict. Sound like Passan.","fit_analysis":{"roster":"1 plain sentence or empty string","financial":"State contract classification from injected API data, then affordability. Upgrade to extension candidate if extension context found. 1 plain sentence or empty string.","strategic":"1 plain sentence factoring contract type or empty string","gm_profile":"GM name, current style, fits or contradicts — or empty string"},"reasoning":"3 sentences. Name the reporters. Sound like Olney.","potential_suitors":[{"team":"Team Name","rationale":"1 plain sentence"},{"team":"Team Name","rationale":"1 plain sentence"}],"darkhorse":{"team":"Team Name","rationale":"1 plain sentence"},"darkhorse_note":"only if suitors empty"}',
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

    // ── Extract player name for contract API lookup ────────────────────────────
    const playerName = extractPlayerName(rumor);

    // ── PARALLEL: Pass 1 + MLB standings + contract status ────────────────────
    const [searchRes, standingsRes, contractStatus] = await Promise.all([
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
      fetchContractStatus(playerName),
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
    const standingsLookup = buildStandingsLookup(standingsRes);
    const matchedProfiles = getGmProfiles(rumor, researchFindings);
    const gmProfileSection = matchedProfiles.length > 0
      ? [
          "GM PROFILES FOR TEAMS INVOLVED (records are live from MLB Stats API — not cached):",
          ...matchedProfiles.map(p => formatGmProfile(p, standingsLookup[p.team] || null)),
          "Use these profiles to assess whether this move fits or contradicts each GM's current operating style. Records above are live. Do not use your training data for GM behavior or team records.",
        ].join("\n\n")
      : "";

    const standingsSummary = buildStandingsSummary(standingsRes);
    const contractSection = formatContractSection(playerName, contractStatus);

    const analysisUserMsg = [
      `Rumor: "${rumor}"`,
      "",
      `RESEARCH FINDINGS (${today}):`,
      researchFindings,
      "",
      contractSection,
      "",
      gmProfileSection,
      "",
      standingsSummary,
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
