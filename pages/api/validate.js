// pages/api/validate.js
// Streaming validate — Pass 1 + MLB Stats run in parallel, Pass 2 streams tokens
// Prompt caching enabled on both passes for performance

import gmProfiles from "../../gm-profiles.json";
import { FIT_FALLBACK, INCOMPLETE_FINDINGS_MSG, MODELS, MAX_TOKENS, CHAR_LIMIT, FINDINGS_TRUNCATION_LIMIT, PASS_1_WORD_LIMIT, RETRY_DELAY_MS } from "../../lib/constants.js";

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
// Returns best guess at player name or null if not found.
function extractPlayerName(rumor) {
  const text = rumor.trim();
  const p1 = text.match(/^(?:is|will|could|would|should|can)\s+([A-Z][a-záéíóúñü]+(?:\s+[A-Z][a-záéíóúñü]+){1,2})/i);
  if (p1) return p1[1].trim();
  const p2 = text.match(/^([A-Z][a-záéíóúñü]+(?:\s+[A-Z][a-záéíóúñü]+){1,2})\s+(?:to\s+the|trade|available|being|possibly|could|rumor|linked)/i);
  if (p2) return p2[1].trim();
  const p3 = text.match(/(?:about|for|acquire|targeting|pursuing|interested\s+in)\s+([A-Z][a-záéíóúñü]+(?:\s+[A-Z][a-záéíóúñü]+){1,2})/i);
  if (p3) return p3[1].trim();
  const p4 = text.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  if (p4) return p4[1].trim();
  return null;
}

// ── Step 1: Resolve player ID from name ───────────────────────────────────────
// Separated from contract/stats fetch so the ID can be reused for both.
async function resolvePlayerId(playerName) {
  if (!playerName) return null;
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(playerName)}&sportIds=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const people = data?.people;
    if (!people?.length) return null;
    const player = people.find(p => p.active) || people[0];
    const playerId = player?.id || null;
    console.log("BirdDog:playerID", JSON.stringify({ playerName, playerId }));
    return playerId;
  } catch (err) {
    console.error("BirdDog:playerID error:", err.message);
    return null;
  }
}

// ── Match a raw team name/abbreviation against the canonical gm-profiles.json list ──
// Returns the canonical team name (e.g. "Detroit Tigers") or null if no match.
// Used by both seller resolution (API team name) and rumor text scanning (P0-2: normalized
// matching only — never loose substring matching against ambiguous rumor wording).
function matchCanonicalTeam(rawName) {
  if (!rawName) return null;
  const normalized = rawName.trim().toLowerCase();
  const match = gmProfiles.teams.find(team =>
    team.team.toLowerCase() === normalized ||
    team.abbreviation.toLowerCase() === normalized
  );
  return match ? match.team : null;
}

// ── Step 1b: Resolve player's current team from MLB Stats API ────────────────
// Required for suitor role tagging (seller vs buyer) — see suitors-role-distinction-spec.
// Independent of resolvePlayerId's caller; only needs playerId.
async function fetchCurrentTeam(playerId) {
  if (!playerId) return null;
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=currentTeam`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("BirdDog:currentTeam error:", `HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const person = data?.people?.[0];
    const rawTeamName = person?.currentTeam?.name || null;
    const canonicalTeam = matchCanonicalTeam(rawTeamName);
    console.log("BirdDog:currentTeam", JSON.stringify({ playerId, rawTeamName, canonicalTeam }));
    return canonicalTeam;
  } catch (err) {
    console.error("BirdDog:currentTeam error:", err.message);
    return null;
  }
}

