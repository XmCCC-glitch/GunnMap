import type { EntryWithMarker } from "./types.js";
import type { CSSVariables } from "../../shared/css-types.js";
import { referenceSummary } from "./reference-display.js";

export function ScheduleMarkers({
  entries,
  mapSize,
  selectedPeriod,
  onSelect,
}: {
  entries: EntryWithMarker[];
  mapSize: [number, number];
  selectedPeriod: number | null;
  onSelect: (period: number) => void;
}) {
  return entries.map(entry => {
    const siblings = entries.filter(candidate => candidate.id === entry.id);
    const index = siblings.findIndex(candidate => candidate.period === entry.period);
    const offset = (index - (siblings.length - 1) / 2) * 22;
    const style = {
      "--period-color": entry.color,
      left: `calc(${entry.marker[0] / mapSize[0] * 100}% + ${offset}px)`,
      top: `${entry.marker[1] / mapSize[1] * 100}%`,
    } as CSSVariables;

    return (
      <button
        className="evacuation-period-marker"
        type="button"
        key={entry.period}
        aria-label={`Period ${entry.period}, room ${entry.room}`}
        aria-pressed={entry.period === selectedPeriod}
        title={`P${entry.period} · ${entry.room}\n${referenceSummary(entry.evacuation)}`}
        style={style}
        onClick={() => onSelect(entry.period)}
      >
        P{entry.period}
      </button>
    );
  });
}
