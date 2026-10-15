import { readJson, ROOT } from './project.js';
import { validateMapFiles } from './validate_map_data.js';
type Group = 'red' | 'blue' | 'green' | 'black';
type Pixels = [number, number, number, number];
type Assignment = [Group, string, Pixels];
interface GroupInfo {
  title: string;
  color: string;
  destination: string;
  shortDestination: string;
  labels: string[];
  appendReferenceLabel?: boolean;
  description?: string;
}
export interface EvacuationProvenance {
  sourceKind: 'supplied_reference' | 'official_site_map';
  originalFilename: string;
  sourceFile: string;
  sourceImageSha256: string;
  sourceRevisionDate: string | null;
  verifiedOn: string | null;
  imageSize: [number, number];
}
export interface EvacuationData {
  provenance: EvacuationProvenance;
  routesAvailable?: boolean;
  groups: Record<Group, GroupInfo>;
  inventoryExceptions: Record<string, string>;
  ranges: [string, number, number, Group, string, Pixels][];
  exact: Record<string, Assignment>;
  whole: Record<string, Assignment>;
}
export interface Evacuation {
  status: 'mapped' | 'unconfirmed'; group: Group | null; color: string | null;
  destination: string; short_destination: string | null; reference_label: string | null; note: string;
  focus: {x:number; y:number; width:number; height:number} | null;
}
const data = readJson<EvacuationData>('evacuation_data.json');

export function evacuationOverview() {
  return {
    provenance: data.provenance,
    routesAvailable: data.routesAvailable !== false,
    groups: Object.fromEntries(Object.entries(data.groups).map(([key, group]) => [key, {
      ...group,
      short_destination: group.shortDestination,
    }])),
    inventoryExceptions: data.inventoryExceptions,
    validationIssues: evacuationDataIssues(),
  };
}

export function evacuationDataIssues() {
  try {
    const {errors, warnings} = validateMapFiles(ROOT);
    return [...errors, ...warnings];
  } catch (error) {
    return [`Evacuation data could not be validated: ${(error as Error).message}`];
  }
}

function mapped([group,reference_label,[left,top,right,bottom]]: Assignment): Evacuation {
  const info = data.groups[group];
  const [imageWidth, imageHeight] = data.provenance.imageSize;
  return {status:'mapped',group,color:info.color,short_destination:info.shortDestination,reference_label,
    destination:info.destination+(info.appendReferenceLabel ? ` — section labeled ${reference_label}` : ''),
    note:'Check the full reference map for the marked path to this assembly group.',
    focus:{x:left/imageWidth,y:top/imageHeight,width:(right-left)/imageWidth,height:(bottom-top)/imageHeight}};
}
/** Only assign rooms explicitly supported by the supplied reference. */
export function evacuationForRoom(room: {label?:string; building?:string}): Evacuation {
  if (data.routesAvailable === false) {
    return {status:'unconfirmed',group:null,color:null,short_destination:null,reference_label:null,focus:null,
      destination:'Assembly area not confirmed for this room',
      note:'The September 3, 2026 school site map does not show evacuation routes or assembly points. Follow current school staff directions.'};
  }
  const canonical = (room.label ?? '').trim().toUpperCase().replace(/[\s-]+/g,'');
  const building = (room.building ?? '').trim().toUpperCase();
  const numbered = canonical.match(/^([A-Z]+)([1-9][0-9]*)$/);
  const matches = numbered?.[1] === building;
  const special = (
    (building === 'D' && canonical === 'DLIB') ||
    (building === 'BG' && canonical === 'BOWGYM') ||
    (building === 'TG' && canonical === 'TITANGYM')
  );
  if (data.whole[building] && (matches || special)) return mapped(data.whole[building]);
  if (matches && numbered) {
    if (data.exact[canonical]) return mapped(data.exact[canonical]);
    const range = data.ranges.find(([prefix,start,end]) => prefix === building && +numbered[2] >= start && +numbered[2] <= end);
    if (range) return mapped([range[3],range[4],range[5]]);
  }
  return {status:'unconfirmed',group:null,color:null,short_destination:null,reference_label:null,focus:null,
    destination:'Assembly area not confirmed for this room',
    note: canonical === 'E01'
      ? 'The supplied map labels E1-E2, while this classroom is labeled E01. Their correspondence is unconfirmed; confirm the location with school staff.'
      : 'The supplied evacuation map does not clearly identify an assembly area for this room. Confirm the location with school staff.'};
}
