import { useEffect, useState } from "react";
import type { RoomData } from "../rooms/types.js";
import { bindCurrentRooms, bindEditedRooms, scheduleReview } from "./schedule-review.js";
import { inferRoomBuilding } from "./room-validation.js";
import { useScheduleHistory } from "./useScheduleHistory.js";
import type { ScheduleSnapshot } from "./useScheduleHistory.js";
import {
  EXAMPLE_SCHEDULE,
  PERIOD_COLORS,
  clearDraft,
  defaultPeriods,
  flushPendingDraft,
  loadDraft,
  loadReviewPreview,
  loadSharedPreview,
  loadTemplates,
  queueDraft,
  removeSharedSchedule,
  saveCurrentSchedule,
  saveDraft,
  saveReviewPreview,
  saveSharedPreview,
  saveTemplates,
  templateSaveError,
} from "./schedule-storage.js";
import type { Period, ScheduleTemplate } from "./types.js";

const EMPTY_ROOMS: RoomData["rooms"] = [];
const clonePeriods = (periods: Period[]) => periods.map(period => ({ ...period }));

interface ReplaceOptions {
  preview?: boolean;
  persistDraft?: boolean;
}

export function useScheduleEditor(
  directory: RoomData | null,
  invalidatePreview: () => void,
  showToast: (message: string) => void,
) {
  const [schedule, setSchedule] = useState(() => {
    const shared = loadSharedPreview();
    return {
      periods: shared ?? loadReviewPreview() ?? loadDraft() ?? defaultPeriods(),
      sharedPreview: shared !== null,
    };
  });
  const [templates, setTemplates] = useState<ScheduleTemplate[]>(loadTemplates);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const { periods, sharedPreview } = schedule;
  const rooms = directory?.rooms ?? EMPTY_ROOMS;
  const mapRevision = directory?.map_revision ?? "";
  const review = directory ? scheduleReview(periods, rooms, mapRevision) : [];

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

  useEffect(() => {
    if (!directory) return;
    setSchedule(existing => {
      const inferred = existing.periods.map(period => {
        if (period.building || period.mapRevision !== directory.map_revision) return period;
        const building = inferRoomBuilding(directory.rooms, period.room);
        return building ? { ...period, building } : period;
      });
      saveCurrentSchedule(inferred);
      return { ...existing, periods: inferred };
    });
  }, [directory]);

  useEffect(() => {
    if (review.length) invalidatePreview();
  }, [directory, review.length, invalidatePreview]);

  function replace(next: Period[], { preview = sharedPreview, persistDraft = !preview }: ReplaceOptions = {}) {
    flushPendingDraft();
    // All callers supply validated Period[]; only building identity depends on this directory.
    const loaded = directory ? next.map(period => {
      const currentBuilding = directory.buildings.includes(period.building) ? period.building : "";
      const building = currentBuilding || (period.mapRevision === mapRevision
        ? inferRoomBuilding(rooms, period.room) : "");
      return { ...period, building };
    }) : next;
    saveCurrentSchedule(loaded);
    const needsReview = scheduleReview(loaded, rooms, mapRevision).length > 0;
    const saved = !persistDraft || (!needsReview && saveDraft(loaded));
    saveReviewPreview(needsReview && !preview ? loaded : null);
    if (!saved && !needsReview) showToast("Draft could not be saved in this browser.");
    const stayInPreview = preview || (!saved && sharedPreview);
    setSchedule({ periods: loaded, sharedPreview: stayInPreview });
    saveSharedPreview(stayInPreview ? loaded : null);
    removeSharedSchedule();
    invalidatePreview();
    return saved;
  }

  function capture(previous = periods): ScheduleSnapshot {
    return {
      periods: clonePeriods(previous), sharedPreview, draft: loadDraft(),
      templates: templates.map(template => ({ name: template.name, periods: clonePeriods(template.periods) })),
      selectedTemplate,
    };
  }

  async function restore(entry: ScheduleSnapshot) {
    replace(entry.periods, { persistDraft: false, preview: entry.sharedPreview });
    const draftSaved = entry.draft ? saveDraft(entry.draft) : clearDraft();
    const templatesSaved = JSON.stringify(templates) === JSON.stringify(entry.templates)
      || await saveTemplates(entry.templates);
    setTemplates(entry.templates);
    setSelectedTemplate(entry.selectedTemplate);
    return draftSaved && templatesSaved;
  }

  const history = useScheduleHistory(capture, restore, showToast);

  function edit(next: Period[], previous: Period[]) {
    history.recordInput(previous);
    const identified = bindEditedRooms(next, previous, rooms, mapRevision);
    const needsReview = scheduleReview(identified, rooms, mapRevision).length > 0;
    setSchedule({ periods: identified, sharedPreview });
    saveCurrentSchedule(identified);
    if (!sharedPreview && !needsReview) {
      queueDraft(identified, () => showToast("Draft could not be saved in this browser."));
    }
    saveReviewPreview(needsReview && !sharedPreview ? identified : null);
    saveSharedPreview(sharedPreview ? identified : null);
    invalidatePreview();
    removeSharedSchedule();
  }

  function useShared(sharedPeriods: Period[], save: boolean) {
    history.recordChange();
    const needsReview = scheduleReview(sharedPeriods, rooms, mapRevision).length > 0;
    if (needsReview) {
      replace(sharedPeriods, { persistDraft: false, preview: true });
      showToast("Review these rooms against the current map before saving or generating.");
    } else if (save && !saveDraft(sharedPeriods)) {
      replace(sharedPeriods, { persistDraft: false, preview: true });
      showToast("Shared schedule opened as a preview. It could not be saved on this device.");
    } else {
      replace(sharedPeriods, { persistDraft: false, preview: !save });
      showToast(save ? "Shared schedule saved on this device."
        : "Shared schedule loaded for this session. Your device draft is unchanged.");
    }
  }

  function confirmRooms() {
    if (review.some(item => !item.current)) return;
    history.recordChange();
    const saved = replace(bindCurrentRooms(periods, rooms, mapRevision));
    showToast(sharedPreview ? "Room choices confirmed for this preview. Save to this device when ready."
      : saved ? "Room choices confirmed and saved for the current map."
        : "Room choices confirmed, but the draft could not be saved.");
  }

  function savePreviewToDevice() {
    history.recordChange();
    if (replace(periods, { preview: false, persistDraft: true })) {
      showToast("Shared schedule saved on this device.");
    }
  }

  function returnToLocalDraft() {
    history.recordChange();
    replace(loadDraft() ?? defaultPeriods(), { preview: false, persistDraft: false });
    showToast("Your device draft is back in the editor.");
  }

  async function saveTemplate(name: string): Promise<string | null> {
    flushPendingDraft();
    const next = [
      { name, periods: clonePeriods(periods) },
      ...templates.filter(item => item.name !== name),
    ].slice(0, 8);
    if (!await saveTemplates(next)) {
      return templateSaveError() === "capacity"
        ? "This save exceeds the available browser storage capacity. Your existing saved schedules are unchanged."
        : "Could not confirm this save in your browser. Storage may be disabled or full. Your previously saved data has been retained.";
    }
    history.recordChange();
    setTemplates(next);
    setSelectedTemplate(name);
    showToast(`${name} saved.`);
    return null;
  }

  function loadTemplate(name: string) {
    setSelectedTemplate(name);
    if (!name) return;
    const template = templates.find(item => item.name === name);
    if (!template) return;
    history.recordChange();
    replace(template.periods);
    showToast(`${name} loaded.`);
  }

  async function deleteTemplate(name: string): Promise<string | null> {
    const next = templates.filter(item => item.name !== name);
    if (!await saveTemplates(next)) {
      return "Could not confirm this deletion in your browser. Your previously saved data has been retained.";
    }
    history.recordChange();
    setTemplates(next);
    setSelectedTemplate("");
    showToast(`${name} deleted.`);
    return null;
  }

  function loadExample() {
    history.recordChange();
    const example = EXAMPLE_SCHEDULE.map(({ building, room }, index) => ({
      building, room, color: PERIOD_COLORS[index],
    }));
    replace(bindCurrentRooms(example, rooms, mapRevision));
    showToast("Example loaded. Select Generate Map to preview it.");
  }

  function clearSchedule() {
    history.recordChange();
    replace(defaultPeriods(), { persistDraft: false });
    const cleared = sharedPreview || clearDraft();
    showToast(cleared
      ? (sharedPreview ? "Preview cleared. Your device draft is unchanged." : "Schedule cleared.")
      : "Schedule cleared, but the saved draft could not be removed.");
  }

  return {
    periods, sharedPreview, review, templates, selectedTemplate,
    canUndo: history.canUndo, canRedo: history.canRedo, undo: history.undo, redo: history.redo,
    edit, useShared, confirmRooms, savePreviewToDevice, returnToLocalDraft,
    saveTemplate, loadTemplate, deleteTemplate, loadExample, clearSchedule,
  };
}
