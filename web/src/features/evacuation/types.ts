import type { EvacuationInfo } from "../rooms/types.js";
import type { EvacuationReview } from "../../../../src/domain/evacuation-review.js";

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
    sourceKind: "supplied_reference" | "official_site_map" | "official_evacuation_plan";
    originalFilename: string;
    sourceFile: string;
    sourceImageSha256: string;
    sourceRevisionDate: string | null;
    verifiedOn: string | null;
    imageSize: [number, number];
  };
  review: EvacuationReview;
  routesAvailable: boolean;
  groups: Record<string, EvacuationGroupInfo>;
  inventoryExceptions: Record<string, string>;
  validationIssues: string[];
}

interface ScheduleRoomPeriod {
  period: number;
  room: string;
  building: string;
  color: string;
}

export interface LocatedScheduleEntry extends ScheduleRoomPeriod {
  status: "located";
  id: string;
  floor: number;
  marker: [number, number];
  evacuation: EvacuationInfo;
}

export interface UnlocatedScheduleEntry extends ScheduleRoomPeriod {
  status: "review-required" | "not-found" | "lookup-failed";
  floor: null;
  marker: null;
  evacuation: null;
}

export type ScheduleEvacuationEntry = LocatedScheduleEntry | UnlocatedScheduleEntry;
