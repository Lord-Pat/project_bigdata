import { copyFile, mkdir, readFile } from "node:fs/promises"

// MapLibre 6 ships module workers next to its bundle. Turbopack relocates that
// bundle, so publish the worker and its shared module together at a stable URL.
const root = new URL("../", import.meta.url)
const source = new URL("node_modules/maplibre-gl/", root)
const { version } = JSON.parse(
  await readFile(new URL("package.json", source), "utf8")
)
const target = new URL(`public/maplibre/${version}/`, root)
await mkdir(target, { recursive: true })
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(new URL(`dist/${name}`, source), new URL(name, target))
}
