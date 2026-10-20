import { useEffect, useState } from "react";
import { observeVisits, type VisitSummary } from "./visit-counter.js";

const apiUrl = import.meta.env?.VITE_VISITS_API_URL as string | undefined;

export function VisitCounter() {
  const [summary, setSummary] = useState<VisitSummary | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!apiUrl) return;
    return observeVisits({ apiUrl, onSummary: value => {
      setSummary(value); setUnavailable(false);
    }, onUnavailable: () => setUnavailable(true), onNotice: setNotice });
  }, []);
  if (!apiUrl) return null;
  const since = summary ? new Date(summary.startedAt).toLocaleString() : "activation";
  return <div className="visit-counter">
    <span title={`Since ${since}. Each page opening counts once, including agents reading for a user. Development and QA visits are excluded. Navigating within the site does not add a visit.`}>
      {unavailable ? "Visits unavailable" : <><strong>{summary ? summary.total.toLocaleString() : "…"}</strong> user visits</>}
    </span>
    {notice && <span role="status">{notice} · <a href="/GunnMap/?stats=undo">Undo last development visit</a></span>}
  </div>;
}
