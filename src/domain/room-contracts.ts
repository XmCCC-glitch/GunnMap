/** The room API contract shared by the server, browser and offline worker. */
export interface MapVersion {
  map_revision: string;
  map_revision_date: string;
}

export interface RoomOption {
  id: string;
  label: string;
  building: string;
  floor: number;
  aliases: string[];
}

export interface RoomData extends MapVersion {
  rooms: RoomOption[];
  buildings: string[];
}

export interface EvacuationInfo {
  status: "mapped" | "unconfirmed";
  group: string | null;
  color: string | null;
  destination: string;
  short_destination: string | null;
  reference_label: string | null;
  note: string;
}

export interface LocatedRoom extends RoomOption {
  polygon: [number, number][];
  marker: [number, number];
  evacuation: EvacuationInfo;
}

export interface RoomLookupResponse extends MapVersion {
  rooms: LocatedRoom[];
  map_size: [number, number];
}

export interface ApiError {
  error: string;
}