// ── Find which canonical teams are explicitly named in the rumor's raw input text ──
// P0-2: normalized matching only. Scans against gm-profiles.json's team/abbreviation
// fields — never loose substring matching that risks city-name collisions
// (e.g. "Los Angeles" matching both Angels and Dodgers, "Chicago" matching Cubs and White Sox).
function findTeamsNamedInRumor(rumor) {
  if (!rumor) return [];
  const text = rumor.toLowerCase();
  const found = [];
  for (const team of gmProfiles.teams) {
    const teamLower = team.team.toLowerCase();
    const abbrevLower = team.abbreviation.toLowerCase();
    const parts = teamLower.split(" ");
    const nickname = parts[parts.length - 1];
    // Word-boundary match on full name, abbreviation, or nickname — not raw substring,
    // to avoid partial-word false positives (e.g. "Sox" inside an unrelated word).
    const pattern = new RegExp(`\\b(${escapeRegex(teamLower)}|${escapeRegex(abbrevLower)}|${escapeRegex(nickname)})\\b`, "i");
    if (pattern.test(text)) found.push(team.team);
  }
  return found;
}

// ── Escape special regex characters in team names/abbreviations before building patterns ──
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Step 2a: Classify contract from a person object (shared by both fetch attempts) ──
function classifyContract(person, currentYear) {
  const serviceTime = person.mlbDebutDate
    ? Math.floor((new Date() - new Date(person.mlbDebutDate)) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  // Arb status from service time — primary signal, API contract data is unreliable
  let arbStatus = null;
  if (serviceTime !== null) {
    if (serviceTime < 3) arbStatus = "pre-arb";
    else if (serviceTime < 6) {
      const arbYear = Math.min(Math.floor(serviceTime) - 2, 3);
      arbStatus = `arb year ${arbYear} of 3`;
    }
  }

  // Arb year 3 = final year of team control = RENTAL regardless of contractEnd
  if (arbStatus === "arb year 3 of 3") {
    const result = `RENTAL — final arb year (service time: ~${serviceTime} years), free agent after ${currentYear} season`;
    console.log("BirdDog:contract", JSON.stringify({ serviceTime, arbStatus, classification: "RENTAL", source: "serviceTime" }));
    return result;
  }

  // Try contractEnd from either hydration key
  const contract = person.currentContract || (person.contracts && person.contracts[0]);
  const contractEnd = contract && contract.endDate ? new Date(contract.endDate).getFullYear() : null;

  if (contractEnd) {
    const yearsRemaining = contractEnd - currentYear;
    let classification;
    if (yearsRemaining <= 0) {
      classification = `RENTAL — contract expires after ${currentYear} season`;
    } else if (yearsRemaining === 1) {
      classification = `CONTROLLABLE — 1 year remaining (through ${contractEnd})${arbStatus ? `, ${arbStatus}` : ""}`;
    } else {
      classification = `CONTROLLABLE — ${yearsRemaining} years remaining (through ${contractEnd})${arbStatus ? `, ${arbStatus}` : ""}`;
    }
    console.log("BirdDog:contract", JSON.stringify({ serviceTime, arbStatus, contractEnd, yearsRemaining, classification: yearsRemaining <= 0 ? "RENTAL" : "CONTROLLABLE", source: "contractEnd" }));
    return classification;
  }

  // Service time fallback for pre-arb and arb year 1-2
  if (arbStatus) {
    const classification = `CONTROLLABLE — ${arbStatus} (service time: ~${serviceTime} years)`;
    console.log("BirdDog:contract", JSON.stringify({ serviceTime, arbStatus, classification: "CONTROLLABLE", source: "serviceTimeFallback" }));
    return classification;
  }

  console.log("BirdDog:contract", JSON.stringify({ serviceTime, arbStatus, classification: null, source: "noData" }));
  return null;
}

// ── Step 2a: Fetch contract status — three-attempt fallback chain ─────────────
// Attempt 1: currentContract hydration
// Attempt 2: contracts hydration (only on null from attempt 1)
// Attempt 3: inject UNKNOWN to block Pass 2 from using training data
async function fetchContractStatus(playerId) {
  if (!playerId) return null;
  const currentYear = new Date().getFullYear();

  try {
    // Attempt 1: currentContract hydration
    const res1 = await fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=currentContract`);
    if (res1.ok) {
      const data1 = await res1.json();
      const person1 = data1 && data1.people && data1.people[0];
      if (person1) {
        const result = classifyContract(person1, currentYear);
        if (result) return result;
      }
    }

    // Attempt 2: contracts hydration (fallback)
    console.log("BirdDog:contract", JSON.stringify({ playerId, note: "currentContract null, trying contracts hydration" }));
    const res2 = await fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=contracts`);
    if (res2.ok) {
      const data2 = await res2.json();
      const person2 = data2 && data2.people && data2.people[0];
      if (person2) {
        const result = classifyContract(person2, currentYear);
        if (result) return result;
      }
    }

    // Attempt 3: all sources exhausted — UNKNOWN blocks Pass 2 training data
    console.log("BirdDog:contract", JSON.stringify({ playerId, note: "all sources null, injecting UNKNOWN" }));
    return "UNKNOWN";

  } catch (err) {
    console.error("BirdDog:contract error:", err.message);
    return "UNKNOWN";
  }
}

