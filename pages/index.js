// pages/index.js
import { useState, useCallback, useEffect, useRef } from "react";
import { Analytics } from "@vercel/analytics/react";

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
  { key: "received",    label: "Rumor received",               detail: (r) => r.length > 60 ? r.substring(0, 60) + "…" : r },
  { key: "national",    label: "Searching national reporters",  detail: () => "Passan · Rosenthal · Olney · Feinsand · Sammon · Nightengale · Morosi" },
  { key: "local",       label: "Checking local beat coverage",  detail: () => "Origin beat · Destination beat · Regional outlets" },
  { key: "crossmarket", label: "Cross-referencing markets",     detail: () => "Comparing origin · destination · national signal" },
  { key: "fit",         label: "Analyzing team fit",            detail: () => "Roster · Financial · Strategic · GM profile" },
  { key: "scoring",     label: "Scoring and classification",    detail: () => "Credibility · Fit · Sentiment · Overall likelihood" },
];
const STEP_SEQUENCE = ["received","national","local","crossmarket","fit","scoring"];
const STEP_TIMINGS  = { received:0, national:2, local:6, crossmarket:10, fit:16, scoring:22 };

const CHAR_LIMIT = 255;
const mono = { fontFamily: "ui-monospace, 'Courier New', monospace" };

const FOCUS_STYLE = `
  *:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; border-radius: 4px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
`;

function Badge({ label, color, bg, border }) {
  return (
    <span style={{ ...mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 5, border: "0.5px solid " + border, background: bg, color, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Ring({ value, color, label, sublabel, discounted }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const displayColor = discounted ? "#5F5E5A" : color;
  const pct = Math.round(value);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, ...mono, letterSpacing: "0.08em", textTransform: "uppercase", color: "#555", marginBottom: 5 }} aria-hidden="true">{label}</div>
      <div role="img" aria-label={`${label}: ${pct}%${discounted ? " (discounted — fan-driven signal)" : ""}`} style={{ position: "relative", width: 44, height: 44, margin: "0 auto 5px" }}>
        <svg width="44" height="44" viewBox="0 0 44 44" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
          <circle cx="22" cy="22" r={r} fill="none" stroke="#e5e7eb" strokeWidth="2.5" />
          <circle cx="22" cy="22" r={r} fill="none" stroke={displayColor} strokeWidth="2.5" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 12, fontWeight: 500, color: displayColor }} aria-hidden="true">{pct}</div>
      </div>
      <div style={{ fontSize: 11, color: "#666", ...mono }}>{sublabel}{discounted ? " (discounted)" : ""}</div>
    </div>
  );
}

function Panel({ children, style, as: Tag = "div" }) {
  return (
    <Tag style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12, padding: "14px 16px", ...style }}>
      {children}
    </Tag>
  );
}

function SectionHeading({ children }) {
  return (
    <h3 style={{ fontSize: 11, ...mono, letterSpacing: "0.12em", textTransform: "uppercase", color: "#666", marginBottom: 8, fontWeight: 500 }}>
      {children}
    </h3>
  );
}

function SourceRow({ name, context, status, last }) {
  const s = status === "Reported" ? { bg: "#EAF3DE", color: "#3B6D11" } : { bg: "#F1EFE8", color: "#5F5E5A" };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: last ? "none" : "0.5px solid #f3f4f6" }}>
      <div>
        <div style={{ fontSize: 12, ...mono, color: "#111" }}>{name}</div>
        <div style={{ fontSize: 11, color: "#777", marginTop: 1 }}>{context}</div>
      </div>
      <span style={{ fontSize: 11, ...mono, textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, background: s.bg, color: s.color, minWidth: 44, textAlign: "center" }}>{status}</span>
    </div>
  );
}

function MarketRow({ label, context, statusText, dotColor, note, last }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "8px 0", borderBottom: last ? "none" : "0.5px solid #f3f4f6", gap: 8 }}>
      <div>
        <div style={{ fontSize: 12, ...mono, color: "#111" }}>{label}</div>
        <div style={{ fontSize: 11, color: "#777", marginTop: 1 }}>{context}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 12, ...mono, display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end", color: "#111" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }} aria-hidden="true" />
          {statusText}
        </div>
        {note && <div style={{ fontSize: 11, color: "#777", marginTop: 1 }}>{note}</div>}
      </div>
    </div>
  );
}

