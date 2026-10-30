import { buildingName } from "../rooms/room-display.js";
import type { ScheduleEvacuationEntry } from "./types.js";
import type { CSSVariables } from "../../shared/css-types.js";
import { referenceCaution, referenceSummary } from "./reference-display.js";

export function ScheduleRoomDetails({ entry }: { entry: ScheduleEvacuationEntry }) {
  const evacuation = entry.evacuation;

  return (
    <article
      className="schedule-room-details"
      aria-label={`Period ${entry.period} room details`}
    >
      <h3>P{entry.period} · {entry.room}</h3>
      {entry.building && (
        <p className="schedule-room-location">
          {buildingName(entry.building)}{entry.floor !== null ? ` · Floor ${entry.floor}` : ""}
        </p>
      )}
      <p className="schedule-room-reference">
        {evacuation?.status === "mapped" && evacuation.color && (
          <span
            className="route-swatch"
            aria-hidden="true"
            style={{ "--route-color": evacuation.color } as CSSVariables}
          />
        )}
        <strong>{referenceSummary(evacuation)}</strong>
      </p>
      {evacuation?.status === "mapped" && <p>{evacuation.destination}</p>}
      <p>{evacuation?.note ?? "No room details are available for this saved selection. Check the room and building on Schedule Map, then reload."}</p>
      <p className="find-room-disclaimer">{referenceCaution}</p>
    </article>
  );
}
