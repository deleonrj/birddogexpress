// pages/index.js
import { useState, useCallback, useEffect, useRef } from "react";

const VERDICT_CONFIG = {
  CORROBORATED: { label: "Corroborated",         color: "#3B6D11", bg: "#EAF3DE", border: "#639922" },
  PLAUSIBLE:    { label: "Plausible",             color: "#854F0B", bg: "#FAEEDA", border: "#EF9F27" },
  WEAK:         { label: "Weak / Speculative",    color: "#633806", bg: "#FAEEDA", border: "#BA7517" },
  REFUTED:      { label: "Refuted",               color: "#791F1F", bg: "#FCEBEB", border: "#F09595" },
  UNVERIFIED:   { label: "Unverified",            color: "#854F0B", bg: "#FAEEDA", border: "#EF9F27" },
};

const CLASSIFICATION_CONFIG = {
  REPORTER_LED: { label: "Reporter-led", color: "#085041", bg: "#E1F5EE", border: "#5DCAA5" },
  CORROBORATED: { label: "Corroborated", color: "#27500A", bg: "#EAF3DE", border: "#97C459" },
  FAN_DRIVEN:   { label: "Fan-driven",   color: "#791F1F", bg: "#FCEBEB", border: "#F09595" },
  NOISE:        { label: "Noise",        color: "#444441", bg: "#F1EFE8", border: "#B4B2A9" },
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

const STEPS = [
  { key: "received",    label: "Rumor received",              detail: (r) => r.length > 60 ? r.substring(0, 60) + "…" : r },
  { key: "national",    label: "Searching national reporters", detail: () => "Passan · Rosenthal · Heyman · Feinsand · Nightengale · Morosi" },
  { key: "local",       label: "Checking local beat coverage", detail: () => "Origin beat · Destination beat · Regional outlets" },
  { key: "crossmarket", label: "Cross-referencing markets",    detail: () => "Comparing origin · destination · national signal..." },
  { key: "fit",         label: "Analyzing team fit",           detail: () => "Roster · Financial · Strategic · GM profile" },
  { key: "scoring",     label: "Scoring & classification",     detail: () => "Credibility · Fit · Sentiment · Overall likelihood" },
];

const STEP_SEQUENCE = ["received","national","local","crossmarket","fit","scoring"];

const mono = { fontFamily: "ui-monospace, 'Courier New', monospace" };

function Badge({ label, color, bg, border }) {
  return (
    <span style={{ ...mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 5, border: "0.5px solid " + border, background: bg, color, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Ring({ value, color, label, sublabel, discounted }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const displayColor = discounted ? "#B4B2A9" : color;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 9, ...mono, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 5 }}>{label}</div>
      <div style={{ position: "relative", width: 44, height: 44, margin: "0 auto 4px" }}>
        <svg width="44" height="44" viewBox="0 0 44 44" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="22" cy="22" r={r} fill="none" stroke="#e5e7eb" strokeWidth="2.5" />
          <circle cx="22" cy="22" r={r} fill="none" stroke={displayColor} strokeWidth="2.5" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 11, fontWeight: 500, color: displayColor }}>{value}</div>
      </div>
      <div style={{ fontSize: 9, color: "#999", ...mono }}>{sublabel}{discounted ? " ↓" : ""}</div>
    </div>
  );
}

function Panel({ children, style }) {
  return (
    <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12, padding: "14px 16px", ...style }}>
      {children}
    </div>
  );
}

function PanelTitle({ children }) {
  return <div style={{ fontSize: 9, ...mono, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>{children}</div>;
}

function SourceRow({ name, context, status, last }) {
  const s = status === "Reported" ? { bg: "#EAF3DE", color: "#3B6D11" } : { bg: "#F1EFE8", color: "#5F5E5A" };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: last ? "none" : "0.5px solid #f3f4f6" }}>
      <div>
        <div style={{ fontSize: 11, ...mono, color: "#111" }}>{name}</div>
        <div style={{ fontSize: 9, ...mono, color: "#999", textTransform: "uppercase", marginTop: 1 }}>{context}</div>
      </div>
      <span style={{ fontSize: 9, ...mono, textTransform: "uppercase", padding: "2px 6px", borderRadius: 4, background: s.bg, color: s.color }}>{status}</span>
    </div>
  );
}

