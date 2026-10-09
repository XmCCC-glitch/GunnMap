import { useEffect, useRef } from "react";
import { buildingName } from "../rooms/room-display.js";
import type { RoomOption } from "../rooms/types.js";
import { inferRoomBuilding } from "./room-validation.js";
import type { Period } from "./types.js";
import type { CSSVariables } from "../../shared/css-types.js";

interface SharedScheduleDialogProps {
  periods: Period[];
  rooms: RoomOption[];
  onUse(save: boolean): void;
  onDismiss(): void;
}

export function SharedScheduleDialog({ periods, rooms, onUse, onDismiss }: SharedScheduleDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog
      ref={dialog}
      className="room-dialog shared-schedule-dialog"
      aria-labelledby="shared-schedule-title"
      onClose={onDismiss}
    >
      <div className="panel-heading">
        <div>
          <div className="eyebrow">SHARED SCHEDULE</div>
          <h2 id="shared-schedule-title">Preview this schedule</h2>
        </div>
        <form method="dialog">
          <button className="dialog-close" aria-label="Close shared schedule preview">×</button>
        </form>
      </div>
      <p className="map-help">Your saved schedule stays untouched until you choose to save this one.</p>
      <ol className="shared-schedule-preview">
        {periods.map((period, index) => {
          const building = period.building || inferRoomBuilding(rooms, period.room);
          const roomLabel = period.room.trim()
            ? `${period.room.trim()}${building ? ` · ${buildingName(building)}` : ""}`
            : "No room selected";
          return (
            <li key={index}>
              <span
                className="shared-period-swatch"
                style={{ "--period-color": period.color } as CSSVariables}
                aria-hidden="true"
              />
              <span className="shared-period-number">{index + 1}</span>
              <span>{roomLabel}</span>
            </li>
          );
        })}
      </ol>
      <div className="shared-schedule-actions">
        <button className="download-link" type="button" onClick={() => onUse(false)}>Use once</button>
        <button className="primary-button" type="button" onClick={() => onUse(true)}>Save and use</button>
        <button className="text-button" type="button" onClick={onDismiss}>Keep my current schedule</button>
      </div>
    </dialog>
  );
}
