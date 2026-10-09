import type { EvacuationInfo } from "../rooms/types.js";

function referenceDestination(info: EvacuationInfo): string {
  const reference = info.reference_label && !/^[A-Z]$/i.test(info.reference_label)
    ? `${info.reference_label} · `
    : "";
  return `${reference}${info.short_destination ?? info.destination}`;
}

export function evacuationDestination(info: EvacuationInfo): string {
  return info.status === "mapped"
    ? `${referenceDestination(info)} (${info.group})`
    : info.destination;
}

export function assemblySummary(info: EvacuationInfo): string {
  return info.status === "mapped"
    ? `${info.group} group · ${referenceDestination(info)}`
    : "Assembly area not confirmed";
}
