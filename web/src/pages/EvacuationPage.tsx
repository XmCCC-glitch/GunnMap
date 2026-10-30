import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { readCurrentSchedule } from "../features/schedule/schedule-storage.js";
import { buildingName } from "../features/rooms/room-display.js";
import { EvacuationMapViewer } from "../features/evacuation/EvacuationMapViewer.js";
import { referenceCaution, referenceSummary } from "../features/evacuation/reference-display.js";
import type {
  EvacuationMapMode,
  EvacuationOverview,
  ScheduleEvacuationEntry,
} from "../features/evacuation/types.js";
import type { CSSVariables } from "../shared/css-types.js";
import { useToast } from "../shared/toast.js";
import { loadEvacuation, lookupRoom, siteUrl } from "../features/pages/site-data.js";

export function EvacuationPage() {
  const showToast = useToast();
  const [overview, setOverview] = useState<EvacuationOverview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [entries, setEntries] = useState<ScheduleEvacuationEntry[]>([]);
  const [mapSize, setMapSize] = useState<[number, number] | null>(null);
  const [viewerMode, setViewerMode] = useState<EvacuationMapMode | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
  const infoDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let current = true;
    void loadEvacuation()
      .then(data => {
        if (current) setOverview(data);
      })
      .catch(() => {
        if (!current) return;
        setOverviewFailed(true);
        showToast("Evacuation reference data could not be loaded.");
      });

    const selected = readCurrentSchedule()
      .map((period, index) => ({
        ...period,
        period: index + 1,
        room: period.room.trim(),
      }))
      .filter(period => period.room);

    const lookups = selected.map(async (period): Promise<{
      entry: ScheduleEvacuationEntry;
      mapSize: [number, number] | null;
    }> => {
      const unresolved: ScheduleEvacuationEntry = {
        period: period.period,
        id: "",
        room: period.room,
        building: period.building,
        floor: null,
        color: period.color,
        marker: null,
        evacuation: null,
      };
      try {
        const result = await lookupRoom(period.room);
        const matches = period.building
          ? result.rooms.filter(room => room.building === period.building)
          : result.rooms;
        if (matches.length !== 1) return { entry: unresolved, mapSize: null };

        const room = matches[0];
        return {
          entry: {
            period: period.period,
            id: room.id,
            room: room.label,
            building: room.building,
            floor: room.floor,
            color: period.color,
            marker: room.marker,
            evacuation: room.evacuation,
          },
          mapSize: result.map_size,
        };
      } catch {
        return { entry: unresolved, mapSize: null };
      }
    });

    void Promise.all(lookups).then(results => {
      if (!current) return;
      setEntries(results.map(result => result.entry));
      setSelectedPeriod(results[0]?.entry.period ?? null);
      const dimensions = results.find(result => result.mapSize)?.mapSize;
      if (dimensions) setMapSize(dimensions);
    });

    return () => {
      current = false;
    };
  }, [showToast]);

  const viewClassroom = (period: number) => {
    setSelectedPeriod(period);
    setViewerMode("campus");
  };
  const validationMessage = overviewFailed
    ? "Reference information could not be loaded. Reload the page to try again."
    : overview?.validationIssues.length
    ? `Data check needs review: ${overview.validationIssues.join(" ")}`
    : overview
      ? "Reference data checked for internal consistency. Current evacuation instructions have not been verified."
      : "Loading reference information…";

  return (
    <>
      <main id="main-content" className="evacuation-layout" tabIndex={-1}>
        <section className="panel evacuation-panel" aria-labelledby="evacuation-title">
          <div className="panel-heading">
            <div className="evacuation-title-group">
              <h1 id="evacuation-title">Evacuation Reference</h1>
              <button
                className="map-info-button"
                type="button"
                aria-label="Read the reference map source and groups"
                onClick={() => infoDialog.current?.showModal()}
              >
                i
              </button>
            </div>
            {overview && (
              <a
                className="download-link"
                href={siteUrl("/evacuation-map.png")}
                download={overview.provenance.originalFilename}
                onClick={event => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  void import("../features/maps/download-public-map.js")
                    .then(({ downloadPublicMap }) => downloadPublicMap(
                      "/evacuation-map.webp",
                      overview.provenance.originalFilename,
                    ))
                    .catch(error => showToast(
                      error instanceof Error ? error.message : "The PNG could not be downloaded.",
                    ));
                }}
              >
                Download reference PNG
              </a>
            )}
          </div>
          <p className="reference-status">Supplied older reference · Current plan unverified</p>
          <p className="map-help">{referenceCaution}</p>
          <div className="evacuation-map-frame">
            <button
              className="evacuation-map-open"
              type="button"
              aria-label="Open original evacuation reference map"
              onClick={() => setViewerMode("reference")}
            >
              <span className="evacuation-map-art">
                <img
                  src={siteUrl("/evacuation-map.webp")}
                  alt="Original supplied evacuation reference with red, blue, green and black group markings. Open to zoom and pan."
                />
              </span>
            </button>
          </div>
          <p className="map-help">Open the reference image to zoom and read its original labels.</p>

          <section className="schedule-evacuation" aria-labelledby="schedule-evacuation-title">
            <div className="panel-heading">
              <div>
                <h2 id="schedule-evacuation-title">Your classrooms & reference groups</h2>
                <p className="map-help">
                  Saved schedule rooms appear on the current campus map.
                  Group matches come from the older reference above.
                </p>
              </div>
              {entries.length > 0 && (
                <button
                  className="download-link"
                  type="button"
                  onClick={() => setViewerMode("campus")}
                >
                  View classrooms on current map
                </button>
              )}
            </div>
            {entries.length > 0 ? (
              <div className="schedule-evacuation-list">
                {entries.map(entry => (
                  <button
                    className="schedule-evacuation-item"
                    type="button"
                    key={entry.period}
                    style={{ "--period-color": entry.color } as CSSVariables}
                    onClick={() => viewClassroom(entry.period)}
                  >
                    <span className="schedule-evacuation-period">P{entry.period}</span>
                    <strong>{entry.room} · {referenceSummary(entry.evacuation)}</strong>
                    <small>
                      {entry.building ? buildingName(entry.building) : "No building selected"}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="map-help">
                Add your classrooms on <Link to="/">Schedule Map</Link> to see their reference groups.
              </p>
            )}
          </section>
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
            <div className="eyebrow">SUPPLIED OLDER REFERENCE</div>
            <h2 id="route-groups-title">Reference colors & labels</h2>
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
          {overview && Object.entries(overview.groups).map(([key, group]) => (
            <article
              className="panel route-group"
              key={key}
              style={{ "--route-color": group.color } as CSSVariables}
            >
              <h3>
                <span className="route-swatch" aria-hidden="true" />
                {group.title}
              </h3>
              <p>{group.destination}</p>
              <ul>
                {group.labels.map(label => <li key={label}>{label}</li>)}
              </ul>
              {group.description && <p>{group.description}</p>}
            </article>
          ))}
        </div>
        <div className="map-reference-notes" role="note">
          <p>{referenceCaution}</p>
          {overview && (
            <p>
              Source: {overview.provenance.originalFilename}.
              {" "}Source revision date: {overview.provenance.sourceRevisionDate ?? "not shown"}.
              {" "}Verification date: {overview.provenance.verifiedOn ?? "not recorded"}.
            </p>
          )}
          <p
            className={overviewFailed || overview?.validationIssues.length ? "is-error" : ""}
            role="status"
          >
            {validationMessage}
          </p>
          {overview && Object.values(overview.inventoryExceptions).map(note => <p key={note}>{note}</p>)}
          <p>Rooms without a matching reference label have no assigned reference group.</p>
        </div>
      </dialog>
      <EvacuationMapViewer
        mode={viewerMode}
        entries={entries}
        mapSize={mapSize}
        selectedPeriod={selectedPeriod}
        onSelect={setSelectedPeriod}
        onClose={() => setViewerMode(null)}
      />
    </>
  );
}
