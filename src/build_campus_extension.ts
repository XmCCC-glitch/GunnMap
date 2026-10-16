import { mkdir, readdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import sharp from "sharp";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist/campus-extension");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, "extension/public"), output, { recursive: true });
for (const entry of ["background", "campus-content", "site-content", "popup"]) {
  await build({
    configFile: false, publicDir: false, logLevel: "warn",
    build: {
      outDir: output, emptyOutDir: false, target: "chrome120", sourcemap: false,
      lib: {
        entry: join(root, `extension/src/${entry}.ts`), name: "GunnWattCampus",
        formats: entry === "background" ? ["es"] : ["iife"], fileName: () => `${entry}.js`,
      },
    },
  });
}
for (const size of [16, 32, 48, 128]) {
  await sharp(join(output, "icon.svg")).resize(size, size).png().toFile(join(output, `icon-${size}.png`));
}
const entries: Record<string, Uint8Array> = {};
async function files(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await files(path);
    else entries[relative(output, path).replaceAll("\\", "/")] = new Uint8Array(await readFile(path));
  }
}
await files(output);
const archive = zipSync(entries, { level: 9 });
await writeFile(join(root, "dist/gunnwatt-campus-connector.zip"), archive);
await mkdir(join(root, "dist/web"), { recursive: true });
await writeFile(join(root, "dist/web/campus-connector.zip"), archive);
console.log("Built dist/campus-extension and dist/gunnwatt-campus-connector.zip");
