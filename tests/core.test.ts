import assert from "node:assert/strict"
import { test } from "node:test"
import {
  clean,
  transform,
  filtered,
  emptyFilters,
  keyOf,
  preview,
  chunks,
  period,
} from "../lib/etl/core.ts"
const raw = {
  utc_offset_seconds: 0,
  hourly: {
    time: Array.from(
      { length: 24 },
      (_, i) => `2026-09-01T${String(i).padStart(2, "0")}:00`
    ),
    temperature_2m: Array(24).fill(23),
    relative_humidity_2m: Array(24).fill(60),
    precipitation: Array.from({ length: 24 }, (_, i) => i % 2),
  },
}
test("24 horas y transformación UTC explícita", () => {
  const rows = transform("Barcelona", raw)
  assert.equal(rows.length, 24)
  assert.equal(rows[0].fecha_hora, "2026-09-01T00:00:00.000Z")
  assert.equal(clean(rows).valid.length, 24)
})
test("nulos, cadenas y duplicados: conserva primera válida", () => {
  const rows = transform("Barcelona", raw)
  const result = clean([
    { ...rows[0], temperatura_c: null },
    { ...rows[0], humedad_pct: "" },
    ...rows,
    rows[0],
  ])
  assert.equal(result.valid.length, 24)
  assert.equal(result.rejected.length, 3)
  assert.match(result.rejected[2].reason, /Duplicado/)
})
test("arrays desiguales y fechas imposibles", () => {
  assert.throws(() =>
    transform("Barcelona", {
      ...raw,
      hourly: { ...raw.hourly, precipitation: [] },
    })
  )
  assert.equal(
    clean([
      {
        ...transform("Barcelona", raw)[0],
        fecha_hora: "2026-02-30T00:00:00.000Z",
      },
    ]).rejected.length,
    1
  )
  assert.throws(() => period("2026-09-01", "2026-10-02"))
})
test("filtra y ordena antes de paginar; selección entre páginas; preview exacta", () => {
  const rows = clean(transform("Barcelona", raw)).valid
  const selected = new Set([keyOf(rows[1]), keyOf(rows[23])])
  const sorted = filtered(
    rows,
    { ...emptyFilters, rain: true },
    "fecha_hora",
    true
  )
  assert.equal(sorted.length, 12)
  assert.equal(sorted.slice(0, 5)[0].fecha_hora, rows[23].fecha_hora)
  const snapshot = preview(sorted, selected)
  assert.deepEqual(snapshot, [rows[23], rows[1]])
  assert.deepEqual(chunks(snapshot, 1).flat(), snapshot)
  assert.equal(
    preview(
      filtered(rows, { ...emptyFilters, pmax: "0" }, "fecha_hora", false),
      selected
    ).length,
    0
  )
})