function MarketRow({ label, context, status, note, last }) {
  const dot = status === "Confirmed" ? "#639922" : status === "Partial" || status === "Elevated" ? "#BA7517" : "#A32D2D";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "6px 0", borderBottom: last ? "none" : "0.5px solid #f3f4f6", gap: 6 }}>
      <div>
        <div style={{ fontSize: 11, ...mono, color: "#111" }}>{label}</div>
        <div style={{ fontSize: 9, ...mono, color: "#999", textTransform: "uppercase", marginTop: 1 }}>{context}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 11, ...mono, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end", color: "#111" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: dot, display: "inline-block", flexShrink: 0 }} />
          {status}
        </div>
        {note && <div style={{ fontSize: 9, ...mono, color: "#999", marginTop: 1 }}>{note}</div>}
      </div>
    </div>
  );
}

function ProgressSteps({ rumor, activeStep, elapsed }) {
  const activeIdx = STEP_SEQUENCE.indexOf(activeStep);
  return (
    <Panel>
      <PanelTitle>Validating rumor</PanelTitle>
      {STEPS.map((step, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        const pending = i > activeIdx;
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: i < STEPS.length - 1 ? "0.5px solid #f3f4f6" : "none" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", background: done ? "#EAF3DE" : active ? "#f3f4f6" : "#f9fafb", border: done ? "none" : "0.5px solid #e5e7eb" }}>
              {done && <span style={{ fontSize: 10, color: "#3B6D11" }}>✓</span>}
              {active && (
                <div style={{ width: 10, height: 10, border: "1.5px solid #e5e7eb", borderTopColor: "#111", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              )}
              {pending && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#d1d5db", display: "block" }} />}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: active ? 500 : 400, color: pending ? "#999" : "#111", marginBottom: 2 }}>{step.label}</div>
              <div style={{ fontSize: 10, ...mono, color: active ? "#111" : "#bbb" }}>{step.detail(rumor)}</div>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 10, ...mono, color: "#ccc", textAlign: "center", marginTop: 12, letterSpacing: "0.06em" }}>
        Scanning · {elapsed}s elapsed
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Panel>
  );
}

export default function BirdDogExpress() {
  const [step, setStep] = useState("input");
  const [rumor, setRumor] = useState("");
  const [validation, setValidation] = useState(null);
  const [activeStep, setActiveStep] = useState("received");
  const [elapsed, setElapsed] = useState(0);
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
  const timerRef = useRef(null);
  const startRef = useRef(null);

  // Step auto-advance during validation (fallback if SSE status messages are sparse)
  const STEP_TIMINGS = { received: 0, national: 2, local: 6, crossmarket: 10, fit: 16, scoring: 22 };

  useEffect(() => {
    if (step === "validating") {
      startRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startRef.current) / 1000);
        setElapsed(secs);
        const newStep = [...STEP_SEQUENCE].reverse().find(k => secs >= STEP_TIMINGS[k]);
        if (newStep) setActiveStep(newStep);
      }, 500);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [step]);

  const validate = useCallback(async () => {
    if (!rumor.trim()) return;
    setStep("validating");
    setValidation(null);
    setPostResult(null);
    setErrorMsg(null);
    setTeamRecords({});
    setActiveStep("received");

    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rumor }),
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
            if (payload.message) {
              const msgLower = payload.message.toLowerCase();
              if (msgLower.includes("scan")) setActiveStep("national");
              if (msgLower.includes("analyz")) setActiveStep("crossmarket");
            }
            if (payload.success === true && payload.data) {
              const parsed = payload.data;
              if (!VERDICT_CONFIG[parsed.verdict]) parsed.verdict = "UNVERIFIED";
              setActiveStep("scoring");
              setTimeout(() => {
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
              }, 600);
            }
            if (payload.success === false && payload.error) throw new Error(payload.error);
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes("JSON")) throw parseErr;
          }
        }
      }
    } catch (err) {
      setErrorMsg(err.message);
      setStep("error");
    }
  }, [rumor]);

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
    setStep("input"); setValidation(null); setTweet("");
    setPostResult(null); setShowBskyForm(false); setErrorMsg(null);
  };

  const cfg = validation ? (VERDICT_CONFIG[validation.verdict] || VERDICT_CONFIG.UNVERIFIED) : null;
  const classifyCfg = validation?.rumor_classification ? (CLASSIFICATION_CONFIG[validation.rumor_classification] || null) : null;
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const inputBase = {
    width: "100%", boxSizing: "border-box",
    background: "#f9fafb", border: "0.5px solid #e5e7eb",
    borderRadius: 8, color: "#111", fontSize: 13,
    padding: "10px 12px", fontFamily: "inherit", outline: "none",
  };

  // Responsive: split on wide, stack on narrow
  const isWide = typeof window !== "undefined" && window.innerWidth >= 768;
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const check = () => setWide(window.innerWidth >= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const rightContent = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {step === "input" && (
        <Panel style={{ border: "none", background: "transparent" }}>
          <div style={{ textAlign: "center", padding: "40px 0", color: "#ccc" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚾</div>
            <div style={{ fontSize: 13, ...mono, letterSpacing: "0.08em" }}>Results will appear here</div>
          </div>
        </Panel>
      )}

      {step === "validating" && (
        <ProgressSteps rumor={rumor} activeStep={activeStep} elapsed={elapsed} />
      )}

      {step === "error" && (
        <>
          <Panel style={{ border: "0.5px solid #F09595", background: "#FCEBEB" }}>
            <div style={{ fontSize: 13, color: "#791F1F", fontWeight: 500, marginBottom: 6 }}>Validation failed</div>
            <div style={{ fontSize: 11, color: "#A32D2D", ...mono, lineHeight: 1.6, wordBreak: "break-all" }}>{errorMsg}</div>
          </Panel>
          {!wide && <button onClick={reset} style={{ background: "transparent", border: "0.5px solid #e5e7eb", color: "#999", borderRadius: 8, padding: "8px 18px", fontSize: 11, cursor: "pointer", ...mono, alignSelf: "flex-start" }}>← Try again</button>}
        </>
      )}

      {step === "result" && validation && cfg && (
        <>
          <Panel style={{ background: "#f9fafb" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#111", lineHeight: 1.5, marginBottom: 3 }}>
                  {rumor.length > 90 ? rumor.substring(0, 90) + "…" : rumor}
                </div>
                <div style={{ fontSize: 10, ...mono, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em" }}>Trade rumor · {today}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <Badge {...cfg} />
                {classifyCfg && <Badge {...classifyCfg} />}
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, ...mono, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Overall score</div>
                  <div style={{ fontSize: 24, fontWeight: 500, ...mono, color: cfg.color, lineHeight: 1 }}>{validation.overall_likelihood}</div>
                  <div style={{ width: 80, height: 2, background: "#e5e7eb", borderRadius: 2, overflow: "hidden", marginTop: 4, marginLeft: "auto" }}>
                    <div style={{ height: "100%", background: cfg.color, borderRadius: 2, width: validation.overall_likelihood + "%" }} />
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {validation.rumor_classification === "FAN_DRIVEN" && (
            <Panel style={{ background: "#FAEEDA", border: "0.5px solid #EF9F27" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 13, marginTop: 1, flexShrink: 0 }}>ⓘ</span>
                <div style={{ fontSize: 11, color: "#633806", lineHeight: 1.6 }}>
                  <strong style={{ color: "#412402", fontWeight: 500 }}>Fan-driven signal detected.</strong> High fan interest without reporter corroboration is a noise indicator. Sentiment discounted from overall score.
                </div>
              </div>
            </Panel>
          )}

          <Panel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
              <Ring value={validation.credibility_score} color={cfg.color} label="Credibility" sublabel="Source weight" />
              <Ring value={validation.fit_score} color={cfg.color} label="Fit" sublabel="Team alignment" />
              <Ring value={validation.sentiment_score || 0} color={cfg.color} label="Sentiment" sublabel="Market signal" discounted={validation.sentiment_discounted} />
            </div>
          </Panel>

          <Panel>
            <PanelTitle>Analysis summary</PanelTitle>
            <p style={{ fontSize: 12, lineHeight: 1.75, color: "#444", margin: 0 }}>{validation.summary}</p>
          </Panel>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Panel>
              <PanelTitle>Sources checked</PanelTitle>
              {validation.sources_found?.length > 0
                ? validation.sources_found.slice(0, 5).map((s, i, arr) => {
                    const parts = s.split(" - ");
                    const hasReport = !s.toLowerCase().includes("not found") && !s.toLowerCase().includes("no report");
                    return <SourceRow key={i} name={parts[0] || s} context={parts[1] || ""} status={hasReport ? "Reported" : "No report"} last={i === arr.length - 1} />;
                  })
                : <div style={{ fontSize: 11, color: "#999" }}>No sources found.</div>
              }
            </Panel>
            <Panel>
              <PanelTitle>Cross-market coverage</PanelTitle>
              {(() => {
                const cm = validation.cross_market;
                if (!cm) return (
                  <>
                    <MarketRow label="National media" context="ESPN, Athletic, MLB.com" status={validation.national?.toLowerCase().includes("no") ? "Silent" : "Partial"} note="" />
                    <MarketRow label="Origin beat" context="Local coverage" status={validation.origin_market?.toLowerCase().includes("no credible") ? "Silent" : "Partial"} note="" />
                    <MarketRow label="Destination beat" context="Local coverage" status={validation.destination_market?.toLowerCase().includes("no credible") ? "Silent" : "Partial"} note="" />
                    <MarketRow label="Social sentiment" context="Fan vs. credible" status={validation.sentiment_discounted ? "Elevated" : "Low"} note={validation.sentiment_discounted ? "Fan-driven · discounted" : ""} last />
                  </>
                );
                const natStatus = cm.national_media?.status === "CONFIRMED" ? "Confirmed" : cm.national_media?.status === "PARTIAL" ? "Partial" : "Silent";
                return (
                  <>
                    <MarketRow label="National media" context="ESPN, Athletic, MLB.com" status={natStatus} note={cm.national_media ? `${cm.national_media.reporters_count} of ${cm.national_media.of_total}` : ""} />
                    <MarketRow label="Origin beat" context={cm.origin_beat?.outlet || "Local"} status={cm.origin_beat?.status === "CONFIRMED" ? "Confirmed" : "Silent"} note="" />
                    <MarketRow label="Destination beat" context={cm.destination_beat?.outlet || "Local"} status={cm.destination_beat?.status === "CONFIRMED" ? "Confirmed" : "Silent"} note="" />
                    <MarketRow label="Social sentiment" context="Fan vs. credible" status={validation.sentiment_discounted ? "Elevated" : "Low"} note={validation.sentiment_discounted ? "Fan-driven · discounted" : ""} last />
                  </>
                );
              })()}
            </Panel>
          </div>

          {Object.keys(teamRecords).length > 0 && (() => {
            const allText = [validation.summary, validation.origin_market, validation.destination_market].join(" ").toLowerCase();
            const found = MLB_TEAMS.filter((t) => allText.includes(t)).map((t) => teamRecords[t]).filter(Boolean).filter((v, i, a) => a.findIndex((x) => x.fullName === v.fullName) === i);
            if (!found.length) return null;
            return (
              <Panel>
                <PanelTitle>Live standings · {today}</PanelTitle>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {found.map((t) => (
                    <div key={t.fullName} style={{ background: "#f9fafb", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "7px 14px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, ...mono, color: "#999", marginBottom: 2 }}>{t.fullName}</div>
                      <div style={{ fontSize: 18, fontWeight: 500, ...mono, color: "#111" }}>{t.record}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })()}

          {validation.fit_analysis && (
            <Panel>
              <PanelTitle>Fit analysis</PanelTitle>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, ...mono }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", paddingBottom: 6, fontWeight: 400, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#999" }}>Metric</th>
                    <th style={{ textAlign: "left", paddingBottom: 6, fontWeight: 400, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#999" }}>Finding</th>
                  </tr>
                </thead>
                <tbody>
                  {[["Roster", "roster"], ["Financial", "financial"], ["Strategic", "strategic"], ["GM / Front office", "gm_profile"]].map(([lbl, key], i) => {
                    const val = validation.fit_analysis[key];
                    if (!val || val === "—") return null;
                    return (
                      <tr key={key} style={{ borderTop: i === 0 ? "none" : "0.5px solid #f3f4f6" }}>
                        <td style={{ padding: "6px 0", color: "#111", width: 100, verticalAlign: "top" }}>{lbl}</td>
                        <td style={{ padding: "6px 0", color: "#666", lineHeight: 1.6 }}>{val}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel>
            <PanelTitle>Reasoning</PanelTitle>
            <p style={{ fontSize: 12, lineHeight: 1.75, color: "#444", margin: 0 }}>{validation.reasoning}</p>
            {validation.qc_footer && (
              <div style={{ fontSize: 10, color: "#ccc", ...mono, marginTop: 10, paddingTop: 8, borderTop: "0.5px solid #f3f4f6" }}>{validation.qc_footer}</div>
            )}
          </Panel>

          <Panel>
            <PanelTitle>Post text</PanelTitle>
            <textarea value={tweet} onChange={(e) => setTweet(e.target.value)} rows={3} style={{ ...inputBase, resize: "vertical", lineHeight: 1.6, marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, ...mono, color: (280 - tweet.length) < 0 ? "#A32D2D" : "#999" }}>{280 - tweet.length} remaining</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => { navigator.clipboard.writeText(tweet); setCopyLabel("Copied!"); setTimeout(() => setCopyLabel("Copy text"), 2000); }}
                style={{ background: "transparent", border: "0.5px solid #e5e7eb", color: "#666", borderRadius: 6, padding: "6px 12px", fontSize: 11, cursor: "pointer", ...mono }}>
                {copyLabel}
              </button>
              <button onClick={() => setShowBskyForm(!showBskyForm)} disabled={tweet.length > 280}
                style={{ background: tweet.length > 280 ? "#e5e7eb" : "#111", border: "none", color: tweet.length > 280 ? "#999" : "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 11, cursor: tweet.length > 280 ? "not-allowed" : "pointer", ...mono, fontWeight: 500 }}>
                Post to BlueSky
              </button>
            </div>
            {showBskyForm && (
              <div style={{ marginTop: 12, background: "#f9fafb", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: "#999", lineHeight: 1.6 }}>Credentials used only for this post, never stored. Generate an App Password in BlueSky → Settings → App Passwords.</div>
                <input value={bskyHandle} onChange={(e) => setBskyHandle(e.target.value)} placeholder="handle.bsky.social" style={inputBase} />
                <input type="password" value={bskyAppPassword} onChange={(e) => setBskyAppPassword(e.target.value)} placeholder="App password (xxxx-xxxx-xxxx-xxxx)" style={inputBase} />
                <button onClick={postToBluesky} disabled={posting || !bskyHandle || !bskyAppPassword}
                  style={{ background: posting || !bskyHandle || !bskyAppPassword ? "#e5e7eb" : "#111", border: "none", color: posting || !bskyHandle || !bskyAppPassword ? "#999" : "#fff", borderRadius: 8, padding: 10, fontSize: 12, cursor: posting || !bskyHandle || !bskyAppPassword ? "not-allowed" : "pointer", ...mono, fontWeight: 500 }}>
                  {posting ? "Posting..." : "Confirm post to BlueSky"}
                </button>
                {postResult && (
                  <div style={{ borderRadius: 8, padding: "8px 12px", background: postResult.success ? "#EAF3DE" : "#FCEBEB", border: "0.5px solid " + (postResult.success ? "#639922" : "#F09595"), color: postResult.success ? "#3B6D11" : "#791F1F", fontSize: 11 }}>
                    {postResult.success ? "Posted successfully to BlueSky." : postResult.error}
                  </div>
                )}
              </div>
            )}
          </Panel>

          {!wide && (
            <button onClick={reset} style={{ background: "transparent", border: "0.5px solid #e5e7eb", color: "#999", borderRadius: 8, padding: "8px 18px", fontSize: 11, cursor: "pointer", ...mono, alignSelf: "flex-start" }}>
              ← New rumor
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", color: "#111", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "0.5px solid #e5e7eb", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, ...mono, letterSpacing: "0.1em", color: "#111" }}>BIRDDOG EXPRESS</div>
          <div style={{ fontSize: 10, ...mono, letterSpacing: "0.16em", color: "#999", textTransform: "uppercase", marginTop: 1 }}>AI-powered rumor validation</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["tracker", "history"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              ...mono, fontSize: 11, padding: "5px 12px", borderRadius: 6,
              border: "0.5px solid", borderColor: activeTab === tab ? "#d1d5db" : "#e5e7eb",
              background: activeTab === tab ? "#f3f4f6" : "transparent",
              color: activeTab === tab ? "#111" : "#999", cursor: "pointer",
              textTransform: "capitalize", letterSpacing: "0.08em",
            }}>
              {tab === "history" ? `History (${history.length})` : "Tracker"}
            </button>
          ))}
        </div>
      </div>

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px" }}>
          <div style={{ fontSize: 10, ...mono, color: "#999", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>Recent validations</div>
          {history.length === 0
            ? <Panel><div style={{ textAlign: "center", color: "#ccc", padding: "40px 0", fontSize: 13 }}>No rumors validated yet.</div></Panel>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map((h) => {
                  const hc = VERDICT_CONFIG[h.verdict] || VERDICT_CONFIG.UNVERIFIED;
                  const hcl = h.classification ? (CLASSIFICATION_CONFIG[h.classification] || null) : null;
                  return (
                    <Panel key={h.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: "#111", marginBottom: 3 }}>{h.rumor}</div>
                          <div style={{ fontSize: 10, ...mono, color: "#999" }}>{h.timestamp}</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          <Badge {...hc} />
                          {hcl && <Badge {...hcl} />}
                          <div style={{ fontSize: 10, ...mono, color: "#999", display: "flex", gap: 8 }}>
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
        wide ? (
          // ── WIDE: 30/70 split ─────────────────────────────────────────────
          <div style={{ display: "grid", gridTemplateColumns: "30% 70%", minHeight: "calc(100vh - 57px)" }}>
            <div style={{ background: "#fff", borderRight: "0.5px solid #e5e7eb", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 500, color: "#111", marginBottom: 5 }}>Validate a rumor</div>
                <div style={{ fontSize: 12, color: "#999", lineHeight: 1.65 }}>Paste any MLB trade or signing rumor. BirdDog checks it across national reporters, beat writers, and team markets.</div>
              </div>
              <textarea
                value={rumor}
                onChange={(e) => setRumor(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && rumor.trim()) validate(); }}
                placeholder="e.g. The Mets are in discussions with the Cubs about Cody Bellinger..."
                rows={8}
                style={{ ...inputBase, resize: "vertical", lineHeight: 1.7, flex: 1 }}
                onFocus={(e) => (e.target.style.borderColor = "#9ca3af")}
                onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")}
              />
              <button
                onClick={step === "result" ? reset : validate}
                disabled={step === "validating" || (!rumor.trim() && step !== "result")}
                style={{
                  background: step === "validating" ? "#e5e7eb" : "#111",
                  color: step === "validating" ? "#999" : "#fff",
                  border: "none", borderRadius: 8, padding: "11px",
                  fontSize: 13, fontWeight: 500, cursor: step === "validating" ? "not-allowed" : "pointer",
                  ...mono, letterSpacing: "0.06em", width: "100%",
                }}
              >
                {step === "validating" ? "Validating..." : step === "result" ? "← New rumor" : "Validate →"}
              </button>
            </div>
            <div style={{ padding: "24px 20px", overflowY: "auto" }}>
              {rightContent}
            </div>
          </div>
        ) : (
          // ── NARROW: stacked ───────────────────────────────────────────────
          <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {(step === "input" || step === "validating" || step === "error") && (
              <Panel>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 500, color: "#111", marginBottom: 4 }}>Validate a rumor</div>
                    <div style={{ fontSize: 12, color: "#999", lineHeight: 1.6 }}>Paste any MLB trade or signing rumor. BirdDog checks it across national reporters, beat writers, and team markets.</div>
                  </div>
                  <textarea
                    value={rumor}
                    onChange={(e) => setRumor(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && rumor.trim()) validate(); }}
                    placeholder="e.g. The Mets are in discussions with the Cubs about Cody Bellinger..."
                    rows={3}
                    style={{ ...inputBase, resize: "vertical", lineHeight: 1.7 }}
                    onFocus={(e) => (e.target.style.borderColor = "#9ca3af")}
                    onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")}
                  />
                  <button
                    onClick={validate}
                    disabled={!rumor.trim() || step === "validating"}
                    style={{
                      background: !rumor.trim() || step === "validating" ? "#e5e7eb" : "#111",
                      color: !rumor.trim() || step === "validating" ? "#999" : "#fff",
                      border: "none", borderRadius: 8, padding: "11px 20px",
                      fontSize: 13, fontWeight: 500, cursor: !rumor.trim() || step === "validating" ? "not-allowed" : "pointer",
                      ...mono, alignSelf: "flex-end", letterSpacing: "0.06em",
                    }}
                  >{step === "validating" ? "Validating..." : "Validate →"}</button>
                </div>
              </Panel>
            )}
            {rightContent}
          </div>
        )
      )}
    </div>
  );
}
