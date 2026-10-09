import { resolve } from 'node:path';
import type { LocatedRoom } from './domain/room-contracts.js';
import { GeneratedMapStore, DEFAULT_MAP_STORAGE_BYTES, DEFAULT_MAP_MAX_BYTES } from './generated_map_store.js';
import { renderRooms } from './map_highlighter.js';
import { MAP_REVISION, MAP_REVISION_DATE } from './map_revision.js';
import { configuredRetentionMs } from './output_retention.js';
import { ROOT, roomData, resolveRoom } from './project.js';
import { toLocatedRoom } from './room_response.js';
import { addScheduleLegend } from './schedule_legend.js';
import { HttpError } from './server_policy.js';

interface RenderOptions {
  store?: GeneratedMapStore;
  signal?: AbortSignal;
  requireIdentity?: boolean;
}

interface SelectedPeriod extends Omit<LocatedRoom, 'aliases'> {
  period: number;
  color: string;
}

function selectedPeriods(periods: unknown, requireIdentity: boolean): SelectedPeriod[] {
  if (!Array.isArray(periods) || periods.length !== 7) {
    throw new HttpError(400, 'Please submit all seven period slots');
  }

  const selected: SelectedPeriod[] = [];
  for (const [slot, value] of periods.entries()) {
    const index = slot + 1;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, `Period ${index} has invalid data`);
    }

    const period = value as Record<string, unknown>;
    if (typeof period.building !== 'string' || typeof period.room !== 'string' || typeof period.color !== 'string') {
      throw new HttpError(400, `Period ${index}: building, room and color must be strings`);
    }
    const building = period.building.trim().toUpperCase();
    const roomName = period.room.trim();
    const color = period.color.trim();
    if (!roomName) continue;

    const identityError = () => new HttpError(409, `Period ${index}: The campus map or room identity changed. Reload the page and review your classroom choices before generating a map.`);
    // Reject an older cached browser's identity before resolving labels, since a
    // label may now refer to a different room. CLI metadata remains optional.
    if ((period.mapRevision !== undefined && period.mapRevision !== MAP_REVISION)
      || (requireIdentity && (period.mapRevision !== MAP_REVISION || typeof period.roomId !== 'string' || !period.roomId))) {
      throw identityError();
    }
    if (!building) throw new HttpError(400, `Period ${index}: choose a building for ${roomName}`);
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new HttpError(400, `Period ${index}: invalid color`);

    let room;
    try {
      room = resolveRoom(building, roomName);
    } catch (error) {
      throw new HttpError(400, `Period ${index}: ${(error as Error).message}`);
    }
    if (period.roomId !== undefined && period.roomId !== room.id) throw identityError();
    const { aliases: _aliases, ...location } = toLocatedRoom(room);
    selected.push({ ...location, period: index, color });
  }
  return selected;
}

function duplicateRoomWarnings(selected: SelectedPeriod[]): string[] {
  const periodsByRoom = new Map<string, SelectedPeriod[]>();
  for (const period of selected) {
    const shared = periodsByRoom.get(period.id);
    if (shared) shared.push(period);
    else periodsByRoom.set(period.id, [period]);
  }
  return [...periodsByRoom.values()]
    .filter(shared => shared.length > 1)
    .map(shared => `Periods ${shared.map(item => item.period).join(', ')} share ${shared[0].label}; its map highlight is split into each period's color.`);
}

export async function renderPeriods(
  periods: unknown,
  outputDir = resolve(ROOT, 'output'),
  options: RenderOptions = {},
) {
  const selected = selectedPeriods(periods, options.requireIdentity === true);
  const colors: Record<string, string[]> = {};
  for (const period of selected) (colors[period.id] ??= []).push(period.color);
  const warnings = duplicateRoomWarnings(selected);
  const store = options.store ?? new GeneratedMapStore(outputDir, DEFAULT_MAP_STORAGE_BYTES, DEFAULT_MAP_MAX_BYTES, configuredRetentionMs());
  let reservation: Awaited<ReturnType<GeneratedMapStore['reserve']>> | undefined;
  let filename: string;
  let generatedAt: string;
  const checkCancellation = () => {
    if (options.signal?.aborted) throw new HttpError(503, 'Map request was cancelled');
  };

  try {
    reservation = await store.reserve();
    checkCancellation();
    const highlighted = await renderRooms(colors, { opacity: 0.55 });
    checkCancellation();
    const bytes = await addScheduleLegend(highlighted, selected);
    checkCancellation();
    generatedAt = new Date().toISOString();
    filename = await reservation.write(bytes, options.signal, { map_revision: MAP_REVISION, generated_at: generatedAt });
  } finally {
    reservation?.release();
    if (!options.store) store.close();
  }

  return {
    image_url: `/output/${filename}`,
    selected,
    warnings,
    map_size: roomData.image_size,
    map_revision: MAP_REVISION,
    map_revision_date: MAP_REVISION_DATE,
    generated_at: generatedAt,
  };
}
