import { useEffect, useRef, useState } from "react";
import { loadRoomDirectory } from "../features/rooms/room-api.js";
import type { RoomData } from "../features/rooms/types.js";
import { PeriodEditor } from "../features/schedule/PeriodEditor.js";
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

const EMPTY_ROOMS: RoomData["rooms"] = [];
const EMPTY_BUILDINGS: string[] = [];

export function SchedulePage() {
  const showToast = useToast();
  const [directory, setDirectory] = useState<RoomData | null>(null);
  const [sharedPeriods, setSharedPeriods] = useState<Period[] | null>(null);
  const editorForm = useRef<HTMLFormElement>(null);
  const render = useScheduleRender(showToast);
  const editor = useScheduleEditor(directory, render.invalidate, showToast);
  const roomsLoaded = directory !== null;
  const rooms = directory?.rooms ?? EMPTY_ROOMS;
  const buildings = directory?.buildings ?? EMPTY_BUILDINGS;
  const requiresReview = editor.review.length > 0;

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
    window.history.replaceState(null, "", `${window.location.origin}/#schedule=${encoded}`);
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Share link copied.");
    } catch {
      showToast("Share link ready in the address bar.");
    }
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
              if (roomsLoaded) void render.generate(editor.periods, rooms, requiresReview, editorForm.current);
            }}
          >
            <PeriodEditor
              periods={editor.periods}
              rooms={rooms}
              buildings={buildings}
              disabled={!roomsLoaded}
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
          </form>
        </section>
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
