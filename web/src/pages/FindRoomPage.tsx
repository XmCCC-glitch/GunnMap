import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { RoomInput } from "../features/rooms/RoomInput.js";
import { usePanzoom } from "../features/maps/usePanzoom.js";
import { buildingName, roomLocationLabel } from "../features/rooms/room-display.js";
import { buildingCenter, findBuilding, type BuildingRegions } from "../features/rooms/building-search.js";
import type {
  LocatedRoom,
  RoomData,
  RoomLookupResponse,
} from "../features/rooms/types.js";
import { useToast } from "../shared/toast.js";
import type { CSSVariables } from "../shared/css-types.js";

export function FindRoomPage() {
  const showToast = useToast();
  const [input, setInput] = useState("");
  const [rooms, setRooms] = useState<RoomData["rooms"]>([]);
  const [buildingRegions, setBuildingRegions] = useState<BuildingRegions>({});
  const [selectedRoom, setSelectedRoom] = useState<LocatedRoom | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [choices, setChoices] = useState<LocatedRoom[]>([]);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [mapSize, setMapSize] = useState<[number, number]>([2448, 1584]);
  const stage = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const requestRevision = useRef(0);
  const buildingPolygons = selectedBuilding
    ? [...(buildingRegions[selectedBuilding]?.polygons ?? []),
        ...(selectedBuilding === "D" ? buildingRegions.LIBRARY?.polygons ?? [] : [])]
    : [];
  const marker = selectedRoom?.marker ?? (buildingPolygons.length ? buildingCenter(buildingPolygons) : null);
  const focus = marker ? { x: marker[0] / mapSize[0], y: marker[1] / mapSize[1], scale: 2 } : undefined;
  const controls = usePanzoom(stage, art, image, { active: true, focus, animateFocus: true });

  useEffect(() => {
    let current = true;
    void fetch("/api/rooms", { credentials: "omit" })
      .then(async response => {
        if (!response.ok) throw new Error();
        return await response.json() as RoomData;
      })
      .then(data => {
        if (current) {
          setRooms(data.rooms);
          setBuildingRegions(data.building_regions);
          setMapSize(data.map_size);
        }
      })
      .catch(() => {
        if (current) {
          showToast("The room list could not be loaded. Try reloading the page.");
        }
      });

    return () => {
      current = false;
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
    requestAnimationFrame(() => {
      stage.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const lookup = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    event?.currentTarget.querySelector<HTMLInputElement>("#find-room-input")?.blur();
    const query = input.trim();
    requestRevision.current += 1;
    const currentRevision = requestRevision.current;
    setSelectedRoom(null);
    setSelectedBuilding(null);
    setChoices([]);
    setMessage("");
    if (!query) {
      setSearching(false);
      showToast("Enter a room, alias, or building to search.");
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
    try {
      const response = await fetch(`/api/room-lookup?q=${encodeURIComponent(query)}`, { credentials: "omit" });
      const result = await response.json() as RoomLookupResponse;
      if (currentRevision !== requestRevision.current) return;
      if (!response.ok) throw new Error(result.error ?? "Room search failed.");
      setMapSize(result.map_size);
      if (!result.rooms.length) {
        setMessage("");
        showToast("No matching room or building. Check the name or choose a listed suggestion.");
      } else if (result.rooms.length > 1) {
        setMessage("More than one room matches. Choose the right location.");
        setChoices(result.rooms);
      } else chooseRoom(result.rooms[0]);
    } catch (error) {
      if (currentRevision === requestRevision.current) {
        setMessage("");
        showToast(error instanceof Error ? error.message : "Room search failed.");
      }
    } finally {
      if (currentRevision === requestRevision.current) setSearching(false);
    }
  };

  const evacuation = selectedRoom?.evacuation;
  const reference = evacuation?.reference_label
    && !/^[A-Z]$/i.test(evacuation.reference_label)
    ? `${evacuation.reference_label} · `
    : "";
  const destinationName = evacuation?.short_destination
    ?? evacuation?.destination
    ?? "";
  const destination = selectedRoom && evacuation
    ? evacuation.status === "mapped"
      ? `${selectedRoom.label} → ${reference}${destinationName} (${evacuation.group})`
      : `${selectedRoom.label} → ${evacuation.destination}`
    : "";

  const handleInputChange = (value: string) => {
    requestRevision.current += 1;
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
          className={`room-lookup-message${
            message && !message.includes("Searching") ? " is-error" : ""
          }`}
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
              src="/map.webp"
              alt="Gunn campus map"
            />
            {highlightPolygons.map((polygon, index) => <span
              key={`${selectedRoom?.id ?? selectedBuilding}-${index}`}
              className="room-locator-highlight"
              style={{ clipPath: `polygon(${polygon.map(([x, y]) => `${x / mapSize[0] * 100}% ${y / mapSize[1] * 100}%`).join(", ")})`, ...roomRouteStyle }}
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
