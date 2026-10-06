import { useEffect, useRef, useState } from "react";
import { readCurrentSchedule } from "../features/schedule/schedule-storage.js";
import { usePanzoom } from "../features/maps/usePanzoom.js";
import { buildingName } from "../features/rooms/room-display.js";
import type {
  EvacuationOverview,
  ScheduleEvacuationEntry,
} from "../features/evacuation/types.js";
import type { CSSVariables } from "../shared/css-types.js";
import { useToast } from "../shared/toast.js";
import { loadEvacuation, lookupRoom, siteUrl } from "../features/pages/site-data.js";
import "@awesome.me/webawesome/dist/components/tooltip/tooltip.js";

type EntryWithMarker = ScheduleEvacuationEntry & {
  marker: [number, number];
};

function entryRoute(entry: ScheduleEvacuationEntry) {
  if (!entry.evacuation || entry.evacuation.status !== "mapped") {
    return `${entry.room} → Assembly area not confirmed`;
  }

  const reference = entry.evacuation.reference_label
    && !/^[A-Z]$/i.test(entry.evacuation.reference_label)
    ? `${entry.evacuation.reference_label} · `
    : "";
  const destination = entry.evacuation.short_destination
    ?? entry.evacuation.destination;

  return `${entry.room} → ${reference}${destination} (${entry.evacuation.group})`;
}

function markerGroupKey(entry: EntryWithMarker) {
  return entry.id || `${entry.marker[0]}:${entry.marker[1]}`;
}

function markerRoute(entry: ScheduleEvacuationEntry) {
  if (entry.evacuation?.status !== "mapped") {
    return "Assembly area not confirmed";
  }

  const reference = entry.evacuation.reference_label
    && !/^[A-Z]$/i.test(entry.evacuation.reference_label)
    ? `${entry.evacuation.reference_label} · `
    : "";
  const destination = entry.evacuation.short_destination
    ?? entry.evacuation.destination;

  return `${entry.evacuation.group} group · ${reference}${destination}`;
}

function sourceProvenance(overview: EvacuationOverview) {
  const sourceName = overview.provenance.originalFilename;
  const revision = overview.provenance.sourceRevisionDate
    ?? "not shown on the supplied image";
  const verified = overview.provenance.verifiedOn ?? "not recorded";

  if (overview.provenance.sourceKind === "official_site_map") {
    return `School site map: ${sourceName}. Map revision date: ${revision}. Evacuation routes and assembly points have not been verified.`;
  }
  return `User-supplied reference: ${sourceName}. Reference revision date: ${revision}. Verification date: ${verified}.`;
}

function ScheduleMarkers({
  entries,
  mapSize,
  prefix,
  onSelect,
}: {
  entries: EntryWithMarker[];
  mapSize: [number, number];
  prefix: string;
  onSelect: (period: number) => void;
}) {
  return entries.map(entry => {
    const tooltipId = `${prefix}-period-tooltip-${entry.period}`;
    const groupKey = markerGroupKey(entry);
    const siblings = entries.filter(
      candidate => markerGroupKey(candidate) === groupKey,
    );
    const siblingIndex = siblings.findIndex(
      candidate => candidate.period === entry.period,
    );
    const offset = (siblingIndex - (siblings.length - 1) / 2) * 22;
    const markerId = `${prefix}-period-marker-${entry.period}`;
    const building = entry.building ? `\n${buildingName(entry.building)}` : "";
    const tooltipText = `P${entry.period} · ${entry.room}${building}\n${markerRoute(entry)}`;
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
          id={markerId}
          style={style}
          onClick={() => onSelect(entry.period)}
        >
          P{entry.period}
        </button>
        <wa-tooltip
          id={tooltipId}
          className="schedule-room-tooltip"
          for={markerId}
          placement="top"
        >
          {tooltipText}
        </wa-tooltip>
      </span>
    );
  });
}

