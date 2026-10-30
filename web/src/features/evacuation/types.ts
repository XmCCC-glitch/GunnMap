import type { EvacuationInfo } from "../rooms/types.js";

export interface EvacuationGroupInfo {
  title: string;
  color: string;
  destination: string;
  short_destination: string;
  labels: string[];
  description?: string;
}

export interface EvacuationOverview {
  provenance: {
    sourceKind: "supplied_reference" | "official_site_map";
    originalFilename: string;
    sourceFile: string;
    sourceImageSha256: string;
    sourceRevisionDate: string | null;
    verifiedOn: string | null;
    imageSize: [number, number];
  };
  routesAvailable: boolean;
  groups: Record<string, EvacuationGroupInfo>;
  inventoryExceptions: Record<string, string>;
  validationIssues: string[];
}

export interface ScheduleEvacuationEntry {
  period: number;
  id: string;
  room: string;
  building: string;
  floor: number | null;
  color: string;
  marker: [number, number] | null;
  evacuation: EvacuationInfo | null;
}

export type EntryWithMarker = ScheduleEvacuationEntry & {
  marker: [number, number];
};

export type EvacuationMapMode = "reference" | "campus";
