// pages/index.js
import { useState, useCallback, useRef } from "react";

const VERDICT_CONFIG = {
  CORROBORATED: { label: "Corroborated",             color: "#3B6D11", bg: "#EAF3DE", border: "#639922" },
  PLAUSIBLE:    { label: "Plausible",                 color: "#854F0B", bg: "#FAEEDA", border: "#EF9F27" },
  WEAK:         { label: "Weak / Speculative",        color: "#633806", bg: "#FAEEDA", border: "#BA7517" },
  REFUTED:      { label: "Refuted",                   color: "#791F1F", bg: "#FCEBEB", border: "#F09595" },
  UNVERIFIED:   { label: "Unverified",                color: "#854F0B", bg: "#FAEEDA", border: "#EF9F27" },
};

const CLASSIFICATION_CONFIG = {
  REPORTER_LED:  { label: "Reporter-led",  color: "#085041", bg: "#E1F5EE", border: "#5DCAA5" },
  CORROBORATED:  { label: "Corroborated",  color: "#27500A", bg: "#EAF3DE", border: "#97C459" },
  FAN_DRIVEN:    { label: "Fan-driven",    color: "#791F1F", bg: "#FCEBEB", border: "#F09595" },
  NOISE:         { label: "Noise",         color: "#444441", bg: "#F1EFE8", border: "#B4B2A9" },
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

const mono = { fontFamily: "ui-monospace, 'Courier New', monospace" };

function Badge({ label, color, bg, border }) {
  return (
    <span style={{
      ...mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
      padding: "4px 10px", borderRadius: 6, border: "0.5px solid " + border,
      background: bg, color, display: "inline-flex", alignItems: "center", gap: 4,
      whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function Ring({ value, color, label, sublabel, discounted }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const displayColor = discounted ? "#B4B2A9" : color;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 10, ...mono, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 6 }}>{label}</div>
      <div style={{ position: "relative", width: 54, height: 54, margin: "0 auto 5px" }}>
        <svg width="54" height="54" viewBox="0 0 54 54" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="27" cy="27" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3" />
          <circle cx="27" cy="27" r={r} fill="none" stroke={displayColor} strokeWidth="3"
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 13, fontWeight: 500, color: displayColor }}>{value}</div>
      </div>
      <div style={{ fontSize: 10, color: "#999", ...mono }}>{sublabel}{discounted ? " ↓" : ""}</div>
    </div>
  );
}

function PanelTitle({ icon, children }) {
  return (
    <div style={{ fontSize: 10, ...mono, letterSpacing: "0.14em", textTransform: "uppercase", color: "#888", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
      {icon && <span>{icon}</span>}{children}
    </div>
  );
}

function Panel({ children, style }) {
  return (
    <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12, padding: "1rem 1.25rem", ...style }}>
      {children}
    </div>
  );
}

function SourceRow({ name, context, status }) {
  const s = status === "Reported"
    ? { bg: "#EAF3DE", color: "#3B6D11" }
    : status === "Failed"
    ? { bg: "#FCEBEB", color: "#A32D2D" }
    : { bg: "#F1EFE8", color: "#5F5E5A" };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "0.5px solid #f3f4f6" }}>
      <div>
        <div style={{ fontSize: 11, ...mono, color: "#111" }}>{name}</div>
        <div style={{ fontSize: 9, ...mono, letterSpacing: "0.08em", color: "#999", textTransform: "uppercase", marginTop: 1 }}>{context}</div>
      </div>
      <span style={{ fontSize: 10, ...mono, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, background: s.bg, color: s.color }}>{status}</span>
    </div>
  );
}

function MarketRow({ label, context, status, note, last }) {
  const dot = status === "Confirmed" ? "#639922" : status === "Partial" ? "#BA7517" : status === "Elevated" ? "#BA7517" : "#A32D2D";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "9px 0", borderBottom: last ? "none" : "0.5px solid #f3f4f6", gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, ...mono, color: "#111" }}>{label}</div>
        <div style={{ fontSize: 9, ...mono, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>{context}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 11, ...mono, color: "#111", display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, display: "inline-block", flexShrink: 0 }} />
          {status}
        </div>
        {note && <div style={{ fontSize: 9, ...mono, color: "#999", marginTop: 1 }}>{note}</div>}
      </div>
    </div>
  );
}