export function EvacuationPage() {
  const showToast = useToast();
  const [overview, setOverview] = useState<EvacuationOverview | null>(null);
  const [entries, setEntries] = useState<ScheduleEvacuationEntry[]>([]);
  const [mapSize, setMapSize] = useState<[number, number]>([2448, 1584]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const infoDialog = useRef<HTMLDialogElement>(null);
  const mapDialog = useRef<HTMLDialogElement>(null);
  const viewerStage = useRef<HTMLDivElement>(null);
  const viewerArt = useRef<HTMLDivElement>(null);
  const viewerImage = useRef<HTMLImageElement>(null);
  const markerEntries = entries.filter(
    (entry): entry is EntryWithMarker => entry.marker !== null,
  );

  const mapControls = usePanzoom(viewerStage, viewerArt, viewerImage, {
    active: viewerOpen,
    fit: true,
  });

  useEffect(() => {
    let current = true;

    void loadEvacuation()
      .then(data => {
        if (current) setOverview(data);
      })
      .catch(() => {
        if (current) showToast("Evacuation data could not be loaded.");
      });

    const selected = readCurrentSchedule()
      .map((period, index) => ({
        ...period,
        period: index + 1,
        room: period.room.trim(),
      }))
      .filter(period => period.room);

    if (!selected.length) {
      return () => {
        current = false;
      };
    }

    void Promise.all(selected.map(async period => {
      try {
        const result = await lookupRoom(period.room);
        const matches = period.building
          ? result.rooms.filter(room => room.building === period.building)
          : result.rooms;

        if (matches.length !== 1) {
          return {
            entry: {
              period: period.period,
              id: "",
              room: period.room,
              building: period.building,
              color: period.color,
              marker: null,
              evacuation: null,
            } satisfies ScheduleEvacuationEntry,
            mapSize: null,
          };
        }

        const room = matches[0];
        return {
          entry: {
            period: period.period,
            id: room.id,
            room: room.label,
            building: room.building,
            color: period.color,
            marker: room.marker,
            evacuation: room.evacuation,
          } satisfies ScheduleEvacuationEntry,
          mapSize: result.map_size,
        };
      } catch {
        return {
          entry: {
            period: period.period,
            id: "",
            room: period.room,
            building: period.building,
            color: period.color,
            marker: null,
            evacuation: null,
          } satisfies ScheduleEvacuationEntry,
          mapSize: null,
        };
      }
    })).then(results => {
      if (!current) return;
      setEntries(results.map(result => result.entry));

      const dimensions = results.find(result => result.mapSize)?.mapSize;
      if (dimensions) setMapSize(dimensions);
    });

    return () => {
      current = false;
    };
  }, [showToast]);

  const openViewer = () => {
    setViewerOpen(true);
    mapDialog.current?.showModal();
  };

  const closeViewer = () => {
    mapDialog.current?.close();
    setViewerOpen(false);
  };

  const scrollToEntry = (period: number) => {
    if (viewerOpen) return;

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
                href={siteUrl("/evacuation-map.png")}
                download="gunn-campus-map-2026.png"
                onClick={event => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  void import("../features/maps/download-public-map.js")
                    .then(({ downloadPublicMap }) => downloadPublicMap("/evacuation-map.webp", "gunn-campus-map-2026.png"))
                    .catch(error => showToast(error instanceof Error ? error.message : "The PNG could not be downloaded."));
                }}
              >
                Download PNG
              </a>
            </div>
          </div>

          <p className="map-help" role="status">
            This September 3, 2026 school site map has no evacuation routes or assembly points.
            Room assembly assignments are unconfirmed. Follow current school staff directions during an emergency.
          </p>

          <div className="evacuation-map-frame">
            <button
              className="evacuation-map-open"
              type="button"
              aria-label="Open interactive campus map"
              onClick={openViewer}
            >
              <span className="evacuation-map-art">
                <img
                  src={siteUrl("/evacuation-map.webp")}
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
                      </small>
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
                  {group.title || `${key} markings`}
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
              src={siteUrl("/evacuation-map.webp")}
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
                  onSelect={scrollToEntry}
                />
              </span>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