function ProgressSteps({ rumor, activeStep, elapsed }) {
  const activeIdx = STEP_SEQUENCE.indexOf(activeStep);
  return (
    <Panel>
      <SectionHeading>Validating rumor</SectionHeading>
      <div role="status" aria-live="polite" aria-label={`Validation step: ${STEPS[activeIdx]?.label || "processing"}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
        {STEPS[activeIdx]?.label}
      </div>
      {STEPS.map((s, i) => {
        const done    = i < activeIdx;
        const active  = i === activeIdx;
        const pending = i > activeIdx;
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 0", borderBottom: i < STEPS.length - 1 ? "0.5px solid #f3f4f6" : "none" }}>
            <div aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", background: done ? "#EAF3DE" : "#f3f4f6", border: done ? "none" : "0.5px solid #e5e7eb" }}>
              {done   && <span style={{ fontSize: 11, color: "#3B6D11", fontWeight: 700 }}>✓</span>}
              {active && <div style={{ width: 10, height: 10, border: "1.5px solid #d1d5db", borderTopColor: "#111", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />}
              {pending && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#d1d5db", display: "block" }} />}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: active ? 500 : 400, color: pending ? "#aaa" : "#111", marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: active ? "#555" : "#ccc", ...mono }}>{s.detail(rumor)}</div>
            </div>
          </div>
        );
      })}
      <div aria-live="off" style={{ fontSize: 11, ...mono, color: "#bbb", textAlign: "center", marginTop: 12, letterSpacing: "0.06em" }}>
        Scanning · {elapsed}s elapsed
      </div>
    </Panel>
  );
}

export default function BirdDogExpress() {
  const [step, setStep]               = useState("input");
  const [rumor, setRumor]             = useState("");
  const [validation, setValidation]   = useState(null);
  const [activeStep, setActiveStep]   = useState("received");
  const [elapsed, setElapsed]         = useState(0);
  const [history, setHistory]         = useState([]);
  const [activeTab, setActiveTab]     = useState("tracker");
  const [errorMsg, setErrorMsg]       = useState(null);
  const [teamRecords, setTeamRecords] = useState({});
  const [wide, setWide]               = useState(false);
  const timerRef  = useRef(null);
  const startRef  = useRef(null);
  const resultRef = useRef(null);
  const rumorRef  = useRef(null);

  useEffect(() => {
    const check = () => setWide(window.innerWidth >= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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

  useEffect(() => {
    if (step === "result" && !wide && resultRef.current) resultRef.current.focus();
  }, [step, wide]);

  const validate = useCallback(async () => {
    if (!rumor.trim() || rumor.length > CHAR_LIMIT) return;
    setStep("validating");
    setValidation(null);
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
      const reader  = res.body.getReader();
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
              const m = payload.message.toLowerCase();
              if (m.includes("scan"))   setActiveStep("national");
              if (m.includes("analyz")) setActiveStep("crossmarket");
            }
            if (payload.success === true && payload.data) {
              const parsed = payload.data;
              if (!VERDICT_CONFIG[parsed.verdict]) parsed.verdict = "UNVERIFIED";
              setActiveStep("scoring");
              setTimeout(() => {
                setValidation(parsed);
                if (payload.standings?.records) setTeamRecords(payload.standings.records);
                setStep("result");
                setHistory(prev => [{
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

  const reset = () => {
    setStep("input"); setValidation(null);
    setErrorMsg(null);
    setTimeout(() => rumorRef.current?.focus(), 50);
  };

  const cfg         = validation ? (VERDICT_CONFIG[validation.verdict] || VERDICT_CONFIG.UNVERIFIED) : null;
  const classifyCfg = validation?.rumor_classification ? (CLASSIFICATION_CONFIG[validation.rumor_classification] || null) : null;
  const today       = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const remaining   = CHAR_LIMIT - rumor.length;
  const charColor   = remaining < 0 ? "#A32D2D" : remaining < 40 ? "#854F0B" : "#777";
  const canSubmit   = rumor.trim().length > 0 && remaining >= 0 && step !== "validating";

  const inputBase = {
    width: "100%", boxSizing: "border-box",
    background: "#f9fafb", border: "0.5px solid #e5e7eb",
    borderRadius: 8, color: "#111", fontSize: 14,
    padding: "10px 12px", fontFamily: "inherit", outline: "none", minHeight: 44,
  };

  const btnBase = {
    border: "none", borderRadius: 8, padding: "12px 20px",
    fontSize: 14, fontWeight: 500, cursor: "pointer",
    ...mono, letterSpacing: "0.06em",
    minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center",
  };

  function marketDot(status) {
    if (status === "Confirmed") return "#639922";
    if (status === "Partial" || status === "Elevated") return "#BA7517";
    return "#A32D2D";
  }

  const InputPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 500, color: "#111", marginBottom: 5 }}>Validate a rumor</div>
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.65 }}>
          Paste any MLB trade or signing rumor. BirdDog checks it across national reporters, beat writers, and both team markets.
        </div>
      </div>
      <div>
        <label htmlFor="rumor-input" style={{ display: "block", fontSize: 11, ...mono, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
          Rumor <span aria-hidden="true">*</span><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}> (required)</span>
        </label>
        <textarea
          id="rumor-input"
          ref={rumorRef}
          value={rumor}
          onChange={(e) => setRumor(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) validate(); }}
          placeholder="e.g. The Mets are in discussions with the Cubs about Cody Bellinger..."
          rows={4}
          maxLength={CHAR_LIMIT + 20}
          aria-describedby="char-count"
          aria-required="true"
          style={{ ...inputBase, resize: "vertical", lineHeight: 1.7, fontSize: 14 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 5 }}>
          <span id="char-count" aria-live="polite" style={{ fontSize: 11, ...mono, color: charColor }}>
            {remaining < 0 ? `${Math.abs(remaining)} over limit` : `${remaining} left`}
          </span>
        </div>
      </div>
      <hr style={{ border: "none", borderTop: "0.5px solid #e5e7eb", margin: 0 }} />
      <button
        onClick={step === "result" ? reset : validate}
        disabled={!canSubmit && step !== "result"}
        aria-disabled={!canSubmit && step !== "result"}
        aria-label={step === "validating" ? "Validation in progress" : step === "result" ? "Clear results and validate a new rumor" : "Validate this rumor"}
        style={{ ...btnBase, background: (!canSubmit && step !== "result") ? "#e5e7eb" : "#111", color: (!canSubmit && step !== "result") ? "#999" : "#fff", width: "100%" }}
      >
        {step === "validating" ? "Validating…" : step === "result" ? "← New rumor" : "Validate →"}
      </button>
    </div>
  );

  const ResultsPanel = (
    <div ref={resultRef} tabIndex={-1} aria-live="polite" aria-label="Validation results" style={{ display: "flex", flexDirection: "column", gap: 12, outline: "none" }}>
      {step === "input" && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#ccc" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }} aria-hidden="true">⚾</div>
          <div style={{ fontSize: 13, ...mono }}>Results will appear here</div>
        </div>
      )}

      {step === "validating" && <ProgressSteps rumor={rumor} activeStep={activeStep} elapsed={elapsed} />}

      {step === "error" && (
        <Panel role="alert">
          <SectionHeading>Error on the play.</SectionHeading>
          <p style={{ fontSize: 13, color: "#791F1F", ...mono, lineHeight: 1.6, wordBreak: "break-all", margin: 0 }}>{errorMsg}</p>
        </Panel>
      )}

      {step === "result" && validation && cfg && (
        <>
          <Panel style={{ background: "#f9fafb" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 500, color: "#111", lineHeight: 1.5, margin: "0 0 4px" }}>
                  {rumor.length > 100 ? rumor.substring(0, 100) + "…" : rumor}
                </p>
                <div style={{ fontSize: 11, ...mono, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>Trade rumor · {today}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7 }}>
                <Badge {...cfg} />
                {classifyCfg && <Badge {...classifyCfg} />}
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, ...mono, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Overall score</div>
                  <div style={{ fontSize: 24, fontWeight: 500, ...mono, color: cfg.color, lineHeight: 1 }} aria-label={`Overall score: ${validation.overall_likelihood} out of 100`}>{validation.overall_likelihood}</div>
                  <div style={{ width: 80, height: 3, background: "#e5e7eb", borderRadius: 2, overflow: "hidden", marginTop: 4, marginLeft: "auto" }} aria-hidden="true">
                    <div style={{ height: "100%", background: cfg.color, borderRadius: 2, width: validation.overall_likelihood + "%" }} />
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {validation.rumor_classification === "FAN_DRIVEN" && (
            <Panel style={{ background: "#FAEEDA", border: "0.5px solid #EF9F27" }} role="note">
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span aria-hidden="true" style={{ fontSize: 14, marginTop: 1, flexShrink: 0 }}>ⓘ</span>
                <p style={{ fontSize: 13, color: "#633806", lineHeight: 1.6, margin: 0 }}>
                  <strong style={{ color: "#412402", fontWeight: 500 }}>Fan-driven signal detected.</strong> High fan interest without reporter corroboration is a noise indicator, not a deal signal. Sentiment has been discounted from the overall score.
                </p>
              </div>
            </Panel>
          )}

          <Panel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              <Ring value={validation.credibility_score} color={cfg.color} label="Credibility" sublabel="Source weight" />
              <Ring value={validation.fit_score}         color={cfg.color} label="Fit"         sublabel="Team alignment" />
              <Ring value={validation.sentiment_score || 0} color={cfg.color} label="Sentiment" sublabel="Market signal" discounted={validation.sentiment_discounted} />
            </div>
          </Panel>

          <Panel>
            <SectionHeading>Analysis summary</SectionHeading>
            <p style={{ fontSize: 13, lineHeight: 1.75, color: "#444", margin: 0 }}>{validation.summary}</p>
          </Panel>

          <div style={{ display: "grid", gridTemplateColumns: wide ? "1fr 1fr" : "1fr", gap: 12 }}>
            <Panel>
              <SectionHeading>Sources checked</SectionHeading>
              {validation.sources_found?.length > 0
                ? validation.sources_found.slice(0, 5).map((s, i, arr) => {
                    const parts = s.split(" - ");
                    const hasReport = !s.toLowerCase().includes("not found") && !s.toLowerCase().includes("no report");
                    return <SourceRow key={i} name={parts[0] || s} context={parts[1] || ""} status={hasReport ? "Reported" : "No report"} last={i === arr.length - 1} />;
                  })
                : <p style={{ fontSize: 13, color: "#999", margin: 0 }}>Nobody's talking about this around the cooler.</p>
              }
            </Panel>
            <Panel>
              <SectionHeading>Cross-market coverage</SectionHeading>
              {(() => {
                const cm = validation.cross_market;
                if (!cm) {
                  const natSt  = validation.national?.toLowerCase().includes("no") ? "Silent" : "Partial";
                  const origSt = validation.origin_market?.toLowerCase().includes("no credible") ? "Silent" : "Partial";
                  const destSt = validation.destination_market?.toLowerCase().includes("no credible") ? "Silent" : "Partial";
                  const sentSt = validation.sentiment_discounted ? "Elevated" : "Low";
                  return (
                    <>
                      <MarketRow label="National media"   context="ESPN, Athletic, MLB.com" statusText={natSt}  dotColor={marketDot(natSt)}  note="" />
                      <MarketRow label="Origin beat"      context="Local coverage"          statusText={origSt} dotColor={marketDot(origSt)} note="" />
                      <MarketRow label="Destination beat" context="Local coverage"          statusText={destSt} dotColor={marketDot(destSt)} note="" />
                      <MarketRow label="Social sentiment" context="Fan vs. credible"        statusText={sentSt} dotColor={marketDot(sentSt)} note={validation.sentiment_discounted ? "Fan-driven · discounted" : ""} last />
                    </>
                  );
                }
                const natSt   = cm.national_media?.status === "CONFIRMED" ? "Confirmed" : cm.national_media?.status === "PARTIAL" ? "Partial" : "Silent";
                const natNote = cm.national_media ? `${cm.national_media.reporters_count} of ${cm.national_media.of_total} reporting` : "";
                const origSt  = cm.origin_beat?.status === "CONFIRMED" ? "Confirmed" : "Silent";
                const destSt  = cm.destination_beat?.status === "CONFIRMED" ? "Confirmed" : "Silent";
                const sentSt  = validation.sentiment_discounted ? "Elevated" : "Low";
                return (
                  <>
                    <MarketRow label="National media"   context="ESPN, Athletic, MLB.com"      statusText={natSt}  dotColor={marketDot(natSt)}  note={natNote} />
                    <MarketRow label="Origin beat"      context={cm.origin_beat?.outlet || "Local"}      statusText={origSt} dotColor={marketDot(origSt)} note="" />
                    <MarketRow label="Destination beat" context={cm.destination_beat?.outlet || "Local"} statusText={destSt} dotColor={marketDot(destSt)} note="" />
                    <MarketRow label="Social sentiment" context="Fan vs. credible"              statusText={sentSt} dotColor={marketDot(sentSt)} note={validation.sentiment_discounted ? "Fan-driven · discounted" : ""} last />
                  </>
                );
              })()}
            </Panel>
          </div>

          {Object.keys(teamRecords).length > 0 && (() => {
            const allText = [validation.summary, validation.origin_market, validation.destination_market].join(" ").toLowerCase();
            const found   = MLB_TEAMS.filter(t => allText.includes(t)).map(t => teamRecords[t]).filter(Boolean).filter((v,i,a) => a.findIndex(x => x.fullName === v.fullName) === i);
            if (!found.length) return null;
            return (
              <Panel>
                <SectionHeading>Live standings · {today}</SectionHeading>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {found.map(t => (
                    <div key={t.fullName} style={{ background: "#f9fafb", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "8px 14px", textAlign: "center", minWidth: 44 }}>
                      <div style={{ fontSize: 11, ...mono, color: "#777", marginBottom: 2 }}>{t.fullName}</div>
                      <div style={{ fontSize: 18, fontWeight: 500, ...mono, color: "#111" }}>{t.record}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })()}

          {validation.fit_analysis && (
            <Panel>
              <SectionHeading>Fit analysis</SectionHeading>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, ...mono, tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ textAlign: "left", paddingBottom: 8, fontWeight: 400, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888", width: "30%" }}>Metric</th>
                      <th scope="col" style={{ textAlign: "left", paddingBottom: 8, fontWeight: 400, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888" }}>Finding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[["Roster","roster"],["Financial","financial"],["Strategic","strategic"],["GM / Front office","gm_profile"]].map(([lbl,key],i) => {
                      const val = validation.fit_analysis[key];
                      if (!val || val === "—") return null;
                      return (
                        <tr key={key} style={{ borderTop: i === 0 ? "none" : "0.5px solid #f3f4f6" }}>
                          <th scope="row" style={{ padding: "8px 0", color: "#111", verticalAlign: "top", fontWeight: 500, textAlign: "left" }}>{lbl}</th>
                          <td style={{ padding: "8px 0", color: "#555", lineHeight: 1.7 }}>{val}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel>
            <SectionHeading>Reasoning</SectionHeading>
            <p style={{ fontSize: 13, lineHeight: 1.75, color: "#444", margin: 0 }}>{validation.reasoning}</p>
            {validation.qc_footer && (
              <p style={{ fontSize: 11, color: "#bbb", ...mono, marginTop: 10, paddingTop: 8, borderTop: "0.5px solid #f3f4f6", margin: "10px 0 0" }}>{validation.qc_footer}</p>
            )}
          </Panel>

          {!wide && (
            <button onClick={reset} style={{ ...btnBase, background: "transparent", border: "0.5px solid #e5e7eb", color: "#777", alignSelf: "flex-start" }}>
              ← New rumor
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", color: "#111", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <style>{FOCUS_STYLE}</style>
      <a href="#main-content" style={{ position: "absolute", top: -40, left: 0, background: "#111", color: "#fff", padding: "8px 16px", borderRadius: 4, fontSize: 13, zIndex: 100, textDecoration: "none" }}
        onFocus={(e) => (e.target.style.top = "8px")} onBlur={(e) => (e.target.style.top = "-40px")}>
        Skip to main content
      </a>

      <header style={{ background: "#1B5E30", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/birddoglogo.png" alt="BirdDog Express shield logo" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 4, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, ...mono, letterSpacing: "0.12em", color: "#F5F0E8" }} aria-label="BirdDog Express">BIRDDOG EXPRESS</div>
            <div style={{ fontSize: 10, ...mono, letterSpacing: "0.18em", color: "#B8960C", textTransform: "uppercase", marginTop: 2 }} aria-hidden="true">AI-powered rumor validation</div>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <div style={{ display: "flex", gap: 8 }} role="tablist">
            {["tracker","history"].map(tab => (
              <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}
                style={{ ...mono, fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "0.5px solid", borderColor: activeTab === tab ? "#B8960C" : "rgba(245,240,232,0.25)", background: activeTab === tab ? "#B8960C" : "transparent", color: activeTab === tab ? "#1B1200" : "#F5F0E8", cursor: "pointer", textTransform: "capitalize", letterSpacing: "0.08em", minHeight: 44, fontWeight: activeTab === tab ? 500 : 400 }}>
                {tab === "history" ? `History (${history.length})` : "Tracker"}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main id="main-content">
        {activeTab === "history" && (
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
            <h2 style={{ fontSize: 11, ...mono, color: "#888", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14, fontWeight: 500 }}>Recent validations</h2>
            {history.length === 0
              ? <Panel><p style={{ textAlign: "center", color: "#bbb", padding: "40px 0", fontSize: 14, margin: 0 }}>No ABs yet. Step up to the plate.</p></Panel>
              : <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="list">
                  {history.map(h => {
                    const hc  = VERDICT_CONFIG[h.verdict] || VERDICT_CONFIG.UNVERIFIED;
                    const hcl = h.classification ? (CLASSIFICATION_CONFIG[h.classification] || null) : null;
                    return (
                      <Panel key={h.id} role="listitem">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 13, color: "#111", margin: "0 0 4px" }}>{h.rumor}</p>
                            <time style={{ fontSize: 11, ...mono, color: "#999" }}>{h.timestamp}</time>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                            <Badge {...hc} />
                            {hcl && <Badge {...hcl} />}
                            <dl style={{ fontSize: 11, ...mono, color: "#888", display: "flex", gap: 10, margin: 0 }}>
                              <div><dt style={{ display: "inline" }}>Cred: </dt><dd style={{ display: "inline", color: hc.color, fontWeight: 500 }}>{h.credibility}</dd></div>
                              <div><dt style={{ display: "inline" }}>Fit: </dt><dd style={{ display: "inline", color: hc.color, fontWeight: 500 }}>{h.fit}</dd></div>
                              <div><dt style={{ display: "inline" }}>Overall: </dt><dd style={{ display: "inline", color: hc.color, fontWeight: 500 }}>{h.overall}</dd></div>
                            </dl>
                          </div>
                        </div>
                      </Panel>
                    );
                  })}
                </div>
            }
          </div>
        )}

        {activeTab === "tracker" && (
          wide ? (
            <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", minHeight: "calc(100vh - 57px)" }}>
              <div style={{ background: "#fff", borderRight: "0.5px solid #e5e7eb", padding: "24px 20px" }}>
                {InputPanel}
              </div>
              <div style={{ padding: "24px 20px", overflowY: "auto" }}>
                {ResultsPanel}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
              {(step === "input" || step === "validating" || step === "error") && (
                <Panel>{InputPanel}</Panel>
              )}
              {ResultsPanel}
            </div>
          )
        )}
      </main>
      <Analytics />
    </div>
  );
}
