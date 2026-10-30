import type { EvacuationInfo } from "../rooms/types.js";

export const referenceCaution = "Older supplied reference; not a verified current school evacuation plan. Follow current school staff directions during an emergency.";

export function referenceSummary(evacuation: EvacuationInfo | null) {
  if (!evacuation) return "Room reference details unavailable";
  if (evacuation.status !== "mapped") return "No matching reference group";
  return `Reference ${evacuation.group} group · ${evacuation.reference_label} · ${evacuation.short_destination ?? evacuation.destination}`;
}