export default function BirdDogExpress() {
  const [step, setStep] = useState("input");
  const [rumor, setRumor] = useState("");
  const [gptOutput, setGptOutput] = useState("");
  const [validation, setValidation] = useState(null);
  const [statusMsg, setStatusMsg] = useState("Scanning sources...");
  const [tweet, setTweet] = useState("");
  const [bskyHandle, setBskyHandle] = useState("");
  const [bskyAppPassword, setBskyAppPassword] = useState("");
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState(null);
  const [showBskyForm, setShowBskyForm] = useState(false);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("tracker");
  const [copyLabel, setCopyLabel] = useState("Copy text");
  const [errorMsg, setErrorMsg] = useState(null);
  const [teamRecords, setTeamRecords] = useState({});
  const abortRef = useRef(null);

  const validate = useCallback(async () => {
    if (!rumor.trim()) return;
    setStep("validating");
    setValidation(null);
    setPostResult(null);
    setErrorMsg(null);
    setTeamRecords({});
    setStatusMsg("Scanning sources...");

    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rumor, gptOutput }),
      });

      if (!res.ok) throw new Error("Validation failed (" + res.status + ")");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("event: ")) continue;
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));

            if (payload.message) setStatusMsg(payload.message);

            if (payload.success === true && payload.data) {
              const parsed = payload.data;
              if (!VERDICT_CONFIG[parsed.verdict]) parsed.verdict = "UNVERIFIED";
              setValidation(parsed);
              setTweet(parsed.tweet || "");
              if (payload.standings?.records) setTeamRecords(payload.standings.records);
              setStep("result");
              setHistory((prev) => [{
                id: Date.now(), rumor,
                verdict: parsed.verdict,
                classification: parsed.rumor_classification,
                credibility: parsed.credibility_score,
                fit: parsed.fit_score,
                overall: parsed.overall_likelihood,
                timestamp: new Date().toLocaleTimeString(),
              }, ...prev.slice(0, 9)]);
            }

            if (payload.success === false && payload.error) {
              throw new Error(payload.error);
            }
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes("JSON")) throw parseErr;
          }
        }
      }
    } catch (err) {
      setErrorMsg(err.message);
      setStep("error");
    }
  }, [rumor, gptOutput]);

  const postToBluesky = useCallback(async () => {
    if (!bskyHandle || !bskyAppPassword || !tweet) return;
    setPosting(true); setPostResult(null);
    try {
      const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: bskyHandle, password: bskyAppPassword }),
      });
      const session = await sessionRes.json();
      if (!session.accessJwt) throw new Error(session.message || "Auth failed");
      const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.accessJwt },
        body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record: { text: tweet, createdAt: new Date().toISOString(), langs: ["en-US"] } }),
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
  const classifyCfg = validation?.rumor_classification
    ? (CLASSIFICATION_CONFIG[validation.rumor_classification] || null) : null;

  const inputBase = {
    width: "100%", boxSizing: "border-box",
    background: "#f9fafb", border: "0.5px solid #e5e7eb",
    borderRadius: 8, color: "#111", fontSize: 14,
    padding: "11px 13px", fontFamily: "inherit", outline: "none",
  };

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", color: "#111", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "0.5px solid #e5e7eb", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, ...mono, letterSpacing: "0.1em", color: "#111" }}>BIRDDOG EXPRESS</div>
          <div style={{ fontSize: 11, ...mono, letterSpacing: "0.16em", color: "#999", textTransform: "uppercase", marginTop: 2 }}>AI-powered rumor validation</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["tracker", "history"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              ...mono, fontSize: 11, padding: "5px 14px", borderRadius: 6,
              border: "0.5px solid", letterSpacing: "0.08em",
              borderColor: activeTab === tab ? "#d1d5db" : "#e5e7eb",
              background: activeTab === tab ? "#f3f4f6" : "transparent",
              color: activeTab === tab ? "#111" : "#999",
              cursor: "pointer", textTransform: "capitalize",
            }}>
              {tab === "history" ? `History (${history.length})` : "Tracker"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px" }}>

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          <div>
            <div style={{ fontSize: 10, ...mono, color: "#999", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>Recent validations</div>
            {history.length === 0
              ? <Panel><div style={{ textAlign: "center", color: "#ccc", padding: "40px 0", fontSize: 14 }}>No rumors validated yet.</div></Panel>
              : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {history.map((h) => {
                    const hc = VERDICT_CONFIG[h.verdict] || VERDICT_CONFIG.UNVERIFIED;
                    const hcl = h.classification ? (CLASSIFICATION_CONFIG[h.classification] || null) : null;
                    return (
                      <Panel key={h.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: "#111", marginBottom: 4 }}>{h.rumor}</div>
                            <div style={{ fontSize: 11, ...mono, color: "#999" }}>{h.timestamp}</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                            <Badge {...hc} />
                            {hcl && <Badge {...hcl} />}
                            <div style={{ fontSize: 11, ...mono, color: "#999", display: "flex", gap: 8 }}>
                              <span>Cred: <b style={{ color: hc.color }}>{h.credibility}</b></span>
                              <span>Fit: <b style={{ color: hc.color }}>{h.fit}</b></span>
                              <span>Overall: <b style={{ color: hc.color }}>{h.overall}</b></span>
                            </div>
                          </div>
                        </div>
                      </Panel>
                    );
                  })}
                </div>
            }
          </div>
        )}

        {/* TRACKER TAB */}
        {activeTab === "tracker" && (
          <>
            {/* INPUT */}
            {step === "input" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Panel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 10, ...mono, color: "#999", letterSpacing: "0.14em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>MLB Rumor *</label>
                      <textarea value={rumor} onChange={(e) => setRumor(e.target.value)}
                        placeholder="e.g. The Mets are in serious discussions with the Cubs about a deal for Cody Bellinger..."
                        rows={3} style={{ ...inputBase, resize: "vertical", lineHeight: 1.6, fontSize: 14 }}
                        onFocus={(e) => (e.target.style.borderColor = "#9ca3af")}
                        onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, ...mono, color: "#999", letterSpacing: "0.14em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>
                        CustomGPT output <span style={{ color: "#ccc", textTransform: "none", letterSpacing: 0, fontSize: 10 }}>(optional)</span>
                      </label>
                      <textarea value={gptOutput} onChange={(e) => setGptOutput(e.target.value)}
                        placeholder="Paste prior CustomGPT output for additional context..."
                        rows={3} style={{ ...inputBase, resize: "vertical", lineHeight: 1.6, ...mono, fontSize: 12, color: "#666" }}
                        onFocus={(e) => (e.target.style.borderColor = "#9ca3af")}
                        onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                    </div>
                    <div style={{ background: "#f9fafb", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", fontSize: 11, ...mono, color: "#999", lineHeight: 1.8 }}>
                      Sources: Passan · Rosenthal · Heyman · Feinsand · Nightengale · Morosi · The Athletic · ESPN · MLB.com · Origin beat · Destination beat · GM profiling · Live standings
                    </div>
                    <button onClick={validate} disabled={!rumor.trim()} style={{
                      background: rumor.trim() ? "#111" : "#e5e7eb",
                      color: rumor.trim() ? "#fff" : "#999",
                      border: "none", borderRadius: 8, padding: "12px 24px",
                      fontSize: 13, fontWeight: 500, cursor: rumor.trim() ? "pointer" : "not-allowed",
                      ...mono, alignSelf: "flex-start", letterSpacing: "0.06em",
                    }}>Validate rumor</button>
                  </div>
                </Panel>
              </div>
            )}

            {/* VALIDATING */}
            {step === "validating" && (
              <Panel>
                <div style={{ textAlign: "center", padding: "48px 0" }}>
                  <div style={{
                    width: 48, height: 48, margin: "0 auto 20px",
                    border: "2px solid #e5e7eb", borderTopColor: "#111",
                    borderRadius: "50%", animation: "spin 0.8s linear infinite",
                  }} />
                  <div style={{ fontSize: 14, color: "#111", ...mono, letterSpacing: "0.08em", marginBottom: 6 }}>{statusMsg}</div>
                  <div style={{ fontSize: 11, color: "#999", ...mono }}>Origin · Destination · National · GM profile · Confidence caps</div>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              </Panel>
            )}

            {/* ERROR */}
            {step === "error" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Panel style={{ border: "0.5px solid #F09595", background: "#FCEBEB" }}>
                  <div style={{ fontSize: 13, color: "#791F1F", fontWeight: 500, marginBottom: 6 }}>Validation failed</div>
                  <div style={{ fontSize: 12, color: "#A32D2D", ...mono, lineHeight: 1.6, wordBreak: "break-all" }}>{errorMsg}</div>
                </Panel>
                <button onClick={reset} style={{ background: "transparent", border: "0.5px solid #e5e7eb", color: "#999", borderRadius: 8, padding: "9px 20px", fontSize: 12, cursor: "pointer", ...mono, alignSelf: "flex-start" }}>← Try again</button>
              </div>
            )}

            {/* RESULT */}
            {step === "result" && validation && cfg && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                {/* Hero card */}
                <Panel style={{ background: "#f9fafb" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" }}>
                    <div>
                      <div style={{ fontSize: 19, fontWeight: 500, ...mono, letterSpacing: "0.06em", color: "#111", marginBottom: 4 }}>
                        {rumor.length > 80 ? rumor.substring(0, 80) + "…" : rumor}
                      </div>
                      <div style={{ fontSize: 11, ...mono, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em" }}>Trade rumor · {today}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                      <Badge {...cfg} />
                      {classifyCfg && <Badge {...classifyCfg} />}
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, ...mono, color: "#999", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 3 }}>Overall score</div>
                        <div style={{ fontSize: 26, fontWeight: 500, ...mono, color: cfg.color, lineHeight: 1 }}>{validation.overall_likelihood}</div>
                        <div style={{ width: 90, height: 3, background: "#e5e7eb", borderRadius: 2, overflow: "hidden", marginTop: 5, marginLeft: "auto" }}>
                          <div style={{ height: "100%", background: cfg.color, borderRadius: 2, width: validation.overall_likelihood + "%" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </Panel>

                {/* Fan-driven insight banner */}
                {validation.rumor_classification === "FAN_DRIVEN" && (
                  <Panel style={{ background: "#FAEEDA", border: "0.5px solid #EF9F27" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 14, marginTop: 1, flexShrink: 0 }}>ⓘ</span>
                      <div style={{ fontSize: 12, color: "#633806", lineHeight: 1.6 }}>
                        <strong style={{ color: "#412402", fontWeight: 500 }}>Fan-driven signal detected.</strong> Social sentiment is elevated but source credibility is low. High fan interest without reporter corroboration is a noise indicator, not a deal signal. Sentiment has been discounted from the overall score.
                      </div>
                    </div>
                  </Panel>
                )}

                {/* Score rings */}
                <Panel>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    <Ring value={validation.credibility_score} color={cfg.color} label="Credibility" sublabel="Source weight" />
                    <Ring value={validation.fit_score} color={cfg.color} label="Fit" sublabel="Team alignment" />
                    <Ring value={validation.sentiment_score || 0} color={cfg.color} label="Sentiment" sublabel="Market signal" discounted={validation.sentiment_discounted} />
                  </div>
                </Panel>

                {/* Analysis summary */}
                <Panel>
                  <PanelTitle icon="📄">Analysis summary</PanelTitle>
                  <p style={{ fontSize: 13, lineHeight: 1.75, color: "#444", margin: 0 }}>{validation.summary}</p>
                </Panel>

                {/* Sources + Cross-market */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Panel>
                    <PanelTitle icon="🔍">Sources checked</PanelTitle>
                    {validation.sources_found?.length > 0
                      ? validation.sources_found.slice(0, 5).map((s, i) => {
                          const parts = s.split(" - ");
                          const name = parts[0] || s;
                          const outlet = parts[1] || "";
                          const hasReport = !s.toLowerCase().includes("not found") && !s.toLowerCase().includes("no report");
                          return <SourceRow key={i} name={name} context={outlet} status={hasReport ? "Reported" : "No report"} />;
                        })
                      : <div style={{ fontSize: 12, color: "#999" }}>No sources found.</div>
                    }
                  </Panel>
                  <Panel>
                    <PanelTitle icon="📊">Cross-market coverage</PanelTitle>
                    {(() => {
                      const cm = validation.cross_market;
                      if (!cm) return (
                        <>
                          <MarketRow label="National media" context="ESPN, Athletic, MLB.com" status={validation.national?.toLowerCase().includes("no") ? "Silent" : "Partial"} note="" />
                          <MarketRow label="Origin beat" context="Local coverage" status={validation.origin_market?.toLowerCase().includes("no credible") ? "Silent" : "Partial"} note="" />
                          <MarketRow label="Destination beat" context="Local coverage" status={validation.destination_market?.toLowerCase().includes("no credible") ? "Silent" : "Partial"} note="" />
                          <MarketRow label="Social sentiment" context="Fan vs. credible signal" status={validation.sentiment_discounted ? "Elevated" : "Low"} note={validation.sentiment_discounted ? "Fan-driven · discounted" : ""} last />
                        </>
                      );
                      const natStatus = cm.national_media?.status === "CONFIRMED" ? "Confirmed" : cm.national_media?.status === "PARTIAL" ? "Partial" : "Silent";
                      const natNote = cm.national_media ? `${cm.national_media.reporters_count} of ${cm.national_media.of_total} reporting` : "";
                      return (
                        <>
                          <MarketRow label="National media" context="ESPN, Athletic, MLB.com" status={natStatus} note={natNote} />
                          <MarketRow label="Origin beat" context={cm.origin_beat?.outlet || "Local coverage"} status={cm.origin_beat?.status === "CONFIRMED" ? "Confirmed" : "Silent"} note="" />
                          <MarketRow label="Destination beat" context={cm.destination_beat?.outlet || "Local coverage"} status={cm.destination_beat?.status === "CONFIRMED" ? "Confirmed" : "Silent"} note="" />
                          <MarketRow label="Social sentiment" context="Fan vs. credible signal" status={validation.sentiment_discounted ? "Elevated" : "Low"} note={validation.sentiment_discounted ? "Fan-driven · discounted" : ""} last />
                        </>
                      );
                    })()}
                  </Panel>
                </div>

                {/* Live team records */}
                {Object.keys(teamRecords).length > 0 && (() => {
                  const allText = [validation.summary, validation.origin_market, validation.destination_market].join(" ").toLowerCase();
                  const found = MLB_TEAMS.filter((t) => allText.includes(t)).map((t) => teamRecords[t]).filter(Boolean).filter((v, i, a) => a.findIndex((x) => x.fullName === v.fullName) === i);
                  if (found.length === 0) return null;
                  return (
                    <Panel>
                      <PanelTitle icon="📅">Live standings · {today}</PanelTitle>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {found.map((t) => (
                          <div key={t.fullName} style={{ background: "#f9fafb", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "8px 16px", textAlign: "center" }}>
                            <div style={{ fontSize: 11, ...mono, color: "#999", marginBottom: 2 }}>{t.fullName}</div>
                            <div style={{ fontSize: 20, fontWeight: 500, ...mono, color: "#111" }}>{t.record}</div>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  );
                })()}

                {/* Fit analysis */}
                {validation.fit_analysis && (
                  <Panel>
                    <PanelTitle icon="⚙️">Fit analysis</PanelTitle>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, ...mono }}>
                      <thead>
                        <tr style={{ color: "#999" }}>
                          <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 400, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Metric</th>
                          <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 400, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Finding</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[["Roster", "roster"], ["Financial", "financial"], ["Strategic", "strategic"], ["GM / Front office", "gm_profile"]].map(([lbl, key], i) => {
                          const val = validation.fit_analysis[key];
                          if (!val || val === "—") return null;
                          return (
                            <tr key={key} style={{ borderTop: i === 0 ? "none" : "0.5px solid #f3f4f6" }}>
                              <td style={{ padding: "7px 0", color: "#111", width: 110, verticalAlign: "top" }}>{lbl}</td>
                              <td style={{ padding: "7px 0", color: "#666", lineHeight: 1.6 }}>{val}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Panel>
                )}

                {/* Reasoning */}
                <Panel>
                  <PanelTitle icon="💬">Reasoning</PanelTitle>
                  <p style={{ fontSize: 13, lineHeight: 1.75, color: "#444", margin: 0 }}>{validation.reasoning}</p>
                  {validation.qc_footer && (
                    <div style={{ fontSize: 10, color: "#ccc", ...mono, marginTop: 12, paddingTop: 10, borderTop: "0.5px solid #f3f4f6" }}>{validation.qc_footer}</div>
                  )}
                </Panel>

                {/* Post editor */}
                <Panel>
                  <PanelTitle icon="✉️">Post text</PanelTitle>
                  <textarea value={tweet} onChange={(e) => setTweet(e.target.value)} rows={4}
                    style={{ ...inputBase, resize: "vertical", lineHeight: 1.6, marginBottom: 10 }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 11, ...mono, color: (280 - tweet.length) < 0 ? "#A32D2D" : "#999" }}>{280 - tweet.length} chars remaining</span>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => { navigator.clipboard.writeText(tweet); setCopyLabel("Copied!"); setTimeout(() => setCopyLabel("Copy text"), 2000); }}
                      style={{ background: "transparent", border: "0.5px solid #e5e7eb", color: "#666", borderRadius: 7, padding: "7px 14px", fontSize: 11, cursor: "pointer", ...mono }}>
                      {copyLabel}
                    </button>
                    <button onClick={() => setShowBskyForm(!showBskyForm)} disabled={tweet.length > 280}
                      style={{ background: tweet.length > 280 ? "#e5e7eb" : "#111", border: "none", color: tweet.length > 280 ? "#999" : "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 11, cursor: tweet.length > 280 ? "not-allowed" : "pointer", ...mono, fontWeight: 500 }}>
                      Post to BlueSky
                    </button>
                  </div>

                  {showBskyForm && (
                    <div style={{ marginTop: 14, background: "#f9fafb", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 11, color: "#999", lineHeight: 1.6 }}>Credentials used only for this post, never stored. Generate an App Password in BlueSky → Settings → Privacy and Security → App Passwords.</div>
                      <input value={bskyHandle} onChange={(e) => setBskyHandle(e.target.value)} placeholder="handle.bsky.social" style={inputBase} />
                      <input type="password" value={bskyAppPassword} onChange={(e) => setBskyAppPassword(e.target.value)} placeholder="App password (xxxx-xxxx-xxxx-xxxx)" style={inputBase} />
                      <button onClick={postToBluesky} disabled={posting || !bskyHandle || !bskyAppPassword}
                        style={{ background: posting || !bskyHandle || !bskyAppPassword ? "#e5e7eb" : "#111", border: "none", color: posting || !bskyHandle || !bskyAppPassword ? "#999" : "#fff", borderRadius: 8, padding: 11, fontSize: 13, cursor: posting || !bskyHandle || !bskyAppPassword ? "not-allowed" : "pointer", ...mono, fontWeight: 500 }}>
                        {posting ? "Posting..." : "Confirm post to BlueSky"}
                      </button>
                      {postResult && (
                        <div style={{ borderRadius: 8, padding: "10px 14px", background: postResult.success ? "#EAF3DE" : "#FCEBEB", border: "0.5px solid " + (postResult.success ? "#639922" : "#F09595"), color: postResult.success ? "#3B6D11" : "#791F1F", fontSize: 12 }}>
                          {postResult.success ? "Posted successfully to BlueSky." : postResult.error}
                        </div>
                      )}
                    </div>
                  )}
                </Panel>

                <button onClick={reset} style={{ background: "transparent", border: "0.5px solid #e5e7eb", color: "#999", borderRadius: 8, padding: "9px 20px", fontSize: 11, cursor: "pointer", ...mono, alignSelf: "flex-start" }}>← New rumor</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
