import { CAMPUS_CACHE_KEY, isRecord, MAX_CAMPUS_BYTES, parseSavedCampusImport,
  type SavedCampusImport } from "../../../../src/domain/campus-contract.js";

interface LocalCampusState { saved: SavedCampusImport | null; forgotten_at: number; }

export function readLocalCampus(storage?: Pick<Storage, "getItem">): LocalCampusState {
  try {
    const raw = (storage ?? localStorage).getItem(CAMPUS_CACHE_KEY);
    if (!raw || raw.length > MAX_CAMPUS_BYTES + 1024) return { saved: null, forgotten_at: 0 };
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return { saved: null, forgotten_at: 0 };
    return {
      saved: value.saved == null ? null : parseSavedCampusImport(value.saved),
      forgotten_at: typeof value.forgotten_at === "number" && Number.isFinite(value.forgotten_at) ? value.forgotten_at : 0,
    };
  } catch { return { saved: null, forgotten_at: 0 }; }
}

export function newestCampusImport(local: LocalCampusState, remote: SavedCampusImport | null): SavedCampusImport | null {
  return [local.saved, remote].filter((saved): saved is SavedCampusImport => saved !== null
    && Date.parse(saved.imported_at) > local.forgotten_at)
    .sort((a, b) => Date.parse(b.imported_at) - Date.parse(a.imported_at))[0] ?? null;
}

export function saveLocalCampus(saved: SavedCampusImport, storage: Storage = localStorage): void {
  const local = readLocalCampus(storage);
  storage.setItem(CAMPUS_CACHE_KEY, JSON.stringify({ version: 1, saved: parseSavedCampusImport(saved), forgotten_at: local.forgotten_at }));
}

/** A single atomic write prevents an unavailable old extension from restoring forgotten data. */
export function forgetLocalCampus(storage: Storage = localStorage, now = Date.now()): void {
  storage.setItem(CAMPUS_CACHE_KEY, JSON.stringify({ version: 1, saved: null, forgotten_at: now }));
}
