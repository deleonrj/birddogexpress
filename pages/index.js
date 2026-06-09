// pages/index.js
import { useState, useCallback } from "react";

const VERDICT_CONFIG = {
  CORROBORATED: { label: "✅ Corroborated",              color: "#22c55e", bg: "#052e16", border: "#16a34a" },
  PLAUSIBLE:    { label: "🟡 Plausible but Unconfirmed",  color: "#f59e0b", bg: "#1c1003", border: "#d97706" },
  WEAK:         { label: "⚠️ Weak / Speculative",         color: "#f97316", bg: "#1c0a03", border: "#ea580c" },
  REFUTED:      { label: "❌ Refuted / Debunked",          color: "#ef4444", bg: "#1c0a0a", border: "#991b1b" },
  UNVERIFIED:   { label: "🔍 Unverified",                 color: "#94a3b8", bg: "#0f172a", border: "#475569" },
};

const MLB_TEAMS = [
  "arizona diamondbacks","atlanta braves","baltimore orioles","boston red sox",
  "chicago cubs","chicago white sox","cincinnati reds","cleveland guardians",
  "colorado rockies","detroit tigers","houston astros","kansas city royals",
  "los angeles angels","los angeles dodgers","miami marlins","milwaukee brewers",
  "minnesota twins","new york mets","new york yankees","oakland athletics",
  "philadelphia phillies","pittsburgh pirates","san diego padres","san francisco giants",
  "seattle mariners","st. louis cardinals","tampa bay rays","texas rangers",
  "toronto blue jays","washington nationals",
];

const TWEET_LIMIT = 280;
const charCount = (t) => t?.length || 0;

function TweetChar({ count }) {
  const remaining = TWEET_LIMIT - count;
  const pct = count / TWEET_LIMIT;
  const color = pct > 0.9 ? "#ef4444" : pct > 0.75 ? "#f59e0b" : "#22c55e";
  return (
    <span style={{ color, fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>
      {remaining < 0 ? `-${Math.abs(remaining)}` : remaining}
    </span>
  );
}

function ScorePill({ label, value, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 80 }}>
      <div style={{ fontSize: 11, color: "#475569", letterSpacing: "1px", textTransform: "uppercase" }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 800, color,
        background: color + "18", border: "1px solid " + color + "44",
        borderRadius: 8, padding: "4px 14px", fontFamily: "monospace",
      }}>{value}%</div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#475569", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>{children}</div>
    </div>
  );
}

