import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { RoomInput } from "../features/rooms/RoomInput.js";
import { usePanzoom } from "../features/maps/usePanzoom.js";
import { buildingName, roomLocationLabel } from "../features/rooms/room-display.js";
import type {
  LocatedRoom,
  RoomData,
} from "../features/rooms/types.js";
import { useToast } from "../shared/toast.js";
import { loadRooms, lookupRoom, siteUrl } from "../features/pages/site-data.js";
import type { CSSVariables } from "../shared/css-types.js";

export function FindRoomPage() {
  const showToast = useToast();
  const [input, setInput] = useState("");
  const [rooms, setRooms] = useState<RoomData["rooms"]>([]);
  const [selectedRoom, setSelectedRoom] = useState<LocatedRoom | null>(null);
  const [choices, setChoices] = useState<LocatedRoom[]>([]);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [mapSize, setMapSize] = useState<[number, number]>([2448, 1584]);
  const stage = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const requestRevision = useRef(0);
  const focus = selectedRoom
    ? {
        x: selectedRoom.marker[0] / mapSize[0],
        y: selectedRoom.marker[1] / mapSize[1],
        scale: 2,
      }
    : undefined;
  const controls = usePanzoom(stage, art, image, { active: Boolean(selectedRoom), focus, animateFocus: true });

  useEffect(() => {
    let current = true;
    void loadRooms()
      .then(data => {
        if (current) setRooms(data.rooms);
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
    setChoices([]);
    setMessage("");
    if (!query) {
      setSearching(false);
      showToast("Enter a room number or alias to search.");
      return;
    }
    setSearching(true);
    setMessage("Searching…");
    try {
      const result = await lookupRoom(query);
      if (currentRevision !== requestRevision.current) return;
      setMapSize(result.map_size);
      if (!result.rooms.length) {
        setMessage("");
        showToast("No matching room. Check the number or choose a listed suggestion.");
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
    setChoices([]);
    setMessage("");
    setSearching(false);
  };

  const polygonPoints = selectedRoom
    ? selectedRoom.polygon
        .map(([x, y]) => `${x / mapSize[0] * 100}% ${y / mapSize[1] * 100}%`)
        .join(", ")
    : "";
  const roomRouteStyle = {
    "--room-route-color": evacuation?.color ?? "#f38470",
  } as CSSVariables;

  return (
    <main id="main-content" className="find-room-layout" tabIndex={-1}>
      <section className="panel find-room-search" aria-labelledby="find-room-title">
        <div className="eyebrow">ROOM LOOKUP</div>
        <h1 id="find-room-title">Find a room</h1>
        <p className="map-help">Search a room number or a familiar name, such as “library.”</p>
        <form className="find-room-form" onSubmit={lookup}>
          <label className="field" htmlFor="find-room-input">
            <span>Room or room alias</span>
            <RoomInput
              id="find-room-input"
              label="Room or room alias"
              value={input}
              rooms={rooms}
              placeholder="e.g. A134 or library"
              onValueChange={handleInputChange}
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={searching}
          >
            {searching ? "Searching…" : "Find room"}
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

      {selectedRoom && evacuation && (
        <div className="find-room-result">
          <section
            className="panel find-room-details"
            aria-labelledby="room-result-title"
          >
            <div className="room-lookup-heading">
              <div>
                <span className="eyebrow">
                  {buildingName(selectedRoom.building)}
                </span>
                <h2 id="room-result-title">{selectedRoom.label}</h2>
              </div>
              <span className="room-lookup-floor">
                {selectedRoom.floor === 2 ? "2nd floor" : "1st floor"}
              </span>
            </div>
            <p className="room-lookup-destination">{destination}</p>
            <p className="map-help">{evacuation.note}</p>
            <p className="find-room-disclaimer">
              Reference only. Follow current school staff directions during an emergency.
            </p>
          </section>
          <section
            className="panel find-room-map"
            aria-labelledby="room-map-title"
          >
            <div className="panel-heading">
              <h2 id="room-map-title">Campus map</h2>
              <a
                className="download-link"
                href={siteUrl("/map.png")}
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
                  alt={`Gunn campus map with ${selectedRoom.label} highlighted`}
                />
                <span
                  className="room-locator-highlight"
                  style={{
                    clipPath: `polygon(${polygonPoints})`,
                    ...roomRouteStyle,
                  }}
                  aria-hidden="true"
                />
                <span
                  className="room-locator-label"
                  style={{
                    left: `${selectedRoom.marker[0] / mapSize[0] * 100}%`,
                    top: `${selectedRoom.marker[1] / mapSize[1] * 100}%`,
                    ...roomRouteStyle,
                  }}
                  aria-hidden="true"
                >
                  {selectedRoom.label}
                </span>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
