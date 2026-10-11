import type { LocatedRoom, RoomOption } from './domain/room-contracts.js';
import { evacuationForRoom } from './evacuation.js';
import type { Room } from './project.js';

export function toRoomOption(room: Room): RoomOption {
  return {
    id: room.id,
    label: room.label,
    building: room.building,
    floor: room.floor ?? 1,
    aliases: room.aliases ?? [],
  };
}

export function toLocatedRoom(room: Room): LocatedRoom {
  const [left, top, right, bottom] = room.label_box;
  return {
    ...toRoomOption(room),
    polygon: room.polygon,
    marker: [(left + right) / 2, (top + bottom) / 2],
    evacuation: evacuationForRoom(room),
  };
}