// ── Step 2b: Fetch player stats using resolved player ID ──────────────────────
// Position players: AVG/OBP/SLG/OPS + LHP/RHP splits + HR/RBI/SB + career OPS
// Pitchers: ERA/WHIP/K9/BB9/IP + LHB/RHB splits + career ERA
async function fetchPlayerStats(playerId, currentYear) {
  if (!playerId) return null;
  try {
    // Fetch current season stats + career stats + current season splits
    const [seasonRes, splitsRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(group=[hitting,pitching],type=[season,career],season=${currentYear},sportId=1)`),
      fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=statSplits&season=${currentYear}&sportId=1&group=hitting,pitching`),
    ]);

    if (!seasonRes.ok) return null;
    const seasonData = await seasonRes.json();
    const person = seasonData?.people?.[0];
    if (!person) return null;

    const allStats = person.stats || [];

    // Determine pitcher vs. position player from primary position
    const primaryPos = person.primaryPosition?.abbreviation || "";
    const isPitcher = ["P", "SP", "RP", "CL"].includes(primaryPos);

    // Extract season and career stat groups
    const findStats = (group, type) =>
      allStats.find(s => s.group?.displayName === group && s.type?.displayName === type)?.splits?.[0]?.stat || null;

    const seasonHitting  = findStats("hitting",  "season");
    const careerHitting  = findStats("hitting",  "career");
    const seasonPitching = findStats("pitching", "season");
    const careerPitching = findStats("pitching", "career");

    // Parse splits if available
    let splitsData = null;
    if (splitsRes.ok) {
      try {
        const sd = await splitsRes.json();
        splitsData = sd?.stats || null;
      } catch (splitErr) {
        console.error("BirdDog splits parse error:", splitErr.message);
      }
    }

    const findSplit = (group, splitCode) => {
      if (!splitsData) return null;
      const group_ = splitsData.find(s => s.group?.displayName === group);
      return group_?.splits?.find(s => s.split?.code === splitCode)?.stat || null;
    };

    console.log("BirdDog:stats", JSON.stringify({ playerId, isPitcher, hasSeasonStats: !!(seasonHitting || seasonPitching) }));

    if (isPitcher && seasonPitching) {
      const vsLHB = findSplit("pitching", "vl");
      const vsRHB = findSplit("pitching", "vr");
      const lines = [
        `Position: ${primaryPos} (Pitcher)`,
        `${currentYear}: ERA ${seasonPitching.era || "—"} | WHIP ${seasonPitching.whip || "—"} | K/9 ${seasonPitching.strikeoutsPer9Inn || "—"} | BB/9 ${seasonPitching.walksPer9Inn || "—"} | IP ${seasonPitching.inningsPitched || "—"}`,
        careerPitching ? `Career ERA: ${careerPitching.era || "—"}` : "",
        vsLHB ? `vs LHB: OPS ${vsLHB.ops || "—"}` : "",
        vsRHB ? `vs RHB: OPS ${vsRHB.ops || "—"}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    }

    if (!isPitcher && seasonHitting) {
      const vsLHP = findSplit("hitting", "vl");
      const vsRHP = findSplit("hitting", "vr");
      const lines = [
        `Position: ${primaryPos}`,
        `${currentYear}: AVG ${seasonHitting.avg || "—"} | OBP ${seasonHitting.obp || "—"} | SLG ${seasonHitting.slg || "—"} | OPS ${seasonHitting.ops || "—"} | HR ${seasonHitting.homeRuns ?? "—"} | RBI ${seasonHitting.rbi ?? "—"} | SB ${seasonHitting.stolenBases ?? "—"}`,
        careerHitting ? `Career OPS: ${careerHitting.ops || "—"}` : "",
        vsLHP ? `vs LHP: OPS ${vsLHP.ops || "—"}` : "",
        vsRHP ? `vs RHP: OPS ${vsRHP.ops || "—"}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    }

    return null;
  } catch (err) {
    console.error("BirdDog stats fetch error:", err.message);
    return null;
  }
}

