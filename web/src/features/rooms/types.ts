export interface RoomOption {
  id: string;
  label: string;
  building: string;
  floor: number;
  aliases: string[];
}

export interface RoomData {
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

export interface RoomLookupResponse {
  rooms: LocatedRoom[];
  map_size: [number, number];
  error?: string;
}
