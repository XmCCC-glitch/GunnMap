import { useCallback, useEffect, useRef, useState } from "react";
import { loadRoomDirectory } from "../features/rooms/room-api.js";
import type { RoomData } from "../features/rooms/types.js";
import { PeriodEditor } from "../features/schedule/PeriodEditor.js";
import type { ResponsivePeriod } from "../features/schedule/PeriodEditor.js";
import { GeneratedMapPanel, savedImagePath } from "./GeneratedMapPage.js";
import { ScheduleActions } from "../features/schedule/ScheduleActions.js";
import { SharedScheduleDialog } from "../features/schedule/SharedScheduleDialog.js";
import { ScheduleReviewNotice } from "../features/schedule/ScheduleReviewNotice.js";
import { useScheduleEditor } from "../features/schedule/useScheduleEditor.js";
import { useScheduleRender } from "../features/schedule/useScheduleRender.js";
import {
  flushPendingDraft,
  readSharedSchedule,
  removeSharedSchedule,
  serializeSchedule,
} from "../features/schedule/schedule-storage.js";
import type { Period } from "../features/schedule/types.js";
import { useToast } from "../shared/toast.js";
import { findRoomMatches } from "../../../src/domain/room-matching.js";
import { isPages } from "../features/pages/site-data.js";
import {
  CAMPUS_BRIDGE, CAMPUS_RESPONSIVE_URL, fetchCampusPeriods, isNoClassDate, mapFromCampus,
  needsFridayStudyHall, needsWednesdayPrime, numericCandidates, placementsForDate,
  responsiveColor, responsivePlacements, schoolDate, visibleNumericPeriods,
} from "../features/schedule/campus-sync.js";
import type { CampusPeriods, CampusPlacement } from "../features/schedule/campus-sync.js";

const EMPTY_ROOMS: RoomData["rooms"] = [];
const EMPTY_BUILDINGS: string[] = [];

