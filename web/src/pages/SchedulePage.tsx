import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PeriodEditor } from "../features/schedule/PeriodEditor.js";
import {
  EXAMPLE_SCHEDULE,
  GENERATED_MAP_SESSION_KEY,
  PERIOD_COLORS,
  clearDraft,
  defaultPeriods,
  loadDraft,
  loadTemplates,
  readSharedSchedule,
  removeSharedSchedule,
  saveCurrentSchedule,
  saveDraft,
  queueDraft,
  flushPendingDraft,
  saveTemplates,
  loadSharedPreview,
  saveSharedPreview,
} from "../features/schedule/schedule-storage.js";
import type { Period, ScheduleTemplate } from "../features/schedule/types.js";
import type { RoomOption } from "../features/rooms/types.js";
import { buildingName } from "../features/rooms/room-display.js";
import { findRoomMatches } from "../../../src/domain/room-matching.js";
import { periodRoomState } from "../features/schedule/room-validation.js";
import type { CSSVariables } from "../shared/css-types.js";
import { useToast } from "../shared/toast.js";
import { isPages, loadRooms } from "../features/pages/site-data.js";

interface ActiveRender {
  revision: number;
  promise: Promise<boolean>;
}
interface ScheduleSnapshot {
  periods: Period[];
  sharedPreview: boolean;
  draft: Period[] | null;
  templates: ScheduleTemplate[];
  selectedTemplate: string;
}

function clonePeriods(periods: Period[]) {
  return periods.map(period => ({ ...period }));
}

function removeGeneratedMap() {
  try {
    window.sessionStorage.removeItem(GENERATED_MAP_SESSION_KEY);
  } catch {
    // Keep editing available when session storage is disabled.
  }
}

