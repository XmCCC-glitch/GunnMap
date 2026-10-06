import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildings, roomData, rooms, ROOT } from "./project.js";
import { evacuationForRoom, evacuationOverview } from "./evacuation.js";

const output = resolve(ROOT, "dist/web");
await mkdir(resolve(output, "data"), { recursive: true });
await rm(resolve(output, "sw.js"), { force: true });

const located = rooms.map(room => ({
  id: room.id,
  label: room.label,
  building: room.building,
  floor: room.floor ?? 1,
  aliases: room.aliases ?? [],
  polygon: room.polygon,
  marker: [
    (room.label_box[0] + room.label_box[2]) / 2,
    (room.label_box[1] + room.label_box[3]) / 2,
  ],
  evacuation: evacuationForRoom(room),
}));

await Promise.all([
  writeFile(resolve(output, "data/rooms.json"), JSON.stringify({
    buildings,
    rooms: located.map(({ id, label, building, floor, aliases }) => ({ id, label, building, floor, aliases })),
  })),
  writeFile(resolve(output, "data/located-rooms.json"), JSON.stringify({ rooms: located, map_size: roomData.image_size })),
  writeFile(resolve(output, "data/evacuation.json"), JSON.stringify(evacuationOverview())),
  copyFile(resolve(ROOT, "web/style.css"), resolve(output, "style.css")),
  copyFile(resolve(ROOT, "web/icon.svg"), resolve(output, "icon.svg")),
  copyFile(resolve(ROOT, "web/apple-touch-icon.png"), resolve(output, "apple-touch-icon.png")),
  copyFile(resolve(ROOT, "web/pwa-icon-192.png"), resolve(output, "pwa-icon-192.png")),
  copyFile(resolve(ROOT, "web/pwa-icon-512.png"), resolve(output, "pwa-icon-512.png")),
  copyFile(resolve(ROOT, "src/map/gunn_site_map.png"), resolve(output, "map.png")),
  copyFile(resolve(ROOT, "src/map/gunn_site_map.png"), resolve(output, "evacuation-map.png")),
  writeFile(resolve(output, ".nojekyll"), ""),
]);

const base = "/GunnMap/";
const template = await readFile(resolve(ROOT, "web/index.html"), "utf8");
const html = template.replaceAll('href="/', `href="${base}`).replaceAll('src="/', `src="${base}`);
await Promise.all([
  writeFile(resolve(output, "index.html"), html),
  writeFile(resolve(output, "404.html"), html),
  writeFile(resolve(output, "manifest.webmanifest"), JSON.stringify({
    ...JSON.parse(await readFile(resolve(ROOT, "web/manifest.webmanifest"), "utf8")),
    id: base,
    start_url: base,
    scope: base,
    icons: [
      { src: `${base}pwa-icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}pwa-icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  })),
]);

const css = await readFile(resolve(output, "style.css"), "utf8");
await writeFile(resolve(output, "style.css"), css.replaceAll('url("/assets/', `url("${base}assets/`));
