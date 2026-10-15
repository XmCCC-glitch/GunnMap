import sharp, { type Sharp } from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ROOT, readJson, roomData, rooms, type Point } from './project.js';
import { findRoomMatches } from './domain/room-matching.js';
export const xml = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const svg = (width:number,height:number,body:string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
export async function saveImage(image: Sharp, output: string): Promise<string> {
  await mkdir(dirname(output),{recursive:true}); await image.png().toFile(output); return output;
}
export interface HighlightOptions {opacity?:number; baseImage?:string}
async function render(polygons: {polygon:Point[];color:string}[], size:Point, base:string, options:HighlightOptions = {}): Promise<Buffer> {
  const opacity = options.opacity ?? 0.35;
  if (!(opacity>0 && opacity<=1)) throw new Error('opacity must be greater than 0 and at most 1');
  const source = options.baseImage ?? resolve(ROOT,base);
  const {width,height} = await sharp(source).metadata();
  if (!width || !height) throw new Error('Map dimensions are missing');
  const sx=width/size[0], sy=height/size[1];
  // SVG values are escaped; colors are also validated by sharp before rendering.
  for (const {color} of polygons) await sharp({create:{width:1,height:1,channels:3,background:color}}).raw().toBuffer();
  const body = polygons.map(({polygon,color})=>`<polygon points="${polygon.map(([x,y])=>`${Math.round(x*sx)},${Math.round(y*sy)}`).join(' ')}" fill="${xml(color)}" fill-opacity="${opacity}" stroke="${xml(color)}" stroke-opacity="${Math.min(1,opacity+95/255)}" stroke-width="${Math.max(2,Math.round(Math.min(sx,sy)*3))}" stroke-linejoin="round"/>`).join('');
  return sharp(source).composite([{input:svg(width,height,body)}]).removeAlpha().png().toBuffer();
}
function clipPolygon(polygon: Point[], axis: 0 | 1, boundary: number, keepGreater: boolean): Point[] {
  if (!polygon.length) return [];
  const result: Point[] = [];
  const inside = (point: Point) => keepGreater ? point[axis] >= boundary : point[axis] <= boundary;
  let previous = polygon[polygon.length - 1];
  for (const current of polygon) {
    if (inside(previous) !== inside(current)) {
      const ratio = (boundary - previous[axis]) / (current[axis] - previous[axis]);
      result.push([previous[0] + ratio * (current[0] - previous[0]), previous[1] + ratio * (current[1] - previous[1])]);
    }
    if (inside(current)) result.push(current);
    previous = current;
  }
  return result;
}
function coloredStrips(polygon: Point[], colors: readonly string[]): { polygon: Point[]; color: string }[] {
  if (colors.length === 1) return [{ polygon, color: colors[0] }];
  const xs = polygon.map(point => point[0]), ys = polygon.map(point => point[1]);
  const axis = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : 1;
  const coordinates = axis === 0 ? xs : ys;
  const lower = Math.min(...coordinates), upper = Math.max(...coordinates);
  return colors.flatMap((color, index) => {
    const start = lower + (upper - lower) * index / colors.length;
    const end = lower + (upper - lower) * (index + 1) / colors.length;
    const strip = clipPolygon(clipPolygon(polygon, axis, start, true), axis, end, false);
    return strip.length >= 3 ? [{ polygon: strip, color }] : [];
  });
}
export async function renderRooms(colors: Record<string,string | readonly string[]>, options: HighlightOptions = {}): Promise<Buffer> {
  const polygons = Object.entries(colors).flatMap(([name,color])=>{
    const matches=findRoomMatches(rooms,name);
    if (!matches.length) throw new Error(`Unknown room '${name}'; see room_index.csv`);
    if (matches.length>1) throw new Error(`Room label '${name}' is duplicated; select one of ${matches.map(r=>r.id).join(', ')}`);
    const palette = typeof color === 'string' ? [color] : color;
    if (!palette.length) throw new Error(`Room '${name}' needs at least one color`);
    return coloredStrips(matches[0].polygon, palette);
  });
  return render(polygons,roomData.image_size,roomData.base_image,options);
}
export async function highlightRooms(colors:Record<string,string | readonly string[]>, output:string, options:HighlightOptions = {}) {
  return saveImage(sharp(await renderRooms(colors,options)),output);
}
export async function highlightBuildings(colors:Record<string,string>, output:string, options:HighlightOptions = {}) {
  const data=readJson<{base_image:string;image_size:Point;regions:Record<string,{aliases?:string[];polygons:Point[][]}>}>('building_regions.json');
  const polygons=Object.entries(colors).flatMap(([name,color])=>{
    const entry=Object.entries(data.regions).find(([key,r])=>[key,...(r.aliases??[])].some(alias=>alias.toLowerCase()===name.trim().toLowerCase()));
    if (!entry) throw new Error(`Unknown building '${name}'`);
    return entry[1].polygons.map(polygon=>({polygon,color}));
  });
  return saveImage(sharp(await render(polygons,data.image_size,data.base_image,options)),output);
}
export async function createRoomIndexImage(output:string) {
  const [w,h]=roomData.image_size;
  const body=rooms.map(r=>{const [x,y]=r.tag_point??[r.label_box[0],r.label_box[1]-12];return `<rect x="${x}" y="${y}" width="22" height="12" fill="white"/><text x="${x}" y="${y+10}" font-family="sans-serif" font-size="10" fill="#d00000">${Number(r.id.slice(1))}</text>`;}).join('');
  return saveImage(sharp(resolve(ROOT,roomData.base_image)).composite([{input:svg(w,h,body)}]),output);
}