export default function BirdDogExpress() {
  const [step, setStep] = useState("input");
  const [rumor, setRumor] = useState("");
  const [gptOutput, setGptOutput] = useState("");
  const [validation, setValidation] = useState(null);
  const [tweet, setTweet] = useState("");
  const [bskyHandle, setBskyHandle] = useState("");
  const [bskyAppPassword, setBskyAppPassword] = useState("");
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState(null);
  const [showBskyForm, setShowBskyForm] = useState(false);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("tracker");
  const [copyLabel, setCopyLabel] = useState("📋 Copy Text");
  const [errorMsg, setErrorMsg] = useState(null);
  const [teamRecords, setTeamRecords] = useState({});

  const validate = useCallback(async () => {
    if (!rumor.trim()) return;
    setStep("validating");
    setValidation(null);
    setPostResult(null);
    setErrorMsg(null);
    setTeamRecords({});

    // Fetch standings in parallel
    const standingsPromise = fetch("/api/standings")
      .then((r) => r.json())
      .then((d) => d.records || {})
      .catch(() => ({}));

    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rumor, gptOutput }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Validation failed (" + res.status + ")");
      }

      const parsed = json.data;
      if (!VERDICT_CONFIG[parsed.verdict]) parsed.verdict = "UNVERIFIED";

      const standings = await standingsPromise;
      setTeamRecords(standings);
      setValidation(parsed);
      setTweet(parsed.tweet || "");
      setStep("result");

      setHistory((prev) => [{
        id: Date.now(),
        rumor,
        verdict: parsed.verdict,
        credibility: parsed.credibility_score,
        fit: parsed.fit_score,
        overall: parsed.overall_likelihood,
        timestamp: new Date().toLocaleTimeString(),
      }, ...prev.slice(0, 9)]);

    } catch (err) {
      setErrorMsg(err.message);
      setStep("error");
    }
  }, [rumor, gptOutput]);

  const postToBluesky = useCallback(async () => {
    if (!bskyHandle || !bskyAppPassword || !tweet) return;
    setPosting(true);
    setPostResult(null);
    try {
      const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: bskyHandle, password: bskyAppPassword }),
      });
      const session = await sessionRes.json();
      if (!session.accessJwt) throw new Error(session.message || "Auth failed — check handle and app password");

      const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.accessJwt },
        body: JSON.stringify({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: { text: tweet, createdAt: new Date().toISOString(), langs: ["en-US"] },
        }),
      });
      const pd = await postRes.json();
      if (pd.uri) setPostResult({ success: true });
      else throw new Error(pd.message || "Post failed");
    } catch (err) {
      setPostResult({ success: false, error: err.message });
    } finally {
      setPosting(false);
    }
  }, [bskyHandle, bskyAppPassword, tweet]);

  const reset = () => {
    setStep("input"); setRumor(""); setGptOutput("");
    setValidation(null); setTweet(""); setPostResult(null);
    setShowBskyForm(false); setErrorMsg(null);
  };

  const cfg = validation ? (VERDICT_CONFIG[validation.verdict] || VERDICT_CONFIG.UNVERIFIED) : null;

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "#0f172a", border: "1px solid #1e293b",
    borderRadius: 8, color: "#e2e8f0", fontSize: 14,
    padding: "11px 13px", fontFamily: "inherit", outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#020617", color: "#e2e8f0", fontFamily: "Georgia, serif" }}>

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #0c1e3d 0%, #001f5c 60%, #041229 100%)",
        borderBottom: "2px solid #1d4ed8",
        padding: "18px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "linear-gradient(135deg, #dc2626, #1d4ed8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: "0 0 18px rgba(29,78,216,0.5)",
          }}>⚾</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>BirdDog Express</div>
            <div style={{ fontSize: 11, color: "#475569", letterSpacing: "2px", textTransform: "uppercase" }}>MLB Rumor Tracker · AI-Powered Validation</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["tracker", "history"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: "6px 16px", borderRadius: 6, border: "1px solid",
              borderColor: activeTab === tab ? "#1d4ed8" : "#1e293b",
              background: activeTab === tab ? "#1d4ed8" : "transparent",
              color: activeTab === tab ? "#fff" : "#64748b",
              cursor: "pointer", fontSize: 13, fontFamily: "inherit", textTransform: "capitalize",
            }}>
              {tab === "history" ? `History (${history.length})` : "Tracker"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "28px 20px" }}>

        {/* HISTORY */}
        {activeTab === "history" && (
          <div>
            <div style={{ fontSize: 12, color: "#64748b", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 16 }}>Recent Validations</div>
            {history.length === 0
              ? <div style={{ textAlign: "center", color: "#1e293b", padding: "60px 0" }}>No rumors validated yet.</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {history.map((h) => {
                    const hc = VERDICT_CONFIG[h.verdict] || VERDICT_CONFIG.UNVERIFIED;
                    return (
                      <div key={h.id} style={{
                        background: "#0f172a", border: "1px solid " + hc.border + "33",
                        borderRadius: 10, padding: "14px 18px",
                        display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 4 }}>{h.rumor}</div>
                          <div style={{ fontSize: 11, color: "#334155" }}>{h.timestamp}</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                          <span style={{ background: hc.bg, border: "1px solid " + hc.border, color: hc.color, borderRadius: 5, padding: "2px 9px", fontSize: 11, whiteSpace: "nowrap" }}>{hc.label}</span>
                          <div style={{ fontSize: 11, color: "#475569", display: "flex", gap: 8 }}>
                            <span>Cred: <b style={{ color: hc.color }}>{h.credibility}%</b></span>
                            <span>Fit: <b style={{ color: hc.color }}>{h.fit}%</b></span>
                            <span>Overall: <b style={{ color: hc.color }}>{h.overall}%</b></span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        )}

        {/* TRACKER */}
        {activeTab === "tracker" && (
          <>
            {/* INPUT */}
            {step === "input" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#64748b", letterSpacing: "1px", textTransform: "uppercase", display: "block", marginBottom: 8 }}>MLB Rumor *</label>
                  <textarea
                    value={rumor}
                    onChange={(e) => setRumor(e.target.value)}
                    placeholder="e.g. The Mets are in serious discussions with the Cubs about a deal for Cody Bellinger..."
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6, fontSize: 15 }}
                    onFocus={(e) => (e.target.style.borderColor = "#1d4ed8")}
                    onBlur={(e) => (e.target.style.borderColor = "#1e293b")}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#64748b", letterSpacing: "1px", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                    CustomGPT Output <span style={{ color: "#334155", fontStyle: "italic", textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                  </label>
                  <textarea
                    value={gptOutput}
                    onChange={(e) => setGptOutput(e.target.value)}
                    placeholder="Paste your CustomGPT validation output here for additional context..."
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6, color: "#94a3b8", fontFamily: "monospace" }}
                    onFocus={(e) => (e.target.style.borderColor = "#475569")}
                    onBlur={(e) => (e.target.style.borderColor = "#1e293b")}
                  />
                </div>
                <div style={{ background: "#0a1628", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "#334155", lineHeight: 1.8 }}>
                  <span style={{ color: "#1d4ed8", fontWeight: 600 }}>Sources: </span>
                  Origin market · Destination market · National (Passan, Rosenthal, Heyman, Feinsand, Nightengale, Morosi, The Athletic, ESPN, MLB.com) · GM profiling · Confidence caps enforced · Live standings via MLB API
                </div>
                <button
                  onClick={validate}
                  disabled={!rumor.trim()}
                  style={{
                    background: rumor.trim() ? "linear-gradient(135deg, #1d4ed8, #2563eb)" : "#1e293b",
                    color: rumor.trim() ? "#fff" : "#334155",
                    border: "none", borderRadius: 10, padding: "14px 28px",
                    fontSize: 15, fontWeight: 700, cursor: rumor.trim() ? "pointer" : "not-allowed",
                    fontFamily: "inherit", alignSelf: "flex-start",
                    boxShadow: rumor.trim() ? "0 4px 18px rgba(29,78,216,0.4)" : "none",
                  }}
                >⚾ Validate Rumor</button>
              </div>
            )}

            {/* VALIDATING */}
            {step === "validating" && (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div style={{
                  width: 60, height: 60, margin: "0 auto 20px",
                  border: "3px solid #1d4ed8", borderTopColor: "transparent",
                  borderRadius: "50%", animation: "spin 0.8s linear infinite",
                }} />
                <div style={{ fontSize: 17, color: "#94a3b8", marginBottom: 8 }}>Searching All Three Markets...</div>
                <div style={{ fontSize: 13, color: "#334155" }}>Origin · Destination · National · GM Profile · Confidence Caps</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {/* ERROR */}
            {step === "error" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#1c0a0a", border: "1px solid #991b1b", borderRadius: 10, padding: "18px 22px" }}>
                  <div style={{ fontSize: 15, color: "#ef4444", fontWeight: 600, marginBottom: 8 }}>Validation Failed</div>
                  <div style={{ fontSize: 13, color: "#f87171", fontFamily: "monospace", lineHeight: 1.6, wordBreak: "break-all" }}>{errorMsg}</div>
                </div>
                <button onClick={reset} style={{ background: "transparent", border: "1px solid #1e293b", color: "#475569", borderRadius: 8, padding: "10px 22px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}>
                  ← Try Again
                </button>
              </div>
            )}

            {/* RESULT */}
            {step === "result" && validation && cfg && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

                {/* Verdict + Scores */}
                <div style={{ background: cfg.bg, border: "2px solid " + cfg.border, borderRadius: 12, padding: "18px 22px" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: cfg.color, marginBottom: 14 }}>{cfg.label}</div>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <ScorePill label="Credibility" value={validation.credibility_score} color={cfg.color} />
                    <ScorePill label="Fit" value={validation.fit_score} color={cfg.color} />
                    <ScorePill label="Overall" value={validation.overall_likelihood} color={cfg.color} />
                  </div>
                </div>

                {/* Summary + Sources */}
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
                  <Section label="Summary">{validation.summary}</Section>
                  {validation.sources_found?.length > 0 && (
                    <div style={{ borderTop: "1px solid #1e293b", paddingTop: 14 }}>
                      <div style={{ fontSize: 11, color: "#475569", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 6 }}>Sources Found</div>
                      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                        {validation.sources_found.map((s, i) => <li key={i} style={{ fontSize: 13, color: "#64748b" }}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Live Team Records */}
                {Object.keys(teamRecords).length > 0 && (() => {
                  const allText = [validation.summary, validation.origin_market, validation.destination_market].join(" ").toLowerCase();
                  const found = MLB_TEAMS
                    .filter((t) => allText.includes(t))
                    .map((t) => teamRecords[t])
                    .filter(Boolean)
                    .filter((v, i, a) => a.findIndex((x) => x.fullName === v.fullName) === i);
                  if (found.length === 0) return null;
                  return (
                    <div style={{ background: "#0a1628", border: "1px solid #1d4ed844", borderRadius: 12, padding: "14px 22px" }}>
                      <div style={{ fontSize: 11, color: "#1d4ed8", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>
                        Live Standings · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {found.map((t) => (
                          <div key={t.fullName} style={{
                            background: "#0f172a", border: "1px solid #1e293b",
                            borderRadius: 8, padding: "8px 16px",
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                          }}>
                            <div style={{ fontSize: 12, color: "#64748b" }}>{t.fullName}</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0", fontFamily: "monospace" }}>{t.record}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Cross-Market */}
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ fontSize: 12, color: "#1d4ed8", letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700 }}>Cross-Market Coverage</div>
                  <Section label="Origin Market">{validation.origin_market}</Section>
                  <div style={{ borderTop: "1px solid #1e293b", paddingTop: 14 }}>
                    <Section label="Destination Market">{validation.destination_market}</Section>
                  </div>
                  <div style={{ borderTop: "1px solid #1e293b", paddingTop: 14 }}>
                    <Section label="National">{validation.national}</Section>
                  </div>
                </div>

                {/* Fit Analysis */}
                {validation.fit_analysis && (
                  <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ fontSize: 12, color: "#1d4ed8", letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700 }}>Fit Analysis</div>
                    {[["Roster", "roster"], ["Financial", "financial"], ["Strategic", "strategic"], ["Market Factors", "market_factors"], ["GM / Front Office", "gm_profile"]].map(([lbl, key], idx) => {
                      const val = validation.fit_analysis[key];
                      if (!val || val === "—") return null;
                      return (
                        <div key={key} style={{ borderTop: idx === 0 ? "none" : "1px solid #0f1f38", paddingTop: idx === 0 ? 0 : 14 }}>
                          <Section label={lbl}>{val}</Section>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Reasoning + QC */}
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <Section label="Reasoning">{validation.reasoning}</Section>
                  {validation.qc_footer && (
                    <div style={{ fontSize: 11, color: "#334155", fontFamily: "monospace", paddingTop: 8, borderTop: "1px solid #0f1f38" }}>
                      {validation.qc_footer}
                    </div>
                  )}
                </div>

                {/* Post Editor */}
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "18px 22px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: "#64748b", letterSpacing: "1px", textTransform: "uppercase" }}>Post Text</div>
                    <TweetChar count={charCount(tweet)} />
                  </div>
                  <textarea
                    value={tweet}
                    onChange={(e) => setTweet(e.target.value)}
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
                  />
                  <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      onClick={() => { navigator.clipboard.writeText(tweet); setCopyLabel("✅ Copied!"); setTimeout(() => setCopyLabel("📋 Copy Text"), 2000); }}
                      style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                    >{copyLabel}</button>
                    <button
                      onClick={() => setShowBskyForm(!showBskyForm)}
                      disabled={charCount(tweet) > TWEET_LIMIT}
                      style={{
                        background: charCount(tweet) > TWEET_LIMIT ? "#1e293b" : "linear-gradient(135deg, #0085ff, #0066cc)",
                        border: "none",
                        color: charCount(tweet) > TWEET_LIMIT ? "#334155" : "#fff",
                        borderRadius: 8, padding: "9px 18px", fontSize: 13,
                        cursor: charCount(tweet) > TWEET_LIMIT ? "not-allowed" : "pointer",
                        fontFamily: "inherit", fontWeight: 600,
                      }}
                    >🦋 Post to BlueSky</button>
                  </div>

                  {showBskyForm && (
                    <div style={{ marginTop: 14, background: "#020617", border: "1px solid #0066cc33", borderRadius: 10, padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
                        🔐 Credentials used only for this post, never stored. Generate an <strong style={{ color: "#0085ff" }}>App Password</strong> in BlueSky → Settings → Privacy and Security → App Passwords.
                      </div>
                      <input value={bskyHandle} onChange={(e) => setBskyHandle(e.target.value)} placeholder="handle.bsky.social" style={inputStyle} />
                      <input type="password" value={bskyAppPassword} onChange={(e) => setBskyAppPassword(e.target.value)} placeholder="App password (xxxx-xxxx-xxxx-xxxx)" style={inputStyle} />
                      <button
                        onClick={postToBluesky}
                        disabled={posting || !bskyHandle || !bskyAppPassword}
                        style={{
                          background: posting || !bskyHandle || !bskyAppPassword ? "#1e293b" : "linear-gradient(135deg, #0085ff, #0066cc)",
                          border: "none",
                          color: posting || !bskyHandle || !bskyAppPassword ? "#334155" : "#fff",
                          borderRadius: 8, padding: "11px", fontSize: 14,
                          cursor: posting || !bskyHandle || !bskyAppPassword ? "not-allowed" : "pointer",
                          fontFamily: "inherit", fontWeight: 700,
                        }}
                      >{posting ? "Posting..." : "🦋 Confirm Post to BlueSky"}</button>
                      {postResult && (
                        <div style={{
                          borderRadius: 8, padding: "10px 14px",
                          background: postResult.success ? "#052e16" : "#1c0a0a",
                          border: "1px solid " + (postResult.success ? "#16a34a" : "#991b1b"),
                          color: postResult.success ? "#22c55e" : "#ef4444",
                          fontSize: 13,
                        }}>
                          {postResult.success ? "✅ Posted successfully to BlueSky!" : "❌ " + postResult.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={reset}
                  style={{ background: "transparent", border: "1px solid #1e293b", color: "#475569", borderRadius: 8, padding: "10px 22px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}
                >← New Rumor</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
