import { useEffect, useRef } from "react";
import { usePanzoom } from "../maps/usePanzoom.js";
import { siteUrl } from "../pages/site-data.js";
import type { CSSVariables } from "../../shared/css-types.js";
import type {
  EntryWithMarker,
  EvacuationMapMode,
  ScheduleEvacuationEntry,
} from "./types.js";
import { ScheduleMarkers } from "./ScheduleMarkers.js";
import { ScheduleRoomDetails } from "./ScheduleRoomDetails.js";

export function EvacuationMapViewer({
  mode,
  entries,
  mapSize,
  selectedPeriod,
  onSelect,
  onClose,
}: {
  mode: EvacuationMapMode | null;
  entries: ScheduleEvacuationEntry[];
  mapSize: [number, number] | null;
  selectedPeriod: number | null;
  onSelect: (period: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const reference = mode !== "campus";
  const selected = entries.find(entry => entry.period === selectedPeriod);
  const markerEntries = entries.filter(
    (entry): entry is EntryWithMarker => entry.marker !== null,
  );
  const controls = usePanzoom(stage, art, image, {
    active: mode !== null,
    fit: true,
    sourceKey: mode ?? undefined,
  });

  useEffect(() => {
    if (mode && !dialog.current?.open) dialog.current?.showModal();
    if (!mode && dialog.current?.open) dialog.current.close();
  }, [mode]);

  return (
    <dialog
      ref={dialog}
      className="evacuation-map-dialog"
      aria-labelledby="evacuation-viewer-title"
      onClose={onClose}
      onClick={event => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="panel-heading">
        <h2 id="evacuation-viewer-title">
          {reference ? "Older evacuation reference" : "Classrooms on current campus map"}
        </h2>
        <button
          className="dialog-close"
          type="button"
          aria-label="Close full map"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="map-controls" role="group" aria-label="Map controls">
        <button
          className="download-link"
          type="button"
          onClick={controls.zoomIn}
          aria-label="Zoom in on map"
        >
          Zoom in
        </button>
        <button
          className="download-link"
          type="button"
          onClick={controls.zoomOut}
          aria-label="Zoom out on map"
        >
          Zoom out
        </button>
        <button className="download-link" type="button" onClick={controls.reset}>
          Reset map
        </button>
      </div>
      <p className="map-viewer-help" id="evacuation-map-help">
        {reference
          ? "Supplied older reference, not verified current instructions."
          : "Room markers use the current campus map. Group details come from the older supplied reference."}
        {" "}Drag to move; scroll or pinch to zoom. Focus the map to use +/−, arrow keys or Home.
      </p>
      <div className={`evacuation-viewer-body${reference ? "" : " has-room-details"}`}>
        <div
          ref={stage}
          className="evacuation-map-stage"
          role="region"
          aria-label={reference ? "Interactive older reference map" : "Interactive current campus map"}
          aria-describedby="evacuation-map-help"
          tabIndex={0}
        >
          <div ref={art} className="evacuation-map-art">
            <img
              ref={image}
              src={siteUrl(reference ? "/evacuation-map.webp" : "/map.webp")}
              alt={reference
                ? "Original supplied evacuation reference with red, blue, green and black group markings."
                : "Current Gunn campus map with saved schedule room markers."}
            />
            {!reference && mapSize && markerEntries.length > 0 && (
              <span
                className="evacuation-schedule-overlays"
                role="group"
                aria-label="Your schedule rooms on the current campus map"
              >
                <ScheduleMarkers
                  entries={markerEntries}
                  mapSize={mapSize}
                  selectedPeriod={selectedPeriod}
                  onSelect={onSelect}
                />
              </span>
            )}
          </div>
        </div>
        {!reference && (
          <aside className="evacuation-viewer-details" aria-label="Schedule classroom details">
            <div
              className="evacuation-period-tabs"
              role="group"
              aria-label="Select a schedule period"
            >
              {entries.map(entry => (
                <button
                  type="button"
                  key={entry.period}
                  aria-pressed={entry.period === selectedPeriod}
                  style={{ "--period-color": entry.color } as CSSVariables}
                  onClick={() => onSelect(entry.period)}
                >
                  P{entry.period} · {entry.room}
                </button>
              ))}
            </div>
            <div aria-live="polite">
              {selected && <ScheduleRoomDetails entry={selected} />}
            </div>
          </aside>
        )}
      </div>
    </dialog>
  );
}
