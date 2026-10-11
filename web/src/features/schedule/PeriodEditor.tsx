import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CSSVariables } from "../../shared/css-types.js";
import { RoomInput } from "../rooms/RoomInput.js";
import { buildingName, roomLocationLabel } from "../rooms/room-display.js";
import { inferRoomBuilding, periodRoomState } from "./room-validation.js";
import { PERIOD_COLORS } from "./schedule-storage.js";
import type { Period } from "./types.js";
import type { RoomOption } from "../rooms/types.js";

const ColorEditor = lazy(() => import("./ColorEditor.js"));

interface PeriodEditorProps {
  periods: Period[];
  rooms: RoomOption[];
  buildings: string[];
  disabled?: boolean;
  onChange(next: Period[], previous: Period[]): void;
}

function deriveAutoBuildings(periods: Period[], rooms: RoomOption[]) {
  return periods.map(period => inferRoomBuilding(rooms, period.room) === period.building
    ? period.building
    : "");
}

export function PeriodEditor({
  periods,
  rooms,
  buildings,
  disabled = false,
  onChange,
}: PeriodEditorProps) {
  const [wide, setWide] = useState(() => window.matchMedia?.("(min-width: 431px)").matches ?? true);
  const [manualBuildings, setManualBuildings] = useState(false);
  const [editingColor, setEditingColor] = useState<number | null>(null);
  const colorTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const query = window.matchMedia?.("(min-width: 431px)");
    const changed = () => setWide(query?.matches ?? true);
    query?.addEventListener("change", changed);
    return () => query?.removeEventListener("change", changed);
  }, []);
  const [autoBuildings, setAutoBuildings] = useState(() => deriveAutoBuildings(periods, rooms));

  useEffect(() => {
    setAutoBuildings(deriveAutoBuildings(periods, rooms));
  }, [periods, rooms]);

  function update(index: number, mutate: (period: Period, nextAuto: string[]) => void) {
    const previous = periods.map((period) => ({ ...period }));
    const next = previous.map((period) => ({ ...period }));
    const nextAuto = [...autoBuildings];
    mutate(next[index], nextAuto);
    setAutoBuildings(nextAuto);
    onChange(next, previous);
  }

  function updateRoom(index: number, value: string) {
    update(index, (period, nextAuto) => {
      period.room = value;
      const inferred = inferRoomBuilding(rooms, value);
      if (inferred) {
        period.building = inferred;
        nextAuto[index] = period.building;
      } else if (nextAuto[index] && period.building === nextAuto[index]) {
        period.building = "";
        nextAuto[index] = "";
      }
    });
  }

  return (
    <div className="period-list">
      {!wide && <button type="button" className="text-button manual-building-toggle"
        aria-expanded={manualBuildings} onClick={() => setManualBuildings(open => !open)}>
        {manualBuildings ? "Hide building choices" : "Choose buildings manually"}
      </button>}
      {periods.map((period, index) => {
        const number = index + 1;
        const { matches, state, invalid } = periodRoomState(period, rooms);
        const feedback = state === "empty" ? "No class this period"
          : state === "matched" ? `Found ${roomLocationLabel(matches[0])} · ${buildingName(matches[0].building)}${matches[0].floor === 2 ? " · 2nd floor" : ""}`
          : state === "ambiguous" ? "More than one room matches. Choose a location below."
          : `Room not found${period.building ? ` in ${buildingName(period.building)}` : ""}. Check the room or building.`;
        return (
          <div
            className="period-card"
            data-period={number}
            data-room-state={disabled ? "loading" : state}
            style={{ "--period-accent": period.color } as CSSVariables}
            key={number}
          >
            <div
              className="period-number"
              role="group"
              aria-label={`Period ${number}`}
            >
              <span aria-hidden="true">PERIOD</span>
              <strong>{number}</strong>
            </div>
            <label className="field field-room" htmlFor={`period-${number}-room`}>
              <span>Room</span>
              <RoomInput
                id={`period-${number}-room`}
                label={`Period ${number} room`}
                value={period.room}
                building={period.building}
                rooms={rooms}
                placeholder="e.g. N211"
                disabled={disabled}
                invalid={!disabled && invalid}
                describedBy={`period-${number}-feedback`}
                onValueChange={value => updateRoom(index, value)}
              />
            </label>
            {(wide || manualBuildings) && <label className={`field field-building${!wide ? " is-manual" : ""}`}>
              <span>Building</span>
              <select
                aria-label={`Period ${number} building`}
                value={period.building}
                disabled={disabled}
                onChange={event => {
                  const value = event.currentTarget.value;
                  update(index, (current, nextAuto) => {
                    current.building = value;
                    nextAuto[index] = "";
                  });
                }}
              >
                <option value="">Auto-detect</option>
                {buildings.map(building => (
                  <option value={building} key={building}>
                    {buildingName(building)}
                  </option>
                ))}
              </select>
            </label>}
            <p className="period-room-feedback" id={`period-${number}-feedback`} aria-live="polite">
              {disabled ? "Loading room list…" : feedback}
            </p>
            {!disabled && state === "ambiguous" && (
              <div className="period-room-choices" aria-label={`Choose period ${number} room`}>
                {matches.map(room => (
                  <button className="room-lookup-choice" type="button" key={room.id}
                    onClick={() => updateRoom(index, roomLocationLabel(room) === room.label ? `${room.label} (${room.id})` : roomLocationLabel(room))}>
                    {roomLocationLabel(room) === room.label ? `${room.label} (${room.id})` : roomLocationLabel(room)}
                  </button>
                ))}
              </div>
            )}
            <div className="field field-color">
              <span>Color</span>
              <button type="button" className="period-color-trigger"
                aria-label={`Period ${number} color`}
                aria-haspopup="dialog"
                style={{ "--swatch-color": period.color } as CSSVariables}
                disabled={disabled}
                onClick={event => {
                  colorTrigger.current = event.currentTarget;
                  setEditingColor(index);
                }}
              />
            </div>
          </div>
        );
      })}
      {editingColor !== null && <Suspense fallback={<p role="status">Opening color editor…</p>}>
        <ColorEditor period={editingColor + 1} value={periods[editingColor].color} swatches={PERIOD_COLORS}
          onApply={color => update(editingColor, current => { current.color = color; })}
          onClose={() => { setEditingColor(null); colorTrigger.current?.focus(); }} />
      </Suspense>}
    </div>
  );
}
