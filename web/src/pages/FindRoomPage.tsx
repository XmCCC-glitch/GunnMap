import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { RoomInput } from "../features/rooms/RoomInput.js";
import { usePanzoom } from "../features/maps/usePanzoom.js";
import { buildingName, roomLocationLabel } from "../features/rooms/room-display.js";
import { buildingCenter, findBuilding, type BuildingRegions } from "../features/rooms/building-search.js";
import { loadRoomDirectory, lookupRoom } from "../features/rooms/room-api.js";
import { evacuationDestination } from "../features/evacuation/formatters.js";
import type {
  LocatedRoom,
  RoomData,
} from "../features/rooms/types.js";
import { useToast } from "../shared/toast.js";
import type { CSSVariables } from "../shared/css-types.js";
import { siteUrl } from "../features/pages/site-data.js";

function polygonClip(polygon: [number, number][], [width, height]: [number, number]) {
  return `polygon(${polygon.map(([x, y]) => `${x / width * 100}% ${y / height * 100}%`).join(", ")})`;
}

export function FindRoomPage() {
  const showToast = useToast();
  const [input, setInput] = useState("");
  const [rooms, setRooms] = useState<RoomData["rooms"]>([]);
  const [buildingRegions, setBuildingRegions] = useState<BuildingRegions>({});
  const [mapRevision, setMapRevision] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<LocatedRoom | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [choices, setChoices] = useState<LocatedRoom[]>([]);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [mapSize, setMapSize] = useState<[number, number]>([2448, 1584]);
  const stage = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const lookupController = useRef<AbortController | null>(null);
  const buildingPolygons = selectedBuilding
    ? [...(buildingRegions[selectedBuilding]?.polygons ?? []),
      ...(selectedBuilding === "D" ? buildingRegions.LIBRARY?.polygons ?? [] : [])]
    : [];
  const marker = selectedRoom?.marker ?? (buildingPolygons.length ? buildingCenter(buildingPolygons) : null);
  const focus = marker ? { x: marker[0] / mapSize[0], y: marker[1] / mapSize[1], scale: 2 } : undefined;
  const controls = usePanzoom(stage, art, image, { active: true, focus, animateFocus: true });

  useEffect(() => {
    const controller = new AbortController();
    void loadRoomDirectory(controller.signal)
      .then(data => {
        if (!controller.signal.aborted) {
          setRooms(data.rooms);
          setBuildingRegions(data.building_regions);
          setMapSize(data.map_size);
          setMapRevision(data.map_revision);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          showToast("The room list could not be loaded. Try reloading the page.");
        }
      });

    return () => {
      controller.abort();
      lookupController.current?.abort();
    };
  }, [showToast]);

  const chooseRoom = (room: LocatedRoom) => {
    setInput(roomLocationLabel(room));
    setSelectedRoom(room);
    setSelectedBuilding(null);
    setChoices([]);
    setMessage("");
    requestAnimationFrame(() => {
      stage.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const chooseBuilding = (code: string) => {
    setInput(buildingName(code));
    setSelectedBuilding(code);
    setSelectedRoom(null);
    setChoices([]);
    setMessage("");
    requestAnimationFrame(() => stage.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const lookup = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    event?.currentTarget.querySelector<HTMLInputElement>("#find-room-input")?.blur();
    const query = input.trim();
    lookupController.current?.abort();
    setSelectedRoom(null);
    setSelectedBuilding(null);
    setChoices([]);
    setMessage("");
    if (!query) {
      setSearching(false);
      showToast("Enter a room, alias, or building to search.");
      return;
    }
    if (!mapRevision) {
      setSearching(false);
      showToast("The current room directory is not ready. Reload the page and try again.");
      return;
    }
    const building = findBuilding(buildingRegions, query);
    if (building) {
      setSearching(false);
      chooseBuilding(building);
      return;
    }
    setSearching(true);
    setMessage("Searching…");
    const controller = new AbortController();
    lookupController.current = controller;
    try {
      const result = await lookupRoom(query, controller.signal);
      if (controller.signal.aborted) return;
      if (result.map_revision !== mapRevision) throw new Error("The campus map has changed. Reload and accept the available update before searching again.");
      setMapSize(result.map_size);
      if (!result.rooms.length) {
        setMessage("");
        showToast("No matching room or building. Check the name or choose a listed suggestion.");
      } else if (result.rooms.length > 1) {
        setMessage("More than one room matches. Choose the right location.");
        setChoices(result.rooms);
      } else chooseRoom(result.rooms[0]);
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage("");
        showToast(error instanceof Error ? error.message : "Room search failed.");
      }
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  };

  const evacuation = selectedRoom?.evacuation;
  const destination = selectedRoom
    ? `${selectedRoom.label} → ${evacuationDestination(selectedRoom.evacuation)}`
    : "";

  const handleInputChange = (value: string) => {
    lookupController.current?.abort();
    setInput(value);
    setSelectedRoom(null);
    setSelectedBuilding(null);
    setChoices([]);
    setMessage("");
    setSearching(false);
  };

  const highlightPolygons = selectedRoom ? [selectedRoom.polygon] : buildingPolygons;
  const suggestions = useMemo(() => [
    ...rooms,
    ...Object.keys(buildingRegions).filter(code => code !== "LIBRARY").map(code => ({
      id: `building-${code}`, label: buildingName(code), building: code,
      aliases: buildingRegions[code].aliases, kind: "building" as const,
    })),
  ], [rooms, buildingRegions]);
  const roomRouteStyle = {
    "--room-route-color": evacuation?.color ?? "#f38470",
  } as CSSVariables;

  return (
    <main id="main-content" className="find-room-layout" tabIndex={-1}>
      <section className="panel find-room-search" aria-labelledby="find-room-title">
        <div className="eyebrow">ROOM LOOKUP</div>
        <h1 id="find-room-title">Find a room</h1>
        <p className="map-help">Search a room number, a familiar name such as “library,” or a whole building such as “N bldg.”</p>
        <form className="find-room-form" onSubmit={lookup}>
          <label className="field" htmlFor="find-room-input">
            <span>Room or building</span>
            <RoomInput
              id="find-room-input"
              label="Room or building"
              value={input}
              rooms={suggestions}
              placeholder="e.g. A134, library, or N bldg"
              onValueChange={handleInputChange}
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={searching}
          >
            {searching ? "Searching…" : "Find location"}
          </button>
        </form>
        <p
          className="room-lookup-message"
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
        {choices.length > 0 && (
          <div className="room-lookup-choices">
            {choices.map(room => (
              <button
                className="room-lookup-choice"
                type="button"
                key={room.id}
                onClick={() => chooseRoom(room)}
              >
                <span>{roomLocationLabel(room)}</span>
                <small>
                  {buildingName(room.building)}
                  {room.floor === 2 ? " · 2nd floor" : ""}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>

      {(selectedRoom || selectedBuilding) && (
        <div className="find-room-result">
          <section
            className="panel find-room-details"
            aria-labelledby="room-result-title"
          >
            <div className="room-lookup-heading">
              <div>
                <span className="eyebrow">
                  {buildingName(selectedRoom?.building ?? selectedBuilding!)}
                </span>
                <h2 id="room-result-title">{selectedRoom?.label ?? "Whole building"}</h2>
              </div>
              {selectedRoom && <span className="room-lookup-floor">
                {selectedRoom.floor === 2 ? "2nd floor" : "1st floor"}
              </span>}
            </div>
            {selectedRoom && evacuation && <>
              <p className="room-lookup-destination">{destination}</p>
              <p className="map-help">{evacuation.note}</p>
              <p className="find-room-disclaimer">
              Reference only. Follow current school staff directions during an emergency.
              </p>
            </>}
          </section>
        </div>
      )}
          <section
            className="panel find-room-map"
            aria-labelledby="room-map-title"
          >
            <div className="panel-heading">
              <h2 id="room-map-title">Campus map</h2>
              <a
                className="download-link"
                href="/map.png"
                download="gunn-campus-map.png"
                onClick={event => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  void import("../features/maps/download-public-map.js")
                    .then(({ downloadPublicMap }) => downloadPublicMap("/map.webp", "gunn-campus-map.png"))
                    .catch(error => showToast(error instanceof Error ? error.message : "The PNG could not be downloaded."));
                }}
              >
                Download PNG
              </a>
            </div>
            <div className="map-controls" role="group" aria-label="Map zoom">
              <button type="button" className="download-link" onClick={controls.zoomOut} aria-label="Zoom out">−</button>
              <button type="button" className="download-link" onClick={controls.zoomIn} aria-label="Zoom in">+</button>
              <button type="button" className="download-link" onClick={controls.reset}>Reset view</button>
            </div>
            <p id="room-map-help" className="map-help">
              Drag to move · Scroll or pinch to zoom · Focus the map to use +/−, arrow keys or Home.
            </p>
            <div
              ref={stage}
              className="room-locator-stage"
              role="region"
              aria-label="Zoomable campus map"
              aria-describedby="room-map-help"
              tabIndex={0}
            >
              <div ref={art} className="room-locator-art">
                <img
                  ref={image}
                  src={siteUrl("/map.webp")}
                  alt="Gunn campus map"
                />
                {highlightPolygons.map((polygon, index) => <span
                  key={index}
                  className="room-locator-highlight"
                  style={{ clipPath: polygonClip(polygon, mapSize), ...roomRouteStyle }}
                  aria-hidden="true"
                />)}
                {marker && <span
                  className="room-locator-label"
                  style={{
                    left: `${marker[0] / mapSize[0] * 100}%`,
                    top: `${marker[1] / mapSize[1] * 100}%`,
                    ...roomRouteStyle,
                  }}
                  aria-hidden="true"
                >
                  {selectedRoom?.label ?? buildingName(selectedBuilding!)}
                </span>}
              </div>
            </div>
          </section>
    </main>
  );
}
