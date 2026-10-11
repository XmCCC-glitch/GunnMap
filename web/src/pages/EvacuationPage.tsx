import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { evacuationDestination } from "../features/evacuation/formatters.js";
import { EvacuationPeriodPicker, EvacuationRoomDetails, scheduleEntryNote } from "../features/evacuation/room-details.js";
import { ScheduleMarkers } from "../features/evacuation/ScheduleMarkers.js";
import { useEvacuationData } from "../features/evacuation/useEvacuationData.js";
import { usePanzoom } from "../features/maps/usePanzoom.js";
import { buildingName } from "../features/rooms/room-display.js";
import type { EvacuationOverview, ScheduleEvacuationEntry, LocatedScheduleEntry } from "../features/evacuation/types.js";
import type { CSSVariables } from "../shared/css-types.js";
import { useToast } from "../shared/toast.js";

function entryRoute(entry: ScheduleEvacuationEntry) {
  switch (entry.status) {
    case "review-required": return `${entry.room} → Review this room on the current map`;
    case "not-found": return `${entry.room} → Room not found in the current directory`;
    case "lookup-failed": return `${entry.room} → Room lookup failed`;
    case "located": return `${entry.room} → ${evacuationDestination(entry.evacuation)}`;
  }
}

function sourceProvenance(overview: EvacuationOverview) {
  const sourceName = overview.provenance.originalFilename;
  const revision = overview.provenance.sourceRevisionDate
    ?? "not shown on the supplied image";
  const verified = overview.provenance.verifiedOn ?? "not recorded";

  if (overview.provenance.sourceKind === "official_site_map") {
    return `School site map: ${sourceName}. Map revision date: ${revision}. Evacuation routes and assembly points have not been verified.`;
  }
  if (overview.provenance.sourceKind === "official_evacuation_plan") {
    return `School evacuation plan: ${sourceName}. Plan revision date: ${revision}. Verified on: ${verified}. Confirmed by: ${overview.review.verifiedBy ?? "not recorded"}.`;
  }
  return `User-supplied reference: ${sourceName}. Reference revision date: ${revision}. Verification date: ${verified}.`;
}

