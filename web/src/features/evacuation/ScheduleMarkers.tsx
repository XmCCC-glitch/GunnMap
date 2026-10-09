import { buildingName } from "../rooms/room-display.js";
import type { CSSVariables } from "../../shared/css-types.js";
import { assemblySummary } from "./formatters.js";
import type { LocatedScheduleEntry } from "./types.js";
import "@awesome.me/webawesome/dist/components/tooltip/tooltip.js";

export function ScheduleMarkers({ entries, mapSize, prefix, onSelect, selectedPeriod }: {
  entries: LocatedScheduleEntry[];
  mapSize: [number, number];
  prefix: string;
  onSelect: (period: number) => void;
  selectedPeriod?: number | null;
}) {
  const roomPeriods = new Map<string, number[]>();
  for (const entry of entries) {
    const periods = roomPeriods.get(entry.id);
    if (periods) periods.push(entry.period);
    else roomPeriods.set(entry.id, [entry.period]);
  }

  return entries.map(entry => {
    const tooltipId = `${prefix}-period-tooltip-${entry.period}`;
    const siblings = roomPeriods.get(entry.id)!;
    const siblingIndex = siblings.indexOf(entry.period);
    const offset = (siblingIndex - (siblings.length - 1) / 2) * 22;
    const markerId = `${prefix}-period-marker-${entry.period}`;
    const tooltipText = `P${entry.period} · ${entry.room}\n${buildingName(entry.building)}\n${assemblySummary(entry.evacuation)}`;
    const style = {
      "--period-color": entry.color,
      left: `calc(${entry.marker[0] / mapSize[0] * 100}% + ${offset}px)`,
      top: `${entry.marker[1] / mapSize[1] * 100}%`,
    } as CSSVariables;

    return (
      <span className="evacuation-period-marker-group" key={entry.period}>
        <button
          className="evacuation-period-marker"
          type="button"
          aria-label={`Period ${entry.period}, room ${entry.room}`}
          aria-describedby={tooltipId}
          aria-pressed={selectedPeriod === undefined ? undefined : selectedPeriod === entry.period}
          aria-controls={selectedPeriod === undefined ? undefined : "evacuation-selected-room"}
          id={markerId}
          style={style}
          onClick={() => onSelect(entry.period)}
          onPointerDown={event => event.stopPropagation()}
        >
          P{entry.period}
        </button>
        <wa-tooltip id={tooltipId} className="schedule-room-tooltip" for={markerId} placement="top">
          {tooltipText}
        </wa-tooltip>
      </span>
    );
  });
}