// ── Resolve buyer/seller roles for teams named in the rumor — P0-1 through P0-5 ──
// sellerTeam: canonical name of player's current team, or null if resolution failed
// rumorTeams: canonical names of teams explicitly mentioned in the rumor's raw text
// Returns { seller, buyers, resolutionFailed }
//   seller: canonical team name if known, else null
//   buyers: array of canonical team names tagged as buyer (named in rumor, not the seller)
//   resolutionFailed: true if sellerTeam could not be determined (P0-5 degraded path)
function resolveTeamRoles(sellerTeam, rumorTeams) {
  if (!sellerTeam) {
    // P0-5: resolution failed — seller unknown. Still suppress any team named directly
    // in the rumor text (no API dependency needed for this part), but cannot tag a
    // seller since we don't know who currently rosters the player.
    console.log("BirdDog:teamRole", JSON.stringify({ sellerTeam: null, rumorTeams, note: "resolution failed, degraded suppression only" }));
    return { seller: null, buyers: rumorTeams, resolutionFailed: true };
  }
  const buyers = rumorTeams.filter(t => t !== sellerTeam);
  console.log("BirdDog:teamRole", JSON.stringify({ seller: sellerTeam, buyers }));
  return { seller: sellerTeam, buyers, resolutionFailed: false };
}

// ── Format team role context for Pass 2 injection ─────────────────────────────
// Tells Pass 2 which team is the seller (suppress from suitors unless retention signal
// exists, see P0-4) and which teams are buyers (always suppress from suitors, P0-3).
function formatTeamRoleSection(roles) {
  if (!roles.seller && roles.buyers.length === 0) return "";

  const lines = ["TEAM ROLES IN THIS RUMOR (authoritative — do not infer from training data):"];

  if (roles.seller) {
    lines.push(`Seller (player's current team): ${roles.seller}`);
    lines.push(`Do NOT list ${roles.seller} in potential_suitors as a generic competing buyer — they already have the player.`);
    lines.push(`Only include ${roles.seller} in potential_suitors if research findings show a specific retention signal (e.g. extension talks, reported reluctance to deal, stalled asking price). If included, frame it explicitly as a retention angle, not a standard suitor, and it must be sorted last regardless of tier.`);
  } else if (roles.resolutionFailed) {
    lines.push("Seller team could not be determined from live data this run.");
  }

  if (roles.buyers.length > 0) {
    lines.push(`Teams already named in this rumor as interested parties: ${roles.buyers.join(", ")}.`);
    lines.push(`Do NOT list ${roles.buyers.length > 1 ? "these teams" : "this team"} again in potential_suitors — they are already the subject of the rumor, not a separate suitor to surface.`);
  }

  return lines.join("\n");
}