export function EvacuationPage() {
  const showToast = useToast();
  const { overview, entries, mapSize, overviewError, scheduleError } = useEvacuationData();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
  const infoDialog = useRef<HTMLDialogElement>(null);
  const mapDialog = useRef<HTMLDialogElement>(null);
  const viewerStage = useRef<HTMLDivElement>(null);
  const viewerArt = useRef<HTMLDivElement>(null);
  const viewerImage = useRef<HTMLImageElement>(null);
  const selectedDetails = useRef<HTMLElement>(null);
  const selectedEntry = entries.find(entry => entry.period === selectedPeriod);
  const markerEntries = entries.filter(
    (entry): entry is LocatedScheduleEntry => entry.status === "located",
  );

  const mapControls = usePanzoom(viewerStage, viewerArt, viewerImage, {
    active: viewerOpen,
    fit: true,
  });

  useEffect(() => {
    if (viewerOpen && selectedPeriod !== null) selectedDetails.current?.focus({ preventScroll: true });
  }, [selectedPeriod, viewerOpen]);

  const openViewer = () => {
    setSelectedPeriod(null);
    setViewerOpen(true);
    mapDialog.current?.showModal();
  };

  const closeViewer = () => {
    mapDialog.current?.close();
    setViewerOpen(false);
  };

  const scrollToEntry = (period: number) => {
    const item = document.getElementById(`schedule-period-${period}`);
    item?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    item?.focus({ preventScroll: true });
  };

  const provenance = overview
    ? sourceProvenance(overview)
    : "Loading source information…";
  const validationMessage = overview
    ? overview.validationIssues.length
      ? `Data check needs review: ${overview.validationIssues.join(" ")}`
      : overview.routesAvailable
        ? "Reference data is internally consistent. This does not confirm current school instructions."
        : "The current site map has no verified evacuation routes or assembly points."
    : "Evacuation data could not be checked.";
  const validationClassName = overview?.validationIssues.length
    ? "is-error"
    : "";
  const reviewRequired = entries.some(entry => entry.status === "review-required" || entry.status === "not-found");

  return (
    <>
      <main id="main-content" className="evacuation-layout" tabIndex={-1}>
        <section
          className="panel evacuation-panel"
          aria-labelledby="evacuation-title"
        >
          <div className="panel-heading">
            <div className="evacuation-title-group">
              <h1 id="evacuation-title">Campus Map & Evacuation Status</h1>
              <button
                className="map-info-button"
                type="button"
                aria-label="Read the map source and evacuation status"
                onClick={() => infoDialog.current?.showModal()}
              >
                i
              </button>
            </div>
            <div className="map-links">
              <a
                className="download-link"
                href="/evacuation-map.png"
                download="gunn-campus-map-2026.png"
                onClick={event => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  void import("../features/maps/download-public-map.js")
                    .then(({ downloadPublicMap }) => downloadPublicMap("/map.webp", "gunn-campus-map-2026.png"))
                    .catch(error => showToast(error instanceof Error ? error.message : "The PNG could not be downloaded."));
                }}
              >
                Download PNG
              </a>
            </div>
          </div>

          <p className="map-help" role="status">
            {overview?.routesAvailable
              ? "Room assembly assignments are based on the verified school evacuation plan."
              : "This September 3, 2026 school site map has no evacuation routes or assembly points. Room assembly assignments are unconfirmed."}
            {" "}Follow current school staff directions during an emergency.
          </p>
          {overview && (
            <div className="evacuation-review-summary" role="note">
              <strong>{overview.review.status === "verified_school_plan" && overview.routesAvailable
                ? "School evacuation plan verified"
                : "Awaiting a current school evacuation plan"}</strong>
              <span>Campus map: September 3, 2026 · Last evidence review: {overview.review.checkedOn}</span>
              <span>{overview.routesAvailable ? `Plan verified: ${overview.provenance.verifiedOn}` : "Plan verification: not completed. All room assembly areas remain unconfirmed."}</span>
              <button className="download-link" type="button" onClick={() => infoDialog.current?.showModal()}>View source and required evidence</button>
            </div>
          )}
          {overviewError && <p className="is-error" role="status">{overviewError}</p>}
          {scheduleError && <p className="is-error" role="status">{scheduleError}</p>}
          {reviewRequired && (
            <p className="evacuation-schedule-review" role="status">
              Some saved rooms need confirmation on the current campus map. Their markers are hidden until reviewed.
              {" "}<Link to="/">Review saved rooms</Link>
            </p>
          )}

          <div className="evacuation-map-frame">
            <button
              className="evacuation-map-open"
              type="button"
              aria-label="Open interactive campus map"
              onClick={openViewer}
            >
              <span className="evacuation-map-art">
                <img
                src="/map.webp"
                  alt="Gunn school site map dated September 3, 2026, without evacuation routes. Open the map to zoom and pan."
                />
              </span>
            </button>
            {markerEntries.length > 0 && (
              <span
                className="evacuation-schedule-overlays"
                role="group"
                aria-label="Your schedule rooms on the campus map"
              >
                <ScheduleMarkers
                  entries={markerEntries}
                  mapSize={mapSize}
                  prefix="page"
                  onSelect={scrollToEntry}
                />
              </span>
            )}
          </div>

          {entries.length > 0 && (
            <section
              className="schedule-evacuation"
              aria-labelledby="schedule-evacuation-title"
            >
              <div>
                <h2 id="schedule-evacuation-title">
                  Your schedule's assembly status
                </h2>
                <p className="map-help">
                  Based on the rooms saved on this device.
                </p>
              </div>
              <div className="schedule-evacuation-list">
                {entries.map(entry => {
                  const style = {
                    "--period-color": entry.color,
                    "--route-color": entry.evacuation?.color ?? "#92929d",
                  } as CSSVariables;

                  return (
                    <article
                      className="schedule-evacuation-item"
                      id={`schedule-period-${entry.period}`}
                      tabIndex={-1}
                      key={entry.period}
                      style={style}
                    >
                      <span className="schedule-evacuation-period">
                        P{entry.period}
                      </span>
                      <strong>{entryRoute(entry)}</strong>
                      <small>
                        {entry.building
                          ? buildingName(entry.building)
                          : "Choose a building to confirm this room"}
                        {entry.floor !== null && ` · Floor ${entry.floor}`}
                      </small>
                      <p className="schedule-evacuation-note">{scheduleEntryNote(entry)}</p>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </section>
      </main>

      <dialog
        ref={infoDialog}
        className="room-dialog map-info-dialog"
        aria-labelledby="route-groups-title"
        onClick={event => {
          if (event.target === infoDialog.current) infoDialog.current?.close();
        }}
      >
        <div className="panel-heading">
          <div>
            <div className="eyebrow">READ THE MAP</div>
            <h2 id="route-groups-title">Evacuation Route Status</h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close map information"
            onClick={() => infoDialog.current?.close()}
          >
            ×
          </button>
        </div>
        <div className="route-groups" aria-live="polite">
          {overview?.routesAvailable && Object.entries(overview.groups).map(([key, group]) => {
            const style = { "--route-color": group.color } as CSSVariables;

            return (
              <article className="panel route-group" key={key} style={style}>
                <h3>
                  <span className="route-swatch" aria-hidden="true" />
                  {group.title}
                </h3>
                <ul>
                  {group.labels.map(label => <li key={label}>{label}</li>)}
                </ul>
                {group.description && <p>{group.description}</p>}
              </article>
            );
          })}
          {overview && !overview.routesAvailable && <p>No verified route groups are available for the current campus layout.</p>}
        </div>
        <div className="map-reference-notes" role="note">
          <p>
            Reference only. Follow current school staff directions during an emergency.
          </p>
          <p>{provenance}</p>
          {overview && (
            <section className="evacuation-review-details" aria-labelledby="evacuation-review-title">
              <h3 id="evacuation-review-title">School plan review</h3>
              <p>{overview.review.note}</p>
              <p>Last evidence review: {overview.review.checkedOn} · {overview.review.checkedBy}</p>
              <p>Plan verification: {overview.provenance.verifiedOn ?? "not completed"}</p>
              {overview.review.missingEvidence.length > 0 && (
                <>
                  <p>Evidence still required:</p>
                  <ul>{overview.review.missingEvidence.map(item => <li key={item}>{item}</li>)}</ul>
                </>
              )}
            </section>
          )}
          <p
            className={validationClassName}
            role="status"
          >
            {validationMessage}
          </p>
          <p>
            {overview
              ? Object.values(overview.inventoryExceptions).join(" ")
              : ""}
          </p>
          <p>{overview?.routesAvailable ? "Unlisted rooms have no assigned route." : "No room has a confirmed assembly assignment in this map."}</p>
        </div>
      </dialog>

      <dialog
        ref={mapDialog}
        className="evacuation-map-dialog"
        aria-labelledby="evacuation-viewer-title"
        onClose={() => setViewerOpen(false)}
        onClick={event => {
          if (event.target === mapDialog.current) closeViewer();
        }}
      >
        <div className="panel-heading">
          <h2 id="evacuation-viewer-title">Campus Map</h2>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close full map"
            onClick={closeViewer}
          >
            ×
          </button>
        </div>
        <div className="map-controls" role="group" aria-label="Campus map controls">
          <button className="download-link" type="button" onClick={mapControls.zoomIn} aria-label="Zoom in on campus map">Zoom in</button>
          <button className="download-link" type="button" onClick={mapControls.zoomOut} aria-label="Zoom out on campus map">Zoom out</button>
          <button className="download-link" type="button" onClick={mapControls.reset}>Reset map</button>
        </div>
        <p className="map-viewer-help" id="evacuation-map-help">
          Drag to move; scroll or pinch to zoom. With the map focused, use +/− to zoom, arrow keys to move, and Home or 0 to reset.
        </p>
        <div
          ref={viewerStage}
          className="evacuation-map-stage"
          role="region"
          aria-label="Interactive campus map"
          aria-describedby="evacuation-map-help"
          tabIndex={0}
        >
          <div ref={viewerArt} className="evacuation-map-art">
            <img
              ref={viewerImage}
              src="/map.webp"
              alt="Gunn school site map dated September 3, 2026, without evacuation routes."
            />
            {markerEntries.length > 0 && (
              <span
                className="evacuation-schedule-overlays"
                role="group"
                aria-label="Your schedule rooms on the campus map"
              >
                <ScheduleMarkers
                  entries={markerEntries}
                  mapSize={mapSize}
                  prefix="viewer"
                  onSelect={setSelectedPeriod}
                  selectedPeriod={selectedPeriod}
                />
              </span>
            )}
          </div>
        </div>
        <EvacuationPeriodPicker entries={markerEntries} selectedPeriod={selectedPeriod} onSelect={setSelectedPeriod} />
        <EvacuationRoomDetails entry={selectedEntry} hasMarkers={markerEntries.length > 0} detailsRef={selectedDetails} />
      </dialog>
    </>
  );
}
