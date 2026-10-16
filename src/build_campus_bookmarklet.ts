import { fileURLToPath } from "node:url";
import { build } from "vite";

export async function buildCampusBookmarklet(appUrl: string): Promise<string> {
  const result = await build({
    configFile: false, publicDir: false, logLevel: "warn",
    define: { GUNNWATT_APP_URL: JSON.stringify(appUrl) },
    build: { write: false, target: "es2022", sourcemap: false, minify: true,
      lib: { entry: fileURLToPath(new URL("./campus/bookmarklet.ts", import.meta.url)),
        name: "GunnWattImport", formats: ["iife"] } },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!output || !("output" in output)) throw new Error("Bookmark build failed.");
  const chunk = output.output.find(item => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Bookmark build is empty.");
  return `javascript:${encodeURIComponent(`void ${chunk.code.trim()}`)}`;
}