// ── Format contract section for Pass 2 injection ──────────────────────────────
// UNKNOWN is injected explicitly when all API sources fail — tells Pass 2 to use fallback phrase
function formatContractSection(playerName, contractStatus) {
  if (!contractStatus) return "";
  if (contractStatus === "UNKNOWN") {
    return [
      "PLAYER CONTRACT STATUS: UNKNOWN",
      `Player: ${playerName}`,
      "No contract data available from any source. Do not infer contract status from training data. Use the financial fallback phrase.",
    ].join("\n");
  }
  return [
    "PLAYER CONTRACT STATUS (from MLB Stats API — authoritative, not training data):",
    `Player: ${playerName}`,
    `Status: ${contractStatus}`,
    "Use this classification in the financial field. Do not reclassify based on training data or web search findings.",
  ].join("\n");
}

// ── Format player stats section for Pass 2 injection ─────────────────────────
function formatStatsSection(playerName, statsText) {
  if (!statsText) return "";
  return [
    "PLAYER STATS (from MLB Stats API — authoritative, not training data):",
    `Player: ${playerName}`,
    statsText,
    "Use these stats to assess roster fit and player strengths/weaknesses. Do not use training data for player performance.",
  ].join("\n");
}

// ── Build live standings lookup keyed by full team name ───────────────────────
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
// Pass 2 never falls back to training data for any team record.
function buildStandingsSummary(standingsRes) {
  if (!standingsRes?.records) return "";
  const lines = ["LIVE MLB STANDINGS (from MLB Stats API — use these records, never your training data):"];
  for (const divRecord of standingsRes.records) {
    const division = divRecord.division?.name || "";
    lines.push(`\n${division}:`);
    for (const tr of divRecord.teamRecords || []) {
      const name = tr.team?.name || "";
      const rank = tr.divisionRank;
      const gb = tr.gamesBack === "-" ? "—" : tr.gamesBack;
      lines.push(`  ${name}: ${tr.wins}-${tr.losses}, ${rank}${rank === "1" ? "st" : rank === "2" ? "nd" : rank === "3" ? "rd" : "th"} (${gb} GB)`);
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
async function fetchWithRetry(url, options, retries = 1, delayMs = RETRY_DELAY_MS) {
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

  if (rumor.trim().length > CHAR_LIMIT) {
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
        `Return a SHORT report — max ${PASS_1_WORD_LIMIT} words total — with these sections:`,
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
        `Be brief. Lead with recent. Stop at ${PASS_1_WORD_LIMIT} words.`,
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
        "Passan leads — short sentences, authoritative, never buries the lede.",
        "Olney sources — names the reporters, names the silence, evidence-based.",
        "Ripken punctuates — one casual, baseball-smart observation per response that lands like a former player reading the room. Never forced. Never every field. When the observation earns it, drop it. When it doesn't, skip it.",
        "  Good Ripken moments: when silence IS the story ('Nobody who's actually picked up a phone on this has filed anything. That's the tell.'), when fan buzz and reporter silence diverge ('The stands are loud. The press box is quiet. Know the difference.'), when a score lands surprisingly ('That number tells you everything Elias isn't saying publicly.').",
        "  Bad Ripken moments: routine corroborated rumors where the reporting speaks for itself, tacked on endings just to have one, more than once per response.",
        "Lead with the finding. Say what the reporting shows — or doesn't show.",
        "Name the reporters. Name the outlets. Name the silence when that's the story.",
        "Short sentences. Present tense. No hedging phrases, no academic language.",
        "Never say: 'it is worth noting', 'this indicates', 'demonstrates', 'aforementioned', 'analysis suggests', 'cannot be confirmed', 'no data was returned', 'findings indicate', 'per the research', 'aggregators', 'Tier 1', 'Tier 2', 'Tier 3'.",
        "Instead of 'Tier 1 reporter' say 'national reporter' or name them directly (Passan, Rosenthal, Olney). Instead of 'Tier 2' say 'corroborating reporter' or name them. Never use tier labels in any user-facing field.",
        "Never describe what data is missing — just say what BirdDog found or didn't find.",
        "Never make definitive predictions. No 'will not happen', 'this won't go through', 'ruled out'. Trades surprise everyone. BirdDog reads signals — it doesn't call outcomes.",
        "Never name specific outlets disparagingly. Say 'roundup sites and analyst columns' not '[Outlet X] is not credible'. BirdDog explains what it didn't find — it doesn't attack what it did.",
        "Grade 9-10 reading level. Baseball-smart, not academic.",
        "",
        "WHAT YOU ARE ANALYZING:",
        "You will receive research findings from a web search pass, plus live data from the MLB Stats API (player stats, contract status, standings, GM profiles).",
        "Analyze ONLY what is in those findings and injected data. Do not invent details. Do not use your training data for player performance, contract status, roster composition, or team records.",
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
        "  No weight — treat as noise: Bleacher Report, FanSided roundups, Reddit, ClutchPoints, SI FanNation. When describing low-credibility sourcing in output, say 'roundup sites and analyst columns' — never name specific outlets disparagingly.",
        "  Two or more strongest reporters = CORROBORATED. One strongest alone = PLAUSIBLE.",
        "",
        "fit_score: how well does this player fit this team's roster, financial situation, and strategic direction? Use the injected player stats and GM profile to inform this score.",
        "overall_likelihood: (credibility x 0.6) + (fit x 0.4)",
        "sentiment_score: how much fan buzz exists? High fan buzz with low reporter credibility = FAN_DRIVEN. Discount from overall score.",
        "",
        "VERDICT (pick one): CORROBORATED | PLAUSIBLE | WEAK | REFUTED | UNVERIFIED",
        "RUMOR CLASSIFICATION (pick one): REPORTER_LED | CORROBORATED | FAN_DRIVEN | NOISE",
        "",
        "GM MODIFIER:",
        "A GM profile for the teams involved is provided in the user message under GM PROFILES FOR TEAMS INVOLVED. Use that profile — do not search the findings for GM tendencies and do not use your training data.",
        `If no GM profile is provided for a team, write: '${FIT_FALLBACK.gm_profile}'`,
        "+10 if this move fits their current pattern. 0 if unknown or neutral. -10 if it contradicts their current pattern.",
        "In the gm_profile field: name the GM, describe their current tendencies in one plain sentence, and state in plain language whether this move fits or contradicts their pattern. Never use the word 'modifier'.",
        "",
        "PLAYER FIT FIELDS — write these in BirdDog voice. Focus on the RUMORED DESTINATION only. Suitors are handled separately.",
        "ALL FOUR FIELDS share the same voice: Passan/Olney/Ripken. No field is clinical, no field is a data form. Sound like a scout who's done the homework.",
        "",
        `roster: Use the injected PLAYER STATS to ground this in real numbers. Name the position. State their key strengths and any weaknesses relevant to this specific trade context — use the stats to support the claim, not substitute for it. If the current season differs meaningfully from career norms and the research findings mention it, flag it. If no destination is named, describe what type of team need this player fills and what their profile suits. If stats are unavailable, write: '${FIT_FALLBACK.roster}'`,
        "",
        `financial: The player's contract status is in PLAYER CONTRACT STATUS — use that classification exactly, never reclassify from training data. State it plainly first: 'Ward is a rental' or 'Skubal is a rental in his final arb year'. If extension context was found in research findings, upgrade RENTAL to EXTENSION CANDIDATE and explain. Then assess whether THIS team can afford the player and what that means for the prospect cost. A rental costs fewer prospects than a controllable player. CRITICAL: If no PLAYER CONTRACT STATUS section is present in this message, you have no contract data — write: '${FIT_FALLBACK.financial}'. Do NOT use your training data to fill in contract details.`,
        "",
        `strategic: Does this move fit where THIS team is headed right now? Factor in the contract type from PLAYER CONTRACT STATUS — a rental is a one-postseason bet, a controllable player is a franchise asset, an extension candidate is both. Factor in their current record from the live standings. CRITICAL: Use only the injected contract classification — never infer contract type from your training data. If no PLAYER CONTRACT STATUS section is present, do not reference contract type. If no strategic context is available, write: '${FIT_FALLBACK.strategic}'`,
        "",
        `gm_profile: Use the injected GM profile — name the GM, their current operating style in one sentence, whether this move fits or contradicts that style. If no GM profile was injected, write: '${FIT_FALLBACK.gm_profile}'`,
        "",
        "POTENTIAL SUITORS — three tiers, keep it simple:",
        "Active: teams with current reporting or confirmed interest from the last 60 days.",
        "Returning: teams that showed past interest but never filled the need — flag as 'has shown past interest' in rationale.",
        "Dark horse: one team with no public connection but a logical case from the findings.",
        "Use only what the findings show. No training data for current rosters.",
        "Assess against primary position first. Secondary position only if findings confirm it.",
        "If findings don't support naming suitors, return empty array and null darkhorse.",
        "",
        "TEAM ROLES — check the TEAM ROLES section in this message before generating suitors:",
        "If a team is listed there as the seller or as already named in the rumor, follow its instructions exactly — do not add that team back into potential_suitors as a generic third-tier suitor, even if the findings independently mention them in a suitor-sounding context.",
        "A retention angle (seller may keep the player) is the ONLY exception, and only when the TEAM ROLES section explicitly permits it AND research findings show a specific, named retention signal — not generic baseball logic like 'any team could keep any player.' If included, it must be the last entry in potential_suitors regardless of tier, and its rationale must reference the specific signal found, not assert retention as a generic possibility.",
        "",
        "sources_found: List each source as exactly 'Firstname Lastname - Outlet - Date' with no variation. If date is unknown use the year. Max 5 sources. Only include named reporters with bylines — not roundup sites or analyst columns.",
        "",
        "cross_market: Always return this object — never null or missing. Use CONFIRMED if the market has clear reporting, PARTIAL if mentioned but not confirmed, SILENT if nothing found.",
        "For reporters_count and of_total in national_media — count only Tier 1 and Tier 2 reporters, not roundup sites or analyst columns.",
        "For outlet in origin_beat and destination_beat — name the actual local outlet if found, otherwise write 'Local coverage'.",
        "",
        "summary: 2 sentences max. Lead with what the reporting shows. Sound like Passan.",
        "reasoning: 3 sentences max. Name the specific reporters who did or didn't report. Sound like Olney.",
        "",
        "Return ONLY raw JSON, no markdown, no backticks:",
        '{"verdict":"CORROBORATED|PLAUSIBLE|WEAK|REFUTED|UNVERIFIED","rumor_classification":"REPORTER_LED|CORROBORATED|FAN_DRIVEN|NOISE","sentiment_discounted":true,"credibility_score":0,"fit_score":0,"sentiment_score":0,"overall_likelihood":0,"sources_found":["Firstname Lastname - Outlet - Date"],"origin_market":"1 sentence from findings","destination_market":"1 sentence from findings","national":"1 sentence from findings","cross_market":{"national_media":{"status":"PARTIAL|CONFIRMED|SILENT","reporters_count":0,"of_total":3},"origin_beat":{"status":"CONFIRMED|SILENT","outlet":""},"destination_beat":{"status":"CONFIRMED|SILENT","outlet":""}},"summary":"2 sentences. Lead with the verdict. Sound like Passan.","fit_analysis":{"roster":"Stats-informed strength/weakness assessment or BirdDog fallback phrase","financial":"Contract classification first, then affordability — or BirdDog fallback phrase","strategic":"Contract type + team window assessment — or BirdDog fallback phrase","gm_profile":"GM name, current style, fits or contradicts — or BirdDog fallback phrase"},"reasoning":"3 sentences. Name the reporters. Sound like Olney.","potential_suitors":[{"team":"Team Name","rationale":"1 plain sentence"},{"team":"Team Name","rationale":"1 plain sentence"}],"darkhorse":{"team":"Team Name","rationale":"1 plain sentence"},"darkhorse_note":"only if suitors empty"}',
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

    // ── Step 1: Extract player name + resolve ID in parallel with Pass 1 start ──
    // resolvePlayerId is fast (~200ms) and runs alongside Pass 1 (~15-20s)
    // We kick off Pass 1 immediately, resolve the ID in parallel, then use it
    // for contract + stats which also complete well before Pass 1 finishes.
    const playerName = extractPlayerName(rumor);

    // ── PARALLEL STAGE 1: Pass 1 + standings + player ID resolution ───────────
    const [searchRes, standingsRes, playerId] = await Promise.all([
      fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: MODELS.PASS_1,
          max_tokens: MAX_TOKENS.PASS_1,
          system: searchSystemPrompt,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          tool_choice: { type: "any" },
          messages: [{ role: "user", content: searchUserMsg }],
        }),
      }),
      fetch(`https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${thisYear}&standingsTypes=regularSeason`)
        .then(r => r.json())
        .catch(() => null),
      resolvePlayerId(playerName),
    ]);

    // ── PARALLEL STAGE 2: Contract + stats + current team (use resolved player ID) ──
    // These run after Stage 1 but Pass 1 is still processing — no wall time added
    const [contractStatus, playerStats, sellerTeam] = await Promise.all([
      fetchContractStatus(playerId),
      fetchPlayerStats(playerId, thisYear),
      fetchCurrentTeam(playerId),
    ]);

    // ── Resolve buyer/seller roles from rumor text + resolved seller team — P0-1 through P0-5 ──
    const rumorTeams = findTeamsNamedInRumor(rumor);
    const teamRoles = resolveTeamRoles(sellerTeam, rumorTeams);

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
    const researchFindings = rawFindings.length > FINDINGS_TRUNCATION_LIMIT
      ? rawFindings.substring(0, FINDINGS_TRUNCATION_LIMIT) + "\n[truncated for length]"
      : rawFindings;

    send("status", { message: "Sources scanned. Analyzing..." });

    // ── PASS 2: Assemble context and stream analysis ───────────────────────────
    const standingsLookup = buildStandingsLookup(standingsRes);
    const matchedProfiles = getGmProfiles(rumor, researchFindings);
    const gmProfileSection = matchedProfiles.length > 0
      ? [
          "GM PROFILES FOR TEAMS INVOLVED (records are live from MLB Stats API — not cached):",
          ...matchedProfiles.map(p => formatGmProfile(p, standingsLookup[p.team] || null)),
          "Use these profiles to assess whether this move fits or contradicts each GM's current operating style. Records above are live. Do not use your training data for GM behavior or team records.",
        ].join("\n\n")
      : "";

    const standingsSummary  = buildStandingsSummary(standingsRes);
    const contractSection   = formatContractSection(playerName, contractStatus);
    const statsSection      = formatStatsSection(playerName, playerStats);
    const teamRoleSection   = formatTeamRoleSection(teamRoles);

    // Contract status and team roles are critical classifications that Pass 2 has
    // historically overridden with training data when buried later in the message.
    // Both go first, ahead of research findings, so they can't lose priority.
    const analysisUserMsg = [
      `Rumor: "${rumor}"`,
      "",
      contractSection,
      "",
      teamRoleSection,
      "",
      `RESEARCH FINDINGS (${today}):`,
      researchFindings,
      "",
      statsSection,
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
        model: MODELS.PASS_2,
        max_tokens: MAX_TOKENS.PASS_2,
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
