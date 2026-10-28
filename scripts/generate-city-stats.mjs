import { mkdir, rename, writeFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { CITIES, period } from "../lib/etl/core.ts"

const start = "2026-09-01"
const end = "2026-09-30"
const endpoint = "https://archive-api.open-meteo.com/v1/archive"

export function calculateStats(city, data, from = start, to = end) {
  const expected = period(from, to) * 24
  const hourly = data?.hourly
  if (
    data.utc_offset_seconds !== 0 ||
    !hourly ||
    ![hourly.time, hourly.temperature_2m, hourly.relative_humidity_2m].every(
      Array.isArray
    ) ||
    hourly.temperature_2m.length !== hourly.time.length ||
    hourly.relative_humidity_2m.length !== hourly.time.length
  )
    throw new Error(`${city}: respuesta horaria incoherente o sin UTC.`)
  const hours = new Set()
  const temperatures = new Map()
  const humidities = new Map()
  for (let i = 0; i < hourly.time.length; i++) {
    const time = hourly.time[i]
    if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(time))
      throw new Error(`${city}: fecha horaria no válida.`)
    const date = new Date(`${time}:00.000Z`)
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 16) !== time ||
      time.slice(0, 10) < from ||
      time.slice(0, 10) > to
    )
      throw new Error(`${city}: fecha fuera del periodo o no válida.`)
    hours.add(time)
    const temperature = hourly.temperature_2m[i]
    const humidity = hourly.relative_humidity_2m[i]
    // A duplicate never adds weight; use the first valid value for each metric.
    if (
      typeof temperature === "number" &&
      Number.isFinite(temperature) &&
      !temperatures.has(time)
    )
      temperatures.set(time, temperature)
    if (
      typeof humidity === "number" &&
      Number.isFinite(humidity) &&
      humidity >= 0 &&
      humidity <= 100 &&
      !humidities.has(time)
    )
      humidities.set(time, humidity)
  }
  if (hours.size !== expected || !temperatures.size || !humidities.size)
    throw new Error(`${city}: periodo incompleto o sin mediciones válidas.`)
  const mean = (values) =>
    Math.round(
      ([...values.values()].reduce((sum, value) => sum + value, 0) /
        values.size) *
        10
    ) / 10
  return {
    city,
    start_date: from,
    end_date: to,
    temperature_mean_c: mean(temperatures),
    humidity_mean_pct: mean(humidities),
    measurements: { temperature: temperatures.size, humidity: humidities.size },
  }
}

async function main() {
  period(start, end)
  const cities = []
  for (const city of CITIES) {
    const query = new URLSearchParams({
      latitude: String(city.latitude),
      longitude: String(city.longitude),
      start_date: start,
      end_date: end,
      hourly: "temperature_2m,relative_humidity_2m,precipitation",
      timezone: "UTC",
      temperature_unit: "celsius",
      precipitation_unit: "mm",
    })
    const response = await fetch(`${endpoint}?${query}`, {
      signal: AbortSignal.timeout(45000),
    })
    if (!response.ok)
      throw new Error(`${city.name}: Open-Meteo respondió ${response.status}.`)
    const stats = calculateStats(city.name, await response.json())
    cities.push(stats)
    console.log(
      `${city.name}: ${stats.temperature_mean_c.toFixed(1)} °C · ${stats.humidity_mean_pct.toFixed(1)} % · ${stats.measurements.temperature}/${stats.measurements.humidity} mediciones`
    )
  }
  const target = new URL("../data/city-stats.json", import.meta.url)
  const temporary = new URL(
    `../data/.city-stats-${process.pid}.tmp`,
    import.meta.url
  )
  await mkdir(new URL("../data/", import.meta.url), { recursive: true })
  try {
    await writeFile(
      temporary,
      JSON.stringify(
        {
          source: endpoint,
          timezone: "UTC",
          generated_at: new Date().toISOString(),
          cities,
        },
        null,
        2
      ) + "\n",
      { flag: "wx" }
    )
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
  console.log("Estadísticas completas guardadas en data/city-stats.json.")
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`No se han actualizado las estadísticas: ${error.message}`)
    process.exitCode = 1
  })
}
