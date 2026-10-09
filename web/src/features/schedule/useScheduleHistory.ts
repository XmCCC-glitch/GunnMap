import { useRef, useState } from "react";
import type { Period, ScheduleTemplate } from "./types.js";

export interface ScheduleSnapshot {
  periods: Period[];
  sharedPreview: boolean;
  draft: Period[] | null;
  templates: ScheduleTemplate[];
  selectedTemplate: string;
}

const MAX_HISTORY = 20;
const INPUT_GROUP_MS = 700;

export function useScheduleHistory(
  capture: (previous?: Period[]) => ScheduleSnapshot,
  restore: (snapshot: ScheduleSnapshot) => Promise<boolean>,
  showToast: (message: string) => void,
) {
  const [undoHistory, setUndoHistory] = useState<ScheduleSnapshot[]>([]);
  const [redoHistory, setRedoHistory] = useState<ScheduleSnapshot[]>([]);
  const lastInputUndoAt = useRef(-Infinity);

  function recordChange() {
    setUndoHistory(history => [...history.slice(-(MAX_HISTORY - 1)), capture()]);
    setRedoHistory([]);
    lastInputUndoAt.current = -Infinity;
  }

  function recordInput(previous: Period[]) {
    const now = performance.now();
    if (now - lastInputUndoAt.current > INPUT_GROUP_MS) {
      setUndoHistory(history => [...history.slice(-(MAX_HISTORY - 1)), capture(previous)]);
    }
    lastInputUndoAt.current = now;
    setRedoHistory([]);
  }

  async function undo() {
    const previous = undoHistory.at(-1);
    if (!previous) return;
    setUndoHistory(undoHistory.slice(0, -1));
    setRedoHistory([...redoHistory, capture()]);
    lastInputUndoAt.current = -Infinity;
    showToast(await restore(previous)
      ? "Last change undone."
      : "Change undone in the editor, but browser storage could not be updated.");
  }

  async function redo() {
    const next = redoHistory.at(-1);
    if (!next) return;
    setRedoHistory(redoHistory.slice(0, -1));
    setUndoHistory([...undoHistory, capture()]);
    lastInputUndoAt.current = -Infinity;
    showToast(await restore(next)
      ? "Change restored."
      : "Change restored in the editor, but browser storage could not be updated.");
  }

  return { canUndo: undoHistory.length > 0, canRedo: redoHistory.length > 0, recordChange, recordInput, undo, redo };
}