export function SchedulePage() {
  const showToast = useToast();
  const [directory, setDirectory] = useState<RoomData | null>(null);
  const [sharedPeriods, setSharedPeriods] = useState<Period[] | null>(null);
  const [campusData, setCampusData] = useState<CampusPeriods | null>(null);
  const [campusStatus, setCampusStatus] = useState("Checking local connector…");
  const [campusDate, setCampusDate] = useState(schoolDate);
  const [campusUpdatedAt, setCampusUpdatedAt] = useState("");
  const [responsivePeriods, setResponsivePeriods] = useState<ResponsivePeriod[]>([]);
  const [generatedImage, setGeneratedImage] = useState(savedImagePath);
  const editorForm = useRef<HTMLFormElement>(null);
  const generatedMap = useRef<HTMLDivElement>(null);
  const render = useScheduleRender(showToast);
  const invalidateGenerated = useCallback(() => {
    render.invalidate();
    setGeneratedImage("");
  }, [render.invalidate]);
  const editor = useScheduleEditor(directory, invalidateGenerated, showToast);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const roomsLoaded = directory !== null;
  const rooms = directory?.rooms ?? EMPTY_ROOMS;
  const buildings = directory?.buildings ?? EMPTY_BUILDINGS;
  const requiresReview = editor.review.length > 0;
  const noClassToday = Boolean(campusData && !editor.sharedPreview && isNoClassDate(campusData.calendar, campusDate));
  const visibleNumbers = noClassToday ? [] : campusData && !editor.sharedPreview
    ? visibleNumericPeriods(campusDate) : [1, 2, 3, 4, 5, 6, 7];
  const campusRows = campusData && !noClassToday ? placementsForDate(campusData, campusDate) : [];

  useEffect(() => {
    let active = true;
    let pending = false;
    async function update() {
      if (pending) return;
      pending = true;
      try {
        const result = await fetchCampusPeriods();
        if (!active) return;
        setCampusData(result);
        setCampusStatus("Connected");
        setCampusUpdatedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      } catch (error) {
        if (!active) return;
        setCampusStatus(error instanceof TypeError
          ? "Local connector unavailable. Start it to sync your schedule."
          : error instanceof Error ? error.message : "Campus sync failed.");
      } finally { pending = false; }
    }
    const focused = () => { void update(); };
    const visible = () => { if (document.visibilityState === "visible") void update(); };
    void update();
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.removeEventListener("focus", focused);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  useEffect(() => {
    if (!campusData || !directory || editorRef.current.sharedPreview) return;
    if (isNoClassDate(campusData.calendar, campusDate)) {
      setResponsivePeriods([]);
      invalidateGenerated();
      return;
    }
    const rows = placementsForDate(campusData, campusDate);
    const imported = mapFromCampus(editorRef.current.periods, rows);
    if (JSON.stringify(imported) !== JSON.stringify(editorRef.current.periods)) {
      editorRef.current.syncCampus(imported);
    }
    const responsive: ResponsivePeriod[] = responsivePlacements(rows).map(row => {
      const room = row.room?.trim() ?? "";
      const matches = findRoomMatches(directory.rooms, room);
      return {
        name: row.period?.trim() || "Study Hall", course: row.course || "Selected session",
        startTime: row.start_time, endTime: row.end_time,
        room, building: matches.length === 1 ? matches[0].building : "",
        color: responsiveColor(row.period),
      };
    });
    if (needsFridayStudyHall(campusDate, rows)) responsive.push({
      name: "Study Hall", course: "", startTime: null, endTime: null,
      room: "", building: "", color: responsiveColor("Study Hall"), placeholder: true,
    });
    if (needsWednesdayPrime(campusDate, rows)) responsive.push({
      name: "PRIME", course: "", startTime: null, endTime: null,
      room: "", building: "", color: responsiveColor("PRIME"), placeholder: true,
    });
    setResponsivePeriods(responsive);
    invalidateGenerated();
  }, [campusData, campusDate, directory, editor.sharedPreview, invalidateGenerated]);

  useEffect(() => {
    const controller = new AbortController();
    void loadRoomDirectory(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setDirectory(data);
      setSharedPeriods(readSharedSchedule());
    }).catch(error => {
      if (!controller.signal.aborted) showToast(error instanceof Error ? error.message : String(error));
    });
    return () => controller.abort();
  }, [showToast]);

  function dismissShare() {
    setSharedPeriods(null);
    removeSharedSchedule();
  }

  async function share() {
    flushPendingDraft();
    const encoded = encodeURIComponent(serializeSchedule(editor.periods));
    window.history.replaceState(null, "", `${window.location.origin}${isPages ? import.meta.env.BASE_URL : "/"}#schedule=${encoded}`);
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Share link copied.");
    } catch {
      showToast("Share link ready in the address bar.");
    }
  }

  function chooseCampusCourse(number: number, row: CampusPlacement) {
    const next = editor.periods.map(period => ({ ...period }));
    next[number - 1] = { ...next[number - 1], room: row.room?.trim() ?? "", building: "" };
    editor.syncCampus(next);
  }

  function downloadCampusJson() {
    if (!campusData) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(campusData, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `infinite-campus-periods-${campusData.term}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <header className="page-intro">
        <div className="eyebrow">GUNN HIGH SCHOOL SCHEDULE MAP</div>
        <h1>Your schedule, on the map.</h1>
        <p>Add your rooms and choose a color for each period.</p>
      </header>
      <main id="main-content" className="layout" tabIndex={-1}>
        <section className="editor panel" aria-labelledby="editor-title">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">YOUR SCHEDULE</div>
              <h2 id="editor-title">Your schedule</h2>
            </div>
            <ScheduleActions
              roomsLoaded={roomsLoaded}
              canUndo={editor.canUndo}
              canRedo={editor.canRedo}
              onUndo={editor.undo}
              onRedo={editor.redo}
              onShare={share}
              onExample={editor.loadExample}
              onClear={editor.clearSchedule}
              templates={editor.templates}
              selected={editor.selectedTemplate}
              onLoad={editor.loadTemplate}
              onSave={editor.saveTemplate}
              onDelete={editor.deleteTemplate}
            />
          </div>
          <section className="campus-sync" aria-labelledby="campus-sync-title">
            <div className="campus-sync-heading">
              <div>
                <h3 id="campus-sync-title">Infinite Campus</h3>
                <p role="status">{campusStatus}{campusData ? ` · ${campusData.term} · updated ${campusUpdatedAt}` : ""}</p>
              </div>
              <button type="button" className="primary-button" onClick={() => window.open(`${CAMPUS_BRIDGE}/connect`, "_blank", "noopener")}>
                Connect Infinite Campus
              </button>
            </div>
            {campusData && <>
              <div className="campus-sync-controls">
                <label htmlFor="campus-date">Schedule date</label>
                <input id="campus-date" type="date" value={campusDate} onChange={event => setCampusDate(event.currentTarget.value)} />
                <a className="download-link" href={CAMPUS_RESPONSIVE_URL} target="_blank" rel="noopener noreferrer">Open Responsive Schedule ↗</a>
              </div>
              {!campusData.calendar && <p className="campus-sync-note">School calendar unavailable; weekday breaks may not be detected.</p>}
              {editor.sharedPreview && <p className="campus-sync-note">Campus data is loaded. The shared preview stays in place until you leave preview mode.</p>}
              {!noClassToday && [1, 2, 3, 4, 5, 6, 7].map(number => {
                if (!visibleNumbers.includes(number)) return null;
                const choices = numericCandidates(campusRows, number);
                return choices.length > 1 ? <label className="campus-course-choice" key={number}>
                  <span>Period {number} has multiple active courses. Choose one:</span>
                  <select value={(() => {
                    const index = choices.findIndex(row => row.room?.trim() === editor.periods[number - 1].room.trim());
                    return index < 0 ? "" : String(index);
                  })()} onChange={event => {
                    const row = choices[Number(event.currentTarget.value)];
                    if (row) chooseCampusCourse(number, row);
                  }}>
                    <option value="">Choose a course</option>
                    {choices.map((row, index) => <option key={`${row.course_number}-${row.section}-${index}`} value={index}>{row.course} · {row.room || "no room"}</option>)}
                  </select>
                </label> : null;
              })}
            </>}
          </section>
          {requiresReview && (
            <ScheduleReviewNotice review={editor.review} onConfirm={editor.confirmRooms} />
          )}
          {editor.sharedPreview && (
            <div className="shared-preview-banner" role="region" aria-label="Shared schedule preview">
              <p>Your shared schedule is a temporary preview. Editing it keeps your device draft unchanged.</p>
              <div className="shared-schedule-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={editor.savePreviewToDevice}
                  disabled={!roomsLoaded || requiresReview}
                >
                  Save to this device
                </button>
                <button
                  type="button"
                  className="download-link"
                  onClick={editor.returnToLocalDraft}
                  disabled={!roomsLoaded}
                >
                  Return to my draft
                </button>
              </div>
            </div>
          )}
          <form
            ref={editorForm}
            aria-busy={!roomsLoaded}
            onSubmit={event => {
              event.preventDefault();
              if (roomsLoaded && !noClassToday) void render.generate(editor.periods, rooms, requiresReview, editorForm.current, {
                visibleNumbers,
                mapRevision: directory?.map_revision,
                extras: campusData && !editor.sharedPreview ? responsivePeriods : [],
                onGenerated: imageUrl => {
                  setGeneratedImage(imageUrl);
                  window.requestAnimationFrame(() => generatedMap.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                },
              });
            }}
          >
            {noClassToday ? <div className="no-class-day" role="status">
              <h3>No Class Today, Enjoy your break!</h3>
            </div> : <>
            <PeriodEditor
              periods={editor.periods}
              rooms={rooms}
              buildings={buildings}
              disabled={!roomsLoaded}
              campusRows={campusRows}
              responsivePeriods={campusData && !editor.sharedPreview ? responsivePeriods : []}
              onResponsiveChange={(index, next) => {
                setResponsivePeriods(existing => existing.map((period, current) => current === index ? next : period));
                invalidateGenerated();
              }}
              visibleNumbers={visibleNumbers}
              onChange={editor.edit}
            />
            <div className="form-actions">
              <p className="schedule-validation-message" role="alert">{render.validationMessage}</p>
              <button
                className="primary-button"
                type="submit"
                disabled={!roomsLoaded || render.rendering || requiresReview}
              >
                {render.rendering ? "Generating…" : "Generate Map"}
                <span aria-hidden="true">→</span>
              </button>
            </div>
            </>}
            {campusData && <div className="campus-json-action">
              <button type="button" className="download-link" onClick={downloadCampusJson}>Download period JSON</button>
            </div>}
          </form>
        </section>
        {generatedImage && <div ref={generatedMap} className="generated-map-result">
          <GeneratedMapPanel requestedImage={generatedImage} embedded />
        </div>}
      </main>
      {sharedPeriods && (
        <SharedScheduleDialog
          periods={sharedPeriods}
          rooms={rooms}
          onUse={save => {
            editor.useShared(sharedPeriods, save);
            dismissShare();
          }}
          onDismiss={dismissShare}
        />
      )}
    </>
  );
}
