export const CITIES = [
  { name: "Barcelona", latitude: 41.3874, longitude: 2.1686 },
  { name: "Madrid", latitude: 40.4168, longitude: -3.7038 },
  { name: "Sevilla", latitude: 37.3891, longitude: -5.9845 },
  { name: "Bilbao", latitude: 43.263, longitude: -2.935 },
  { name: "Valencia", latitude: 39.4699, longitude: -0.3763 },
] as const
export type Row = {
  ciudad: string
  fecha_hora: string
  temperatura_c: number
  humedad_pct: number
  precipitacion_mm: number
}
export type Candidate = { [K in keyof Row]: unknown }
export type Rejected = { row: Candidate; reason: string }
export type Raw = {
  hourly: {
    time: unknown[]
    temperature_2m: unknown[]
    relative_humidity_2m: unknown[]
    precipitation: unknown[]
  }
  [key: string]: unknown
}
export const keyOf = (r: Row) => `${r.ciudad}|${r.fecha_hora}`
export const fields = [
  "ciudad",
  "fecha_hora",
  "temperatura_c",
  "humedad_pct",
  "precipitacion_mm",
] as const
export function dateOnly(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
export function period(start: string, end: string) {
  if (!dateOnly(start) || !dateOnly(end))
    throw new Error("Introduce fechas válidas.")
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  if (days < 1 || days > 31)
    throw new Error("El periodo debe estar entre 1 y 31 días, ambos incluidos.")
  if (end > new Date().toISOString().slice(0, 10))
    throw new Error("La fecha final no puede estar en el futuro.")
  return days
}
export function transform(city: string, raw: Raw): Candidate[] {
  const h = raw?.hourly
  if (
    !h ||
    ![h.time, h.temperature_2m, h.relative_humidity_2m, h.precipitation].every(
      Array.isArray
    )
  )
    throw new Error("Faltan arrays horarios en la respuesta.")
  if (
    ![h.temperature_2m, h.relative_humidity_2m, h.precipitation].every(
      (a) => a.length === h.time.length
    )
  )
    throw new Error("Los arrays horarios tienen longitudes incoherentes.")
  if (raw.utc_offset_seconds !== 0)
    throw new Error("La respuesta no está en UTC.")
  return h.time.map((t, i) => ({
    ciudad: city,
    fecha_hora:
      typeof t === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)
        ? `${t}:00.000Z`
        : t,
    temperatura_c: h.temperature_2m[i],
    humedad_pct: h.relative_humidity_2m[i],
    precipitacion_mm: h.precipitation[i],
  }))
}
export function reason(row: Candidate): string | null {
  if (
    typeof row.ciudad !== "string" ||
    !row.ciudad.trim() ||
    row.ciudad.length > 100
  )
    return "Ciudad ausente o inválida"
  if (
    typeof row.fecha_hora !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.fecha_hora) ||
    !Number.isFinite(Date.parse(row.fecha_hora)) ||
    new Date(row.fecha_hora).toISOString() !== row.fecha_hora
  )
    return "Fecha UTC inválida"
  for (const field of fields.slice(2))
    if (typeof row[field] !== "number" || !Number.isFinite(row[field]))
      return `${field}: medición ausente o número no finito`
  if ((row.humedad_pct as number) < 0 || (row.humedad_pct as number) > 100)
    return "Humedad fuera de 0–100 %"
  if ((row.precipitacion_mm as number) < 0) return "Precipitación negativa"
  return null
}
export function clean(rows: Candidate[]) {
  const valid: Row[] = [],
    rejected: Rejected[] = [],
    seen = new Set<string>()
  for (const row of rows) {
    const error = reason(row)
    if (error) {
      rejected.push({ row, reason: error })
      continue
    }
    const record = row as Row,
      key = keyOf(record)
    if (seen.has(key)) {
      rejected.push({
        row,
        reason: "Duplicado: se conserva la primera fila válida",
      })
      continue
    }
    seen.add(key)
    valid.push(record)
  }
  return { valid, rejected }
}
export type Filters = {
  cities: string[]
  from: string
  to: string
  tmin: string
  tmax: string
  hmin: string
  hmax: string
  pmin: string
  pmax: string
  rain: boolean
}
export const emptyFilters: Filters = {
  cities: [],
  from: "",
  to: "",
  tmin: "",
  tmax: "",
  hmin: "",
  hmax: "",
  pmin: "",
  pmax: "",
  rain: false,
}
export function filterError(f: Filters) {
  if (f.from && f.to && f.from > f.to)
    return "El inicio del filtro debe preceder al final."
  for (const [min, max] of [
    [f.tmin, f.tmax],
    [f.hmin, f.hmax],
    [f.pmin, f.pmax],
  ]) {
    if ([min, max].some((v) => v !== "" && !Number.isFinite(Number(v))))
      return "Los límites deben ser números finitos."
    if (min !== "" && max !== "" && Number(min) > Number(max))
      return "El mínimo no puede superar al máximo."
  }
  return null
}
export function filtered(
  rows: Row[],
  f: Filters,
  sort: keyof Row,
  desc: boolean
) {
  if (filterError(f)) return []
  return rows
    .filter(
      (r) =>
        (!f.cities.length || f.cities.includes(r.ciudad)) &&
        (!f.from || r.fecha_hora >= `${f.from}:00.000Z`) &&
        (!f.to || r.fecha_hora <= `${f.to}:59.999Z`) &&
        (!f.rain || r.precipitacion_mm > 0) &&
        [
          [r.temperatura_c, f.tmin, f.tmax],
          [r.humedad_pct, f.hmin, f.hmax],
          [r.precipitacion_mm, f.pmin, f.pmax],
        ].every(
          ([v, min, max]) =>
            (min === "" || Number(v) >= Number(min)) &&
            (max === "" || Number(v) <= Number(max))
        )
    )
    .sort((a, b) => {
      const x = a[sort],
        y = b[sort]
      const c =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y))
      return (c || keyOf(a).localeCompare(keyOf(b))) * (desc ? -1 : 1)
    })
}
export const preview = (rows: Row[], selected: Set<string>) =>
  rows.filter((r) => selected.has(keyOf(r)))
export const chunks = <T>(rows: T[], size = 500): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
    rows.slice(i * size, (i + 1) * size)
  )
