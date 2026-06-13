// lib/constants.js
// Shared constants between validate.js (API) and index.js (UI)
// Single source of truth — update here, both files stay in sync

export const FIT_FALLBACK = {
  roster:     "BirdDog's still mapping the roster situation — check back soon.",
  financial:  "BirdDog's still sniffing around on this one. Contract details are out there somewhere — just haven't picked up the scent yet. Check back soon.",
  strategic:  "Still reading the room on the strategic fit. More to come.",
  gm_profile: "The front office read is still coming in. BirdDog's working it.",
};

// Global error message — used in both API and UI to detect incomplete findings
export const INCOMPLETE_FINDINGS_MSG = "BirdDog lost the scent mid-trail. One rumor at a time keeps BirdDog focused.";
