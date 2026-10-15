import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { GENERATED_MAP_SESSION_KEY } from "../features/schedule/schedule-storage.js";
import { usePanzoom } from "../features/maps/usePanzoom.js";
import { removeOfflineMap, savedOfflineMap, saveMapOffline } from "../features/offline/offline-client.js";
import { isPages } from "../features/pages/site-data.js";

const imagePattern = /^\/output\/period_map_[0-9a-f]{32}\.png$/i;

function savedImagePath() {
  try {
    const saved = window.sessionStorage.getItem(GENERATED_MAP_SESSION_KEY) ?? "";
    return imagePattern.test(saved) || (isPages && saved.length < 8_000_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(saved)) ? saved : "";
  } catch {
    return "";
  }
}

export function GeneratedMapPage() {
  const [searchParams] = useSearchParams();
  const queryImage = searchParams.get("image") ?? "";
  const [failed, setFailed] = useState(false);
  const [offlinePath, setOfflinePath] = useState("");
  const [offlineMessage, setOfflineMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const validQueryImage = imagePattern.test(queryImage);
  const imagePath = savedImagePath();
  const source = validQueryImage ? queryImage : imagePath || offlinePath;

  useEffect(() => {
    let current = true;
    if (!isPages) void savedOfflineMap().then(path => {if (current) setOfflinePath(path);}).catch(() => {});
    return () => {current = false;};
  }, []);

  useEffect(() => {
    setFailed(false);
  }, [source]);

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
        await removeOfflineMap(); setOfflinePath("");
        setOfflineMessage("Offline copy removed from this browser.");
      } else {
        await saveMapOffline(source); setOfflinePath(source);
        setOfflineMessage("Saved on this device for offline viewing. This replaces any earlier offline map.");
      }
    } catch (error) {
      setOfflineMessage(error instanceof Error ? error.message : "Offline saving failed. Try downloading the PNG.");
    } finally {setSaving(false);}
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
              {!isPages && <button type="button" className="download-link" disabled={saving} onClick={() => void changeOfflineCopy()}>
                {saving ? "Saving…" : source === offlinePath ? "Remove offline copy" : "Save offline"}
              </button>}
            </div>
          )}
        </div>
        <p className="offline-map-message" role="status">{offlineMessage || (source && source === offlinePath ? "This map is saved offline on this device." : "")}</p>
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
            <p>{failed ? "This image is unavailable or has expired. Generate a new map from your schedule." : "Generate a map from your schedule to view it here."}</p>
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
