import { useCallback, useEffect, useRef, useState } from "react";
import type { CampusCommand, CampusConnectionState } from "../../../../src/domain/campus-contract.js";
import { CampusExtensionUnavailable, campusExtensionRequest, onCampusExtensionChange } from "./campus-extension.js";

const INITIAL: CampusConnectionState = { phase: "idle", message: "Checking saved Campus import…", saved: null };

export function useCampusConnection() {
  const [state, setState] = useState<CampusConnectionState>(INITIAL);
  const [available, setAvailable] = useState<boolean | null>(null);
  const revision = useRef(0);
  const alive = useRef(false);
  const requests = useRef(new Set<AbortController>());

  const request = useCallback(async (command: CampusCommand = "status") => {
    const current = ++revision.current;
    const controller = new AbortController();
    requests.current.add(controller);
    if (command === "connect") setState(previous => ({ ...previous, phase: "waiting", message: "Opening the official Campus sign-in page…" }));
    try {
      const next = await campusExtensionRequest(command, controller.signal);
      if (!alive.current || current !== revision.current) return;
      setAvailable(true);
      setState(previous => ({ ...next, saved: previous.saved?.imported_at === next.saved?.imported_at
        ? previous.saved : next.saved }));
    } catch (error) {
      if (!alive.current || current !== revision.current || controller.signal.aborted) return;
      if (error instanceof CampusExtensionUnavailable) setAvailable(false);
      setState(previous => ({ ...previous, phase: "error", message: error instanceof Error ? error.message : "Campus connection failed." }));
    } finally { requests.current.delete(controller); }
  }, []);

  useEffect(() => {
    alive.current = true;
    const refresh = () => { void request("status"); };
    const stop = onCampusExtensionChange(refresh);
    void request("status");
    // This only reads the extension's saved data. It never refreshes the IC session.
    window.addEventListener("focus", refresh);
    return () => {
      alive.current = false;
      revision.current += 1;
      for (const controller of requests.current) controller.abort();
      requests.current.clear();
      stop();
      window.removeEventListener("focus", refresh);
    };
  }, [request]);

  return {
    ...state, available, busy: state.phase === "waiting" || state.phase === "reading",
    connect: () => request("connect"), cancel: () => request("cancel"), forget: () => request("forget"),
    refresh: () => request("status"),
  };
}