export function SchedulePage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [buildings, setBuildings] = useState<string[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [periods, setPeriods] = useState<Period[]>(() => loadSharedPreview() ?? loadDraft() ?? defaultPeriods());
  const [sharedPreview, setSharedPreview] = useState(() => Boolean(loadSharedPreview()));
  const [validationMessage, setValidationMessage] = useState("");
  const [templates, setTemplates] = useState<ScheduleTemplate[]>(() => loadTemplates());
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [rendering, setRendering] = useState(false);
  const [sharedPeriods, setSharedPeriods] = useState<Period[] | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [pendingDeleteName, setPendingDeleteName] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [undoHistory, setUndoHistory] = useState<ScheduleSnapshot[]>([]);
  const [redoHistory, setRedoHistory] = useState<ScheduleSnapshot[]>([]);
  const revision = useRef(0);
  const activeRender = useRef<ActiveRender | null>(null);
  const lastInputUndoAt = useRef(-Infinity);
  const editorForm = useRef<HTMLFormElement>(null);
  const templateDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const sharedDialog = useRef<HTMLDialogElement>(null);
  const pendingDelete = useRef("");

  const invalidatePreview = useCallback(() => {
    revision.current += 1;
    setRendering(false);
    removeGeneratedMap();
  }, []);
  useEffect(() => () => { revision.current += 1; }, []);
  useEffect(() => {
    const flush = () => { flushPendingDraft(); };
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  const writeSchedule = useCallback((
    next: Period[],
    { preview = sharedPreview, persistDraft = !preview, clearShare = true }: { preview?: boolean; persistDraft?: boolean; clearShare?: boolean } = {},
  ) => {
    flushPendingDraft();
    const normalized = PERIOD_COLORS.map((fallbackColor, index) => {
      const period = next[index];
      let building = period?.building && buildings.includes(period.building)
        ? period.building
        : "";
      if (!building && period?.room) {
        const candidates = [...new Set(findRoomMatches(rooms, period.room).map(room => room.building))];
        if (candidates.length === 1) building = candidates[0];
      }
      const color = period && /^#[0-9a-f]{6}$/i.test(period.color)
        ? period.color
        : fallbackColor;

      return {
        building,
        room: period?.room ?? "",
        color,
      };
    });

    setPeriods(normalized);
    saveCurrentSchedule(normalized);
    const saved = !persistDraft || saveDraft(normalized);
    if (!saved) {
      showToast("Draft could not be saved in this browser.");
    }
    const stayInPreview = preview || (!saved && sharedPreview);
    setSharedPreview(stayInPreview);
    saveSharedPreview(stayInPreview ? normalized : null);
    setValidationMessage("");
    if (clearShare) removeSharedSchedule();
    invalidatePreview();
    return saved;
  }, [buildings, rooms, sharedPreview, invalidatePreview, showToast]);

  useEffect(() => {
    let current = true;
    void loadRooms()
      .then(data => {
        if (!current) return;
        setRooms(data.rooms);
        setBuildings(data.buildings);
        setPeriods(existing => {
          const inferred = existing.map(period => {
            if (period.building) return period;
            const matches = findRoomMatches(data.rooms, period.room);
            const candidates = [...new Set(matches.map(room => room.building))];
            return candidates.length === 1
              ? { ...period, building: candidates[0] }
              : period;
          });
          saveCurrentSchedule(inferred);
          return inferred;
        });
        setRoomsLoaded(true);

        const shared = readSharedSchedule();
        if (shared) {
          setSharedPeriods(shared);
          sharedDialog.current?.showModal();
        }
      })
      .catch(error => {
        if (!current) return;
        const message = error instanceof Error
          ? error.message
          : "Room list unavailable.";
        showToast(message);
      });

    return () => {
      current = false;
    };
  }, [showToast]);

  const snapshot = useCallback((previous = periods): ScheduleSnapshot => ({
    periods: clonePeriods(previous), sharedPreview, draft: loadDraft(),
    templates: templates.map(template => ({ name: template.name, periods: clonePeriods(template.periods) })),
    selectedTemplate,
  }), [periods, sharedPreview, templates, selectedTemplate]);

  const recordUndo = useCallback((previous: Period[]) => {
    setUndoHistory(history => [...history.slice(-19), snapshot(previous)]);
    setRedoHistory([]);
    lastInputUndoAt.current = -Infinity;
  }, [snapshot]);

  const handleEdit = useCallback((next: Period[], previous: Period[]) => {
    const now = performance.now();
    if (now - lastInputUndoAt.current > 700) {
      setUndoHistory(history => [...history.slice(-19), snapshot(previous)]);
    }
    lastInputUndoAt.current = now;
    setRedoHistory([]);
    setPeriods(next);
    saveCurrentSchedule(next);
    if (!sharedPreview) queueDraft(next, () => showToast("Draft could not be saved in this browser."));
    saveSharedPreview(sharedPreview ? next : null);
    setValidationMessage("");
    invalidatePreview();
    removeSharedSchedule();
  }, [sharedPreview, snapshot, invalidatePreview, showToast]);

  const restoreSnapshot = (entry: ScheduleSnapshot) => {
    writeSchedule(entry.periods, { persistDraft: false, preview: entry.sharedPreview });
    const draftSaved = entry.draft ? saveDraft(entry.draft) : clearDraft();
    const templatesSaved = JSON.stringify(templates) === JSON.stringify(entry.templates) || saveTemplates(entry.templates);
    setTemplates(entry.templates);
    setSelectedTemplate(entry.selectedTemplate);
    lastInputUndoAt.current = -Infinity;
    return draftSaved && templatesSaved;
  };

  const undo = () => {
    const previous = undoHistory.at(-1);
    if (!previous) return;
    setUndoHistory(undoHistory.slice(0, -1));
    setRedoHistory([...redoHistory, snapshot()]);
    showToast(restoreSnapshot(previous) ? "Last change undone." : "Change undone in the editor, but browser storage could not be updated.");
  };

  const redo = () => {
    const next = redoHistory.at(-1);
    if (!next) return;
    setRedoHistory(redoHistory.slice(0, -1));
    setUndoHistory([...undoHistory, snapshot()]);
    showToast(restoreSnapshot(next) ? "Change restored." : "Change restored in the editor, but browser storage could not be updated.");
  };

  const useShared = (save: boolean) => {
    if (!sharedPeriods) return;
    recordUndo(periods);
    // Enter preview first so a failed Save and use never falls back to autosave.
    if (save && !saveDraft(sharedPeriods)) {
      writeSchedule(sharedPeriods, { persistDraft: false, preview: true });
      showToast("Shared schedule opened as a preview. It could not be saved on this device.");
    } else {
      writeSchedule(sharedPeriods, { persistDraft: false, preview: !save });
      showToast(save ? "Shared schedule saved on this device." : "Shared schedule loaded for this session. Your device draft is unchanged.");
    }
    setSharedPeriods(null);
    sharedDialog.current?.close();
  };

  const savePreviewToDevice = () => {
    recordUndo(periods);
    if (writeSchedule(periods, { preview: false, persistDraft: true })) {
      showToast("Shared schedule saved on this device.");
    }
  };

  const returnToLocalDraft = () => {
    recordUndo(periods);
    writeSchedule(loadDraft() ?? defaultPeriods(), { preview: false, persistDraft: false });
    showToast("Your device draft is back in the editor.");
  };

  const share = async () => {
    flushPendingDraft();
    setMoreOpen(false);
    const encoded = encodeURIComponent(JSON.stringify(periods));
    const shareUrl = `${window.location.origin}${isPages ? import.meta.env.BASE_URL : "/"}#schedule=${encoded}`;
    window.history.replaceState(null, "", shareUrl);
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Share link copied.");
    } catch {
      showToast("Share link ready in the address bar.");
    }
  };

  const saveTemplate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    flushPendingDraft();
    const name = templateName.trim().slice(0, 60);
    if (!name) {
      setTemplateMessage("Enter a name for this schedule.");
      return;
    }

    const next = [
      { name, periods: clonePeriods(periods) },
      ...templates.filter(item => item.name !== name),
    ].slice(0, 8);
    if (!saveTemplates(next)) {
      setTemplateMessage(
        "Template could not be saved in this browser. Browser storage may be disabled or full.",
      );
      return;
    }
    recordUndo(periods);
    setTemplates(next);
    setSelectedTemplate(name);
    templateDialog.current?.close();
    showToast(`${name} saved.`);
  };

  const loadTemplate = (name: string) => {
    setSelectedTemplate(name);
    if (!name) return;
    setMoreOpen(false);
    const template = templates.find(item => item.name === name);
    if (!template) return;
    recordUndo(periods);
    writeSchedule(template.periods);
    showToast(`${name} loaded.`);
  };

  const deleteTemplate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = pendingDelete.current;
    const next = templates.filter(item => item.name !== name);
    if (!saveTemplates(next)) {
      setDeleteMessage("Template could not be deleted in this browser.");
      return;
    }
    recordUndo(periods);
    setTemplates(next);
    setSelectedTemplate("");
    deleteDialog.current?.close();
    showToast(`${name} deleted.`);
  };

  const openTemplateDialog = () => {
    setMoreOpen(false);
    setTemplateName(`Schedule ${templates.length + 1}`);
    setTemplateMessage("");
    templateDialog.current?.showModal();
  };

  const openDeleteDialog = () => {
    pendingDelete.current = selectedTemplate;
    setPendingDeleteName(selectedTemplate);
    setDeleteMessage("");
    deleteDialog.current?.showModal();
  };

  const loadExample = () => {
    setMoreOpen(false);
    recordUndo(periods);
    const example = EXAMPLE_SCHEDULE.map(({ building, room }, index) => ({
      building,
      room,
      color: PERIOD_COLORS[index],
    }));
    writeSchedule(example);
    showToast("Example loaded. Select Generate Map to preview it.");
  };

  const clearSchedule = () => {
    setMoreOpen(false);
    recordUndo(periods);
    writeSchedule(defaultPeriods(), { persistDraft: false });
    const cleared = sharedPreview || clearDraft();
    showToast(cleared
      ? (sharedPreview ? "Preview cleared. Your device draft is unchanged." : "Schedule cleared.")
      : "Schedule cleared, but the saved draft could not be removed.");
  };

  const closeSharedPreview = () => {
    setSharedPeriods(null);
    removeSharedSchedule();
    sharedDialog.current?.close();
  };

  const generateMap = async () => {
    flushPendingDraft();
    if (!roomsLoaded) return;
    if (activeRender.current?.revision === revision.current) {
      return activeRender.current.promise;
    }
    invalidatePreview();
    const invalid = periods.map((period, index) => ({ index, ...periodRoomState(period, rooms) })).filter(item => item.invalid);
    if (invalid.length) {
      setValidationMessage(`Check period${invalid.length === 1 ? "" : "s"} ${invalid.map(item => item.index + 1).join(", ")}. Choose a recognized room before generating.`);
      const input = editorForm.current?.querySelector<HTMLInputElement>(`#period-${invalid[0].index + 1}-room`);
      input?.focus();
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    setValidationMessage("");
    setRendering(true);
    const requestRevision = revision.current;
    const request: ActiveRender = {
      revision: requestRevision,
      promise: (async () => {
        try {
          const imageUrl = isPages ? await import("../features/pages/render-map.js").then(module => module.renderPagesMap(periods)) : await (async () => {
            const response = await fetch("/api/render", {
              method: "POST",
              credentials: "omit",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ periods: periods.map(period => ({
                ...period,
                room: period.room.trim(),
                building: period.room.trim() ? findRoomMatches(rooms, period.room, period.building)[0].building : "",
              })) }),
            });
            const result = await response.json() as {
              image_url?: string;
              error?: string;
            };
            if (!response.ok || !result.image_url) throw new Error(result.error ?? "Map generation failed.");
            return result.image_url;
          })();
          if (requestRevision !== revision.current) return false;
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          if (requestRevision !== revision.current) return false;
          if (isPages && imageUrl.length >= 8_000_000) throw new Error("The generated map is too large for this browser. Try fewer rooms.");
          try {
            sessionStorage.setItem(GENERATED_MAP_SESSION_KEY, imageUrl);
          } catch {
            if (isPages) throw new Error("Browser session storage is unavailable. Enable it to view the generated map.");
            // Server-generated image URLs remain shareable without session storage.
          }
          navigate(isPages ? "/generate-map" : `/generate-map?image=${encodeURIComponent(imageUrl)}`);
          return true;
        } catch (error) {
          if (requestRevision === revision.current) {
            const message = error instanceof Error ? error.message : String(error);
            showToast(message);
          }
          return false;
        }
      })().finally(() => {
        if (activeRender.current === request) {
          activeRender.current = null;
          setRendering(false);
        }
      }),
    };
    activeRender.current = request;
    return request.promise;
  };

  const shared = sharedPeriods ?? [];

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
            <div className="panel-actions">
              <button
                className="icon-button"
                type="button"
                aria-label="Undo"
                disabled={!undoHistory.length || !roomsLoaded}
                onClick={undo}
              >
                <span className="action-icon icon-undo" aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Redo"
                disabled={!redoHistory.length || !roomsLoaded}
                onClick={redo}
              >
                <span className="action-icon icon-redo" aria-hidden="true" />
              </button>
              <details
                className="editor-more"
                open={moreOpen}
                onToggle={event => setMoreOpen(
                  (event.currentTarget as HTMLDetailsElement).open,
                )}
              >
                <summary>More</summary>
                <div className="more-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void share()}
                  >
                    Share Link
                  </button>
                  <details
                    className="editor-options"
                    open={savedOpen}
                    onToggle={event => setSavedOpen(
                      (event.currentTarget as HTMLDetailsElement).open,
                    )}
                  >
                    <summary>Saved schedules</summary>
                    <div className="template-controls">
                      <label htmlFor="template-select">
                        Choose a saved schedule
                      </label>
                      <select
                        id="template-select"
                        aria-label="Saved schedules"
                        value={selectedTemplate}
                        onChange={event => loadTemplate(event.currentTarget.value)}
                      >
                        <option value="">Choose a saved schedule</option>
                        {templates.map(template => (
                          <option value={template.name} key={template.name}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="text-button"
                        type="button"
                        onClick={openTemplateDialog}
                      >
                        Save current
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        disabled={!selectedTemplate}
                        onClick={openDeleteDialog}
                      >
                        Delete
                      </button>
                    </div>
                  </details>
                  <button
                    className="text-button"
                    type="button"
                    onClick={loadExample}
                  >
                    Load Example
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={clearSchedule}
                  >
                    Clear Schedule
                  </button>
                </div>
              </details>
            </div>
          </div>
          {sharedPreview && (
            <div className="shared-preview-banner" role="region" aria-label="Shared schedule preview">
              <p>Your shared schedule is a temporary preview. Editing it keeps your device draft unchanged.</p>
              <div className="shared-schedule-actions">
                <button type="button" className="primary-button" onClick={savePreviewToDevice} disabled={!roomsLoaded}>Save to this device</button>
                <button type="button" className="download-link" onClick={returnToLocalDraft} disabled={!roomsLoaded}>Return to my draft</button>
              </div>
            </div>
          )}
          <form
            ref={editorForm}
            onSubmit={event => {
              event.preventDefault();
              void generateMap();
            }}
            aria-busy={!roomsLoaded}
          >
            <PeriodEditor
              periods={periods}
              rooms={rooms}
              buildings={buildings}
              disabled={!roomsLoaded}
              onChange={handleEdit}
            />
            <div className="form-actions">
              <p className="schedule-validation-message" role="alert">{validationMessage}</p>
              <button
                className="primary-button"
                type="submit"
                disabled={!roomsLoaded || rendering}
              >
                {rendering ? "Generating…" : "Generate Map"}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        </section>
      </main>

      <dialog
        ref={sharedDialog}
        className="room-dialog shared-schedule-dialog"
        aria-labelledby="shared-schedule-title"
        onClose={() => { setSharedPeriods(null); removeSharedSchedule(); }}
      >
        <div className="panel-heading">
          <div>
            <div className="eyebrow">SHARED SCHEDULE</div>
            <h2 id="shared-schedule-title">Preview this schedule</h2>
          </div>
          <form method="dialog">
            <button
              className="dialog-close"
              aria-label="Close shared schedule preview"
            >
              ×
            </button>
          </form>
        </div>
        <p className="map-help">
          Your saved schedule stays untouched until you choose to save this one.
        </p>
        <ol className="shared-schedule-preview">
          {shared.map((period, index) => {
            const matches = findRoomMatches(rooms, period.room, period.building);
            const building = period.building || (matches.length === 1 ? matches[0].building : "");
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
          <button
            className="download-link"
            type="button"
            onClick={() => useShared(false)}
          >
            Use once
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => useShared(true)}
          >
            Save and use
          </button>
          <button
            className="text-button"
            type="button"
            onClick={closeSharedPreview}
          >
            Keep my current schedule
          </button>
        </div>
      </dialog>
      <dialog
        ref={templateDialog}
        className="room-dialog template-dialog"
        aria-labelledby="template-dialog-title"
      >
        <h2 id="template-dialog-title">Save Schedule Template</h2>
        <form onSubmit={saveTemplate}>
          <label className="field template-name-field" htmlFor="template-name">
            <span>Template name</span>
            <input
              id="template-name"
              type="text"
              maxLength={60}
              required
              autoComplete="off"
              value={templateName}
              onChange={event => setTemplateName(event.currentTarget.value)}
            />
          </label>
          <p className="warning" role="alert">{templateMessage}</p>
          <div className="form-actions">
            <button className="primary-button" type="submit">
              Save Template
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => templateDialog.current?.close()}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={deleteDialog}
        className="room-dialog template-dialog"
        aria-labelledby="delete-template-title"
      >
        <h2 id="delete-template-title">Delete Template</h2>
        <p className="map-help">
          Delete the “{pendingDeleteName}” template? Your current schedule will
          stay in the editor.
        </p>
        <p className="warning" role="alert">{deleteMessage}</p>
        <form className="form-actions" onSubmit={deleteTemplate}>
          <button className="primary-button" type="submit">
            Delete Template
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => deleteDialog.current?.close()}
          >
            Cancel
          </button>
        </form>
      </dialog>
    </>
  );
}
