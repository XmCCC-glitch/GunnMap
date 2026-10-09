import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { GENERATED_MAP_SESSION_KEY } from "../features/schedule/schedule-storage.js";
import { usePanzoom } from "../features/maps/usePanzoom.js";
import { generatedMapMetadata, removeOfflineMap, savedOfflineMapInfo, saveMapOffline, type GeneratedMapMetadata, type SavedOfflineMap } from "../features/offline/offline-client.js";
import { GENERATED_IMAGE } from "../../offline/policy.js";
import { loadRoomDirectory } from "../features/rooms/room-api.js";
import { useToast } from "../shared/toast.js";

function savedImagePath() {
  try {
    const saved = window.sessionStorage.getItem(GENERATED_MAP_SESSION_KEY) ?? "";
    return GENERATED_IMAGE.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

export function GeneratedMapPage() {
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const queryImage = searchParams.get("image") ?? "";
  const [failed, setFailed] = useState(false);
  const [offlinePath, setOfflinePath] = useState("");
  const [offlineInfo, setOfflineInfo] = useState<SavedOfflineMap | null>(null);
  const [metadata, setMetadata] = useState<GeneratedMapMetadata | null>(null);
  const [currentRevision, setCurrentRevision] = useState("");
  const [offlineMessage, setOfflineMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const validQueryImage = GENERATED_IMAGE.test(queryImage);
  const imagePath = savedImagePath();
  const invalidQueryImage = Boolean(queryImage && !validQueryImage);
  const source = invalidQueryImage ? "" : queryImage || imagePath || offlinePath;

  useEffect(() => {
    let current = true;
    void savedOfflineMapInfo()
      .then(info => {
        if (current) {
          setOfflineInfo(info);
          setOfflinePath(info?.path ?? "");
        }
      })
      .catch(() => {
        if (current) showToast("The saved offline map could not be checked.");
      });
    const controller = new AbortController();
    void loadRoomDirectory(controller.signal)
      .then(data => {
        if (current) setCurrentRevision(data.map_revision);
      })
      .catch(() => {
        if (current) showToast("The room directory could not be loaded. The map version cannot be checked.");
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [showToast]);

  useEffect(() => {
    setFailed(false);
  }, [source]);

  useEffect(() => {
    setMetadata(null);
    if (!source) return;
    if (offlineInfo?.path === source) {
      setMetadata(offlineInfo);
      return;
    }
    const controller = new AbortController();
    void fetch(source, { method: "HEAD", credentials: "omit", signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("Map metadata is unavailable.");
        if (!controller.signal.aborted) setMetadata(generatedMapMetadata(response.headers));
      })
      .catch(() => {
        if (!controller.signal.aborted) showToast("This map's version information could not be loaded.");
      });
    return () => controller.abort();
  }, [source, offlineInfo, showToast]);

  const controls = usePanzoom(stage, art, image, {
    active: Boolean(source) && !failed,
    fit: true,
    sourceKey: source,
  });

  async function changeOfflineCopy() {
    setSaving(true);
    setOfflineMessage("");
    try {
      if (source === offlinePath) {
        await removeOfflineMap();
        setOfflinePath("");
        setOfflineInfo(null);
        setOfflineMessage("Offline copy removed from this browser.");
      } else {
        await saveMapOffline(source);
        const saved = await savedOfflineMapInfo();
        setOfflineInfo(saved);
        setOfflinePath(saved?.path ?? "");
        setOfflineMessage(saved?.path === source
          ? "Saved on this device for offline viewing. This replaces any earlier offline map."
          : "Another tab changed the saved offline map. The saved copy shown here has been refreshed.");
      }
    } catch (error) {
      setOfflineMessage(error instanceof Error ? error.message : "Offline saving failed. Try downloading the PNG.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main id="main-content" className="generated-map-layout" tabIndex={-1}>
      <section className="panel generated-map-panel" aria-labelledby="generated-map-title">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">MAP PREVIEW</div>
            <h1 id="generated-map-title">Your campus map</h1>
          </div>
          {source && !failed && (
            <div className="generated-map-actions">
              <a
                className="download-link"
                href={source}
                download="gunn-period-map.png"
              >
                Download PNG
              </a>
              <Link className="download-link" to="/">
                Edit schedule
              </Link>
              <button type="button" className="download-link" disabled={saving} onClick={() => void changeOfflineCopy()}>
                {saving ? "Saving…" : source === offlinePath ? "Remove offline copy" : "Save offline"}
              </button>
            </div>
          )}
        </div>
        <p className="offline-map-message" role="status">{offlineMessage || (source && source === offlinePath ? "This map is saved offline on this device." : "")}</p>
        {source && !failed && <div className="map-version-status" role="status">
          <p>{metadata?.mapRevision && currentRevision
            ? metadata.mapRevision === currentRevision ? "This map uses the current campus map and room directory." : "This map uses an older campus map or room directory. Review your rooms before using it."
            : "This map's version could not be confirmed. Review your rooms and regenerate to use the current campus map."}</p>
          {metadata?.generatedAt && <p>Generated <time dateTime={metadata.generatedAt}>{new Date(metadata.generatedAt).toLocaleString()}</time></p>}
          {offlineInfo?.path === source && offlineInfo.savedAt && <p>Saved offline <time dateTime={offlineInfo.savedAt}>{new Date(offlineInfo.savedAt).toLocaleString()}</time></p>}
          {(!metadata?.mapRevision || !currentRevision || metadata.mapRevision !== currentRevision) && <Link className="download-link" to="/">Review schedule and regenerate</Link>}
        </div>}
        {source && !failed ? <>
          <div className="map-controls" role="group" aria-label="Map zoom">
            <button type="button" className="download-link" onClick={controls.zoomOut} aria-label="Zoom out">−</button>
            <button type="button" className="download-link" onClick={controls.zoomIn} aria-label="Zoom in">+</button>
            <button type="button" className="download-link" onClick={controls.reset}>Fit map</button>
          </div>
          <p id="generated-map-help" className="map-help">Drag to move · Scroll or pinch to zoom · Focus the map to use +/−, arrow keys or Home.</p>
          <div className="generated-map-content">
            <div
              ref={stage}
              className="generated-map-stage"
              role="region"
              aria-label="Zoomable schedule map"
              aria-describedby="generated-map-help"
              tabIndex={0}
            >
              <div ref={art} className="generated-map-art">
                <img
                  ref={image}
                  src={source}
                  alt="Gunn campus map with your schedule rooms highlighted"
                  onError={() => setFailed(true)}
                />
              </div>
            </div>
          </div>
        </> : (
          <div className="generated-map-empty">
            <p>{invalidQueryImage
              ? "This map link is invalid. Open a generated map from your schedule."
              : failed
                ? "This image is unavailable or has expired. Generate a new map from your schedule."
                : "Generate a map from your schedule to view it here."}</p>
            {failed && offlinePath && offlinePath !== source && <Link className="download-link" to={`/generate-map?image=${encodeURIComponent(offlinePath)}`}>View previously saved offline map</Link>}
            <Link className="primary-button" to="/">
              Go to Schedule Map
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
