import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { findRoomMatches } from "../../../../src/domain/room-matching.js";
import type { RoomOption } from "../rooms/types.js";
import { GENERATED_MAP_SESSION_KEY, flushPendingDraft } from "./schedule-storage.js";
import { periodRoomState } from "./room-validation.js";
import { runRenderRequest } from "./render-request.js";
import type { Period } from "./types.js";

interface ActiveRender {
  revision: number;
  controller: AbortController;
  promise: Promise<boolean>;
}

function removeGeneratedMap() {
  try {
    sessionStorage.removeItem(GENERATED_MAP_SESSION_KEY);
  } catch {
    // Storage can be disabled; invalidation and request cancellation still apply.
  }
}

async function decodeRenderedImage(imageUrl: string, signal: AbortSignal) {
  const image = new Image();
  const cancel = () => { image.src = ""; };
  signal.addEventListener("abort", cancel, { once: true });
  image.src = imageUrl;
  try {
    await image.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  signal.throwIfAborted();
}

export function useScheduleRender(showToast: (message: string) => void) {
  const navigate = useNavigate();
  const [rendering, setRendering] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const revision = useRef(0);
  const activeRender = useRef<ActiveRender | null>(null);

  const invalidate = useCallback(() => {
    revision.current += 1;
    const previous = activeRender.current;
    activeRender.current = null;
    previous?.controller.abort();
    setRendering(false);
    setValidationMessage("");
    removeGeneratedMap();
  }, []);

  useEffect(() => () => {
    revision.current += 1;
    activeRender.current?.controller.abort();
    activeRender.current = null;
  }, []);

  async function generate(periods: Period[], rooms: RoomOption[], requiresReview: boolean, form: HTMLFormElement | null) {
    flushPendingDraft();
    if (requiresReview) {
      setValidationMessage("Confirm the restored room choices against the current map before generating.");
      document.getElementById("schedule-map-review")?.focus();
      return false;
    }
    if (activeRender.current?.revision === revision.current) return activeRender.current.promise;
    invalidate();
    const invalid = periods
      .map((period, index) => ({ index, ...periodRoomState(period, rooms) }))
      .filter(item => item.invalid);
    if (invalid.length) {
      const numbers = invalid.map(item => item.index + 1).join(", ");
      setValidationMessage(`Check period${invalid.length === 1 ? "" : "s"} ${numbers}. Choose a recognized room before generating.`);
      const input = form?.querySelector<HTMLInputElement>(`#period-${invalid[0].index + 1}-room`);
      input?.focus();
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }

    setRendering(true);
    const requestRevision = revision.current;
    const controller = new AbortController();
    const request: ActiveRender = {
      revision: requestRevision,
      controller,
      promise: runRenderRequest(controller, async signal => {
        const response = await fetch("/api/render", {
          method: "POST",
          credentials: "omit",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ periods: periods.map(period => ({
            ...period,
            room: period.room.trim(),
            building: period.room.trim()
              ? findRoomMatches(rooms, period.room, period.building)[0].building
              : "",
          })) }),
        });
        if (!response.ok) {
          const result = await response.json() as { error: string };
          throw new Error(result.error);
        }
        const { image_url: imageUrl } = await response.json() as { image_url: string };
        signal.throwIfAborted();
        if (requestRevision !== revision.current) return false;
        await decodeRenderedImage(imageUrl, signal);
        if (requestRevision !== revision.current) return false;
        try {
          sessionStorage.setItem(GENERATED_MAP_SESSION_KEY, imageUrl);
        } catch {
          // The route carries the exact image URL when storage is disabled.
        }
        navigate(`/generate-map?image=${encodeURIComponent(imageUrl)}`);
        return true;
      }).catch(error => {
        const timedOut = controller.signal.reason instanceof Error && controller.signal.reason.name === "TimeoutError";
        if (requestRevision === revision.current && (!controller.signal.aborted || timedOut)) {
          showToast(error instanceof Error ? error.message : String(error));
        }
        return false;
      }).finally(() => {
        if (activeRender.current === request) {
          activeRender.current = null;
          setRendering(false);
        }
      }),
    };
    activeRender.current = request;
    return request.promise;
  }

  return { rendering, validationMessage, invalidate, generate };
}
