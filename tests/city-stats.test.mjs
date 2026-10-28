import { test } from "node:test"
import assert from "node:assert/strict"
import { calculateStats } from "../scripts/generate-city-stats.mjs"

test("medias por métrica: ignora nulos y cadenas, deduplica horas y redondea", () => {
  const time = Array.from(
    { length: 24 },
    (_, i) => `2026-09-01T${String(i).padStart(2, "0")}:00`
  )
  const temperature = Array(24).fill(null)
  const humidity = Array(24).fill(null)
  temperature[0] = 10
  temperature[1] = 21.11
  temperature[2] = "100"
  humidity[0] = 50
  humidity[2] = 150
  const data = {
    utc_offset_seconds: 0,
    hourly: {
      time: [...time, time[0], time[1]],
      temperature_2m: [...temperature, 90, 90],
      relative_humidity_2m: [...humidity, 99, 70],
    },
  }
  const stats = calculateStats("Barcelona", data, "2026-09-01", "2026-09-01")
  assert.equal(stats.temperature_mean_c, 15.6)
  assert.equal(stats.humidity_mean_pct, 60)
  assert.deepEqual(stats.measurements, { temperature: 2, humidity: 2 })
  data.hourly.time.pop()
  assert.throws(() =>
    calculateStats("Barcelona", data, "2026-09-01", "2026-09-01")
  )
})

test("rechaza periodos incompletos y respuestas sin datos válidos", () => {
  assert.throws(() =>
    calculateStats("Madrid", {
      utc_offset_seconds: 0,
      hourly: { time: [], temperature_2m: [], relative_humidity_2m: [] },
    })
  )
})
