// lib/constants.js
// Shared constants between validate.js (API) and index.js (UI)
// Single source of truth — update here, both files stay in sync

// ── Model selection ───────────────────────────────────────────────────────────
// Pass 1: retrieval only — Haiku is faster and cheaper for web search tasks
// Pass 2: analysis and verdict — Sonnet for full reasoning quality
export const MODELS = {
  PASS_1: "claude-haiku-4-5",
  PASS_2: "claude-sonnet-4-6",
};

// ── Token budgets ─────────────────────────────────────────────────────────────
export const MAX_TOKENS = {
  PASS_1: 2500,
  PASS_2: 1800,
};

// ── Input / output limits ─────────────────────────────────────────────────────
export const CHAR_LIMIT              = 255;  // Max rumor input length (enforced in UI + API)
export const FINDINGS_TRUNCATION_LIMIT = 4000; // Max Pass 1 findings passed to Pass 2
export const PASS_1_WORD_LIMIT       = 900;  // Max words requested in Pass 1 prompt

// ── Retry config ──────────────────────────────────────────────────────────────
export const RETRY_DELAY_MS = 15000; // Backoff delay on 429 retry (ms)

// ── Fit fallback phrases ──────────────────────────────────────────────────────
export const FIT_FALLBACK = {
  roster:     "BirdDog's still mapping the roster situation — check back soon.",
  financial:  "BirdDog's still sniffing around on this one. Contract details are out there somewhere — just haven't picked up the scent yet. Check back soon.",
  strategic:  "Still reading the room on the strategic fit. More to come.",
  gm_profile: "The front office read is still coming in. BirdDog's working it.",
};

// ── Global error message — used in both API and UI to detect incomplete findings
export const INCOMPLETE_FINDINGS_MSG = "BirdDog lost the scent mid-trail. One rumor at a time keeps BirdDog focused.";
