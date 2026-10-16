import { useCallback, useEffect, useRef, useState } from "react";
import type { CampusCommand, CampusConnectionState } from "../../../../src/domain/campus-contract.js";
import { CampusExtensionUnavailable, campusExtensionRequest, onCampusExtensionChange } from "./campus-extension.js";
import { bookmarkImportState, cancelBookmarkImport, CAMPUS_BOOKMARK_EVENT } from "./campus-bookmark.js";
import { forgetLocalCampus, newestCampusImport, readLocalCampus } from "./campus-local.js";

const INITIAL: CampusConnectionState = { phase: "idle", message: "Import once, then use your saved schedule.", saved: null };

export function useCampusConnection() {
  const [state, setState] = useState<CampusConnectionState>(INITIAL);
  const [available, setAvailable] = useState<boolean | null>(null);
  const revision = useRef(0);
  const alive = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const availableRef = useRef<boolean | null>(null);

  const request = useCallback(async (command: CampusCommand = "status") => {
    const current = ++revision.current;
    if (command === "connect" || command === "cancel" || command === "forget") cancelBookmarkImport();
    if (command === "forget") {
      try { forgetLocalCampus(); }
      catch { setState(previous => ({ ...previous, phase: "error", message: "The saved import could not be removed. Check browser storage permissions." })); return; }
      setState({ phase: "idle", message: "Campus import forgotten. Existing room choices remain.", saved: null });
      if (availableRef.current === false) return;
    }
    if (command === "cancel" && availableRef.current === false) {
      const saved = newestCampusImport(readLocalCampus(), null);
      setState({ phase: saved ? "saved" : "idle", message: "Import cancelled.", saved });
      return;
    }
    const controller = new AbortController();
    requests.current.add(controller);
    if (command === "connect") setState(previous => ({ ...previous, phase: "waiting", message: "Opening the official Campus sign-in page…" }));
    try {
      const next = await campusExtensionRequest(command, controller.signal);
      if (!alive.current || current !== revision.current) return;
      setAvailable(true);
      availableRef.current = true;
      const saved = newestCampusImport(readLocalCampus(), next.saved);
      const bookmark = bookmarkImportState();
      const result = command === "status" && bookmark.phase !== "idle" ? bookmark : next;
      setState(previous => ({ phase: result.phase === "idle" && saved ? "saved" : result.phase,
        message: result.phase === "idle" && saved ? "Saved on this device. Update when your classes change." : result.message,
        saved: previous.saved?.imported_at === saved?.imported_at ? previous.saved : saved }));
    } catch (error) {
      if (!alive.current || current !== revision.current || controller.signal.aborted) return;
      const missing = error instanceof CampusExtensionUnavailable;
      if (missing) { setAvailable(false); availableRef.current = false; }
      const bookmark = bookmarkImportState();
      setState(previous => {
        const saved = newestCampusImport(readLocalCampus(), previous.saved);
        return { saved, phase: bookmark.phase !== "idle" ? bookmark.phase : missing ? saved ? "saved" : "idle" : "error",
          message: bookmark.phase !== "idle" ? bookmark.message : missing
            ? saved ? "Saved on this device. Update when your classes change." : INITIAL.message
            : error instanceof Error ? error.message : "Campus connection failed." };
      });
    } finally { requests.current.delete(controller); }
  }, []);

  useEffect(() => {
    alive.current = true;
    const refresh = () => { void request("status"); };
    const stop = onCampusExtensionChange(refresh);
    const localChanged = () => {
      const bookmark = bookmarkImportState();
      setState(previous => {
        const saved = newestCampusImport(readLocalCampus(), previous.saved);
        return { saved, phase: bookmark.phase !== "idle" ? bookmark.phase : saved ? "saved" : "idle",
          message: bookmark.message || (saved ? "Saved on this device. Update when your classes change." : INITIAL.message) };
      });
    };
    localChanged();
    window.addEventListener(CAMPUS_BOOKMARK_EVENT, localChanged);
    window.addEventListener("storage", localChanged);
    void request("status");
    // This only reads the extension's saved data. It never refreshes the IC session.
    window.addEventListener("focus", refresh);
    return () => {
      alive.current = false;
      revision.current += 1;
      for (const controller of requests.current) controller.abort();
      requests.current.clear();
      stop();
      window.removeEventListener(CAMPUS_BOOKMARK_EVENT, localChanged);
      window.removeEventListener("storage", localChanged);
      window.removeEventListener("focus", refresh);
    };
  }, [request]);

  return {
    ...state, available, busy: state.phase === "waiting" || state.phase === "reading",
    connect: () => request("connect"), cancel: () => request("cancel"), forget: () => request("forget"),
    refresh: () => request("status"),
  };
}
