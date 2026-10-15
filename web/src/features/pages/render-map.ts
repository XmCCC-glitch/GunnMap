import { findRoomMatches } from "../../../../src/domain/room-matching.js";
import type { Period } from "../schedule/types.js";
import type { LocatedRoom } from "../rooms/types.js";
import { loadLocatedRooms, siteUrl } from "./site-data.js";

type Point = [number, number];

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

function strips(polygon: Point[], colors: string[]): Array<{ polygon: Point[]; color: string }> {
  if (colors.length === 1) return [{ polygon, color: colors[0] }];
  const xs = polygon.map(point => point[0]);
  const ys = polygon.map(point => point[1]);
  const axis = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : 1;
  const coordinates = axis === 0 ? xs : ys;
  const lower = Math.min(...coordinates);
  const upper = Math.max(...coordinates);
  return colors.flatMap((color, index) => {
    const start = lower + (upper - lower) * index / colors.length;
    const end = lower + (upper - lower) * (index + 1) / colors.length;
    const part = clipPolygon(clipPolygon(polygon, axis, start, true), axis, end, false);
    return part.length >= 3 ? [{ polygon: part, color }] : [];
  });
}

function drawPolygon(context: CanvasRenderingContext2D, polygon: Point[], color: string, scaleX: number, scaleY: number) {
  context.beginPath();
  polygon.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x * scaleX, y * scaleY);
    else context.lineTo(x * scaleX, y * scaleY);
  });
  context.closePath();
  context.fillStyle = color;
  context.globalAlpha = 0.55;
  context.fill();
  context.globalAlpha = 0.92;
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.stroke();
  context.globalAlpha = 1;
}

export async function renderPagesMap(periods: Period[]): Promise<string> {
  const { rooms, map_size } = await loadLocatedRooms();
  const chosen: Array<{ period: number; room: LocatedRoom; color: string }> = [];
  for (const [index, period] of periods.entries()) {
    if (!period.room.trim()) continue;
    const matches = findRoomMatches(rooms, period.room, period.building);
    if (matches.length !== 1) throw new Error(`Period ${index + 1}: choose a recognized room.`);
    chosen.push({ period: index + 1, room: matches[0], color: period.color });
  }

  const source = new Image();
  source.src = siteUrl("/map.webp");
  await source.decode();
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the map.");
  context.drawImage(source, 0, 0);
  const scaleX = canvas.width / map_size[0];
  const scaleY = canvas.height / map_size[1];
  const colorsByRoom = new Map<string, string[]>();
  for (const item of chosen) {
    const colors = colorsByRoom.get(item.room.id) ?? [];
    colors.push(item.color);
    colorsByRoom.set(item.room.id, colors);
  }
  for (const [id, colors] of colorsByRoom) {
    const room = rooms.find(item => item.id === id)!;
    for (const part of strips(room.polygon, colors)) {
      drawPolygon(context, part.polygon, part.color, scaleX, scaleY);
    }
  }

  if (chosen.length) {
    const left = 420;
    const height = 90 + 34 * chosen.length;
    const top = canvas.height - height - 24;
    context.fillStyle = "#fffffff0";
    context.fillRect(left, top, 420, height);
    context.strokeStyle = "#27272a";
    context.lineWidth = 2;
    context.strokeRect(left, top, 420, height);
    context.fillStyle = "#19191c";
    context.font = "bold 26px sans-serif";
    context.fillText("YOUR SCHEDULE", left + 24, top + 42);
    context.font = "20px sans-serif";
    for (const [index, item] of chosen.entries()) {
      const y = top + 75 + 34 * index;
      context.fillStyle = item.color;
      context.fillRect(left + 24, y - 18, 16, 16);
      context.fillStyle = "#19191c";
      context.fillText(`Period ${item.period} · ${item.room.label}${item.room.floor === 2 ? " (2F)" : ""}`, left + 52, y);
    }
  }
  return canvas.toDataURL("image/png");
}
