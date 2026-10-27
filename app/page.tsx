"use client"
import Link from "next/link"
import { AdminAccess } from "@/components/admin-access"
import { useMemo, useRef, useState } from "react"
import {
  CloudSun,
  Download,
  Database,
  ArrowRight,
  Check,
  FileJson,
  RefreshCw,
  Upload,
  Layers,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CITIES,
  chunks,
  clean,
  emptyFilters,
  fields,
  filtered,
  filterError,
  keyOf,
  period,
  preview,
  transform,
  type Candidate,
  type Filters,
  type Raw,
  type Row,
} from "@/lib/etl/core"
type Stage = { state: string; input: number; output: number; ms: number }
type CityRun = { state: string; error?: string; ms: number }
type Batch = { rows: Row[]; state: string; error?: string; ms: number }
const initialStage = (): Stage => ({
  state: "Pendiente",
  input: 0,
  output: 0,
  ms: 0,
})
const tabs = [
  "JSON original",
  "Transformados",
  "Válidos",
  "Rechazados",
  "Vista previa",
  "Datos en Supabase",
]
const names = [
  "Extracción",
  "Transformación",
  "Limpieza",
  "Filtrado y selección",
  "Carga",
]
const descriptions = [
  "Descarga horaria de Open-Meteo en UTC.",
  "Convierte arrays paralelos en filas.",
  "Valida mediciones y elimina duplicados.",
  "Filtra, ordena y elige las filas a enviar.",
  "Upsert por lotes y verificación en destino.",
]
const labels: Record<keyof Row, string> = {
  ciudad: "Ciudad",
  fecha_hora: "Fecha y hora (UTC)",
  temperatura_c: "Temperatura (°C)",
  humedad_pct: "Humedad (%)",
  precipitacion_mm: "Precipitación (mm)",
}
async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "La petición ha fallado.")
  return data
}
export default function Page() {
  const [cities, setCities] = useState<string[]>(["Barcelona"]),
    [start, setStart] = useState("2026-09-01"),
    [end, setEnd] = useState("2026-09-30")
  const [raw, setRaw] = useState<Record<string, Raw>>({}),
    [cityRuns, setCityRuns] = useState<Record<string, CityRun>>({}),
    [stages, setStages] = useState<Stage[]>(names.map(initialStage))
  const [transformed, setTransformed] = useState<Candidate[]>([]),
    [valid, setValid] = useState<Row[]>([]),
    [rejected, setRejected] = useState<ReturnType<typeof clean>["rejected"]>([])
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState(0),
    [page, setPage] = useState(1),
    [rawCity, setRawCity] = useState("Barcelona")
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters }),
    [sort, setSort] = useState<keyof Row>("fecha_hora"),
    [desc, setDesc] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set())
  const [batches, setBatches] = useState<Batch[]>([]),
    [snapshot, setSnapshot] = useState<Row[]>([])
  const [dest, setDest] = useState<{ rows: Row[]; total: number }>({
      rows: [],
      total: 0,
    }),
    [destPage, setDestPage] = useState(1),
    [destCity, setDestCity] = useState(""),
    [destFrom, setDestFrom] = useState(""),
    [destTo, setDestTo] = useState(""),
    [destBusy, setDestBusy] = useState(false),
    [destError, setDestError] = useState(""),
    [destRead, setDestRead] = useState(false)
  const lock = useRef(false),
    extractLock = useRef(false)
  const extractionPeriod = useRef({ start, end })
  const matching = useMemo(() => {
    const t = performance.now()
    const rows = filtered(valid, filters, sort, desc)
    return { rows, ms: performance.now() - t }
  }, [valid, filters, sort, desc])
  const uploadRows = useMemo(
    () => preview(matching.rows, selected),
    [matching, selected]
  )
  const outside = selected.size - uploadRows.length
  let days = 0,
    configError = ""
  try {
    days = period(start, end)
    if (!cities.length) configError = "Selecciona al menos una ciudad."
  } catch (e) {
    configError = (e as Error).message
  }
  function stage(index: number, data: Stage) {
    setStages((s) => s.map((v, i) => (i === index ? data : v)))
  }
  function changeFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }
  async function extract(retry?: string) {
    if (extractLock.current || lock.current || (!retry && configError)) return
    if (!retry) extractionPeriod.current = { start, end }
    const requestPeriod = { ...extractionPeriod.current }
    extractLock.current = true
    setBusy(true)
    setError("")
    setSelected(new Set())
    setBatches([])
    setSnapshot([])
    const targets = retry ? [retry] : cities,
      nextRaw: Record<string, Raw> = retry ? { ...raw } : {}
    const runs: Record<string, CityRun> = retry
      ? { ...cityRuns }
      : Object.fromEntries(
          targets.map((c) => [c, { state: "Pendiente", ms: 0 }])
        )
    setCityRuns({ ...runs })
    if (!retry) {
      setRaw({})
      setTransformed([])
      setValid([])
      setRejected([])
      setStages(names.map(initialStage))
    }
    const begun = performance.now()
    stage(0, { state: "En curso", input: targets.length, output: 0, ms: 0 })
    try {
      for (const city of targets) {
        runs[city] = { state: "En curso", ms: 0 }
        setCityRuns({ ...runs })
        const t = performance.now()
        try {
          const data = (await jsonFetch(
            `/api/extract?${new URLSearchParams({ city, ...requestPeriod })}`
          )) as Raw
          nextRaw[city] = data
          runs[city] = { state: "Completada", ms: performance.now() - t }
        } catch (e) {
          delete nextRaw[city]
          runs[city] = {
            state: "Con errores",
            error: (e as Error).message,
            ms: performance.now() - t,
          }
        }
        setCityRuns({ ...runs })
        setRaw({ ...nextRaw })
      }
      const count = Object.values(nextRaw).reduce(
        (n, r) =>
          n + (Array.isArray(r.hourly?.time) ? r.hourly.time.length : 0),
        0
      )
      stage(0, {
        state: Object.values(runs).some((r) => r.error)
          ? "Con errores"
          : "Completada",
        input: Object.keys(runs).length,
        output: count,
        ms: performance.now() - begun,
      })
      const t = performance.now()
      const all: Candidate[] = []
      const problems: string[] = []
      for (const [city, data] of Object.entries(nextRaw)) {
        try {
          all.push(...transform(city, data))
        } catch (e) {
          problems.push(`${city}: ${(e as Error).message}`)
        }
      }
      setTransformed(all)
      stage(1, {
        state: problems.length ? "Con errores" : "Completada",
        input: count,
        output: all.length,
        ms: performance.now() - t,
      })
      if (problems.length) setError(problems.join(" · "))
      const t2 = performance.now(),
        result = clean(all)
      setValid(result.valid)
      setRejected(result.rejected)
      stage(2, {
        state: "Completada",
        input: all.length,
        output: result.valid.length,
        ms: performance.now() - t2,
      })
      setTab(2)
      setPage(1)
    } finally {
      setBusy(false)
      extractLock.current = false
    }
  }
  async function upload(retry = false) {
    if (lock.current || extractLock.current || (!retry && !uploadRows.length))
      return
    lock.current = true
    setLoading(true)
    setError("")
    const t = performance.now()
    const work: Batch[] = retry
      ? batches.map((b) => ({ ...b }))
      : chunks(uploadRows.map((r) => ({ ...r }))).map((rows) => ({
          rows,
          state: "Pendiente",
          ms: 0,
        }))
    if (!retry) setSnapshot(work.flatMap((b) => b.rows))
    setBatches([...work])
    stage(4, {
      state: "En curso",
      input: work.reduce((n, b) => n + b.rows.length, 0),
      output: work
        .filter((b) => b.state === "Completada")
        .reduce((n, b) => n + b.rows.length, 0),
      ms: 0,
    })
    try {
      for (let i = 0; i < work.length; i++) {
        if (work[i].state === "Completada") continue
        work[i] = { ...work[i], state: "En curso", error: undefined }
        setBatches([...work])
        const t2 = performance.now()
        try {
          const result = await jsonFetch("/api/measurements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(work[i].rows),
          })
          if (result.verified !== work[i].rows.length)
            throw new Error("Verificación incompleta.")
          work[i] = {
            ...work[i],
            state: "Completada",
            ms: performance.now() - t2,
          }
        } catch (e) {
          work[i] = {
            ...work[i],
            state: "Con errores",
            error: (e as Error).message,
            ms: performance.now() - t2,
          }
        }
        setBatches([...work])
      }
      stage(4, {
        state: work.some((b) => b.state === "Con errores")
          ? "Con errores"
          : "Completada",
        input: work.reduce((n, b) => n + b.rows.length, 0),
        output: work
          .filter((b) => b.state === "Completada")
          .reduce((n, b) => n + b.rows.length, 0),
        ms: performance.now() - t,
      })
    } finally {
      lock.current = false
      setLoading(false)
    }
  }
  async function readDestination(nextPage = 1) {
    setDestBusy(true)
    setDestError("")
    setDestRead(false)
    try {
      const data = await jsonFetch(
        `/api/measurements?${new URLSearchParams({ page: String(nextPage), city: destCity, from: destFrom, to: destTo, sort, desc: String(desc) })}`
      )
      setDest(data)
      setDestPage(nextPage)
      setDestRead(true)
    } catch (e) {
      setDestError((e as Error).message)
      setDest({ rows: [], total: 0 })
    } finally {
      setDestBusy(false)
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(raw[rawCity], null, 2)], {
        type: "application/json",
      })
    )
    const a = document.createElement("a")
    a.href = url
    a.download = `${rawCity}-original.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const displayRows: Candidate[] =
    tab === 1
      ? transformed
      : tab === 2
        ? matching.rows
        : tab === 3
          ? rejected.map((r) => r.row)
          : tab === 4
            ? uploadRows
            : []
  const maxPage = Math.max(1, Math.ceil(displayRows.length / 25)),
    currentPage = Math.min(page, maxPage)
  const currentStages = stages.map((s, i) =>
    i === 3 && transformed.length
      ? {
          state: filterError(filters) ? "Con errores" : "Completada",
          input: valid.length,
          output: matching.rows.length,
          ms: matching.ms,
        }
      : s
  )
  const processed = batches
      .filter((b) => b.state === "Completada")
      .reduce((n, b) => n + b.rows.length, 0),
    failed = batches
      .filter((b) => b.state === "Con errores")
      .reduce((n, b) => n + b.rows.length, 0)
  function table(rows: Candidate[], selection = false, reasons = false) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {selection && <th>Elegir</th>}
              {fields.map((f) => (
                <th key={f}>{labels[f]}</th>
              ))}
              {reasons && <th>Motivo de rechazo</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r, i) => (
                <tr key={`${String(r.ciudad)}-${String(r.fecha_hora)}-${i}`}>
                  {selection && (
                    <td>
                      <input
                        aria-label={`Seleccionar ${r.ciudad} ${r.fecha_hora}`}
                        type="checkbox"
                        checked={selected.has(keyOf(r as Row))}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s)
                            const k = keyOf(r as Row)
                            if (n.has(k)) n.delete(k)
                            else n.add(k)
                            return n
                          })
                        }
                      />
                    </td>
                  )}
                  {fields.map((f) => (
                    <td key={f}>
                      {r[f] === null
                        ? "null"
                        : r[f] === undefined
                          ? "Ausente"
                          : String(r[f])}
                    </td>
                  ))}
                  {reasons && (
                    <td>{rejected[(currentPage - 1) * 25 + i]?.reason}</td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <Layers />
                    <strong>No hay registros para mostrar</strong>
                    <p>
                      {transformed.length
                        ? "Revisa los filtros o selecciona otra fase del pipeline."
                        : "Selecciona las ciudades y pulsa «Extraer datos» para comenzar."}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <div className="workspace">
      <header>
        <Link className="brand" href="/">
          <CloudSun />
          <span>
            Meteo<span>Lab</span>
          </span>
        </Link>
        <span className="header-note">
          Práctica local · Tu laboratorio de datos meteorológicos
        </span>
        <span className="local">
          <span /> Entorno de aprendizaje
        </span>
      </header>
      <main>
        <div className="intro">
          <h1>Tu primer pipeline ETL</h1>
          <p>
            De una API a una base de datos. Extrae, comprende y decide qué datos
            guardar.
          </p>
        </div>
        <AdminAccess />
        <div className="work-grid">
          <aside className="extraction">
            <h2>1. Configura la extracción</h2>
            <p>
              Datos históricos horarios de Open-Meteo. Todas las fechas y horas
              en UTC.
            </p>
            <fieldset disabled={busy || loading}>
              <legend>Ciudades</legend>
              {CITIES.map((c) => (
                <label className="city" key={c.name}>
                  <input
                    type="checkbox"
                    checked={cities.includes(c.name)}
                    onChange={(e) =>
                      setCities((s) =>
                        e.target.checked
                          ? [...s, c.name]
                          : s.filter((x) => x !== c.name)
                      )
                    }
                  />
                  {c.name}
                  <span>
                    {c.latitude.toFixed(2)}°, {c.longitude.toFixed(2)}°
                  </span>
                </label>
              ))}
              <label>
                Fecha inicial
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Fecha final
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </fieldset>
            <div className="estimate">
              <strong>Volumen previsto</strong>
              <div>
                <span>Días · máximo 31</span>
                <b>{days || "—"}</b>
              </div>
              <div>
                <span>Ciudades</span>
                <b>{cities.length}</b>
              </div>
              <div>
                <span>Registros horarios</span>
                <b>{(days * cities.length * 24).toLocaleString("es-ES")}</b>
              </div>
            </div>
            {configError && (
              <p className="error" role="alert">
                {configError}
              </p>
            )}
            <Button
              className="extract-button"
              disabled={busy || loading || !!configError}
              onClick={() => extract()}
            >
              <Download data-icon="inline-start" />
              {busy ? "Extrayendo datos…" : "Extraer datos"}
            </Button>
            <small>
              °C · humedad % · precipitación mm
              <br />
              Fuente:{" "}
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noreferrer"
              >
                Open-Meteo
              </a>{" "}
              · CC BY 4.0
            </small>
            {Object.entries(cityRuns).length > 0 && (
              <div className="city-progress" aria-live="polite">
                {Object.entries(cityRuns).map(([city, r]) => (
                  <div key={city}>
                    <b>{city}</b>
                    <span>
                      {r.state} · {(r.ms / 1000).toFixed(2)} s
                    </span>
                    {r.error && (
                      <>
                        <p className="error">{r.error}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || loading}
                          onClick={() => extract(city)}
                        >
                          Reintentar {city}
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </aside>
          <section className="results">
            <div className="pipeline">
              {currentStages.map((s, i) => (
                <button
                  key={names[i]}
                  className="stage"
                  onClick={() => {
                    setTab([0, 1, 2, 4, 5][i])
                    setPage(1)
                  }}
                >
                  <div
                    className={`stage-node ${s.state === "Completada" ? "done" : ""}`}
                  >
                    {s.state === "Completada" ? <Check /> : i + 1}
                  </div>
                  <strong>{names[i]}</strong>
                  <span
                    className={`status ${s.state === "Con errores" ? "bad" : ""}`}
                  >
                    {s.state}
                  </span>
                  <small>
                    {s.input} → {s.output}{" "}
                    {i === 0 ? "ciudades / filas" : "filas"}
                  </small>
                  <small>{s.ms.toFixed(1)} ms</small>
                  <p>{descriptions[i]}</p>
                </button>
              ))}
            </div>
            <div className="counters">
              {[
                [
                  "Total extraído",
                  Object.values(raw).reduce(
                    (n, r) => n + (r.hourly?.time?.length || 0),
                    0
                  ),
                ],
                ["Válidos", valid.length],
                ["Rechazados", rejected.length],
                ["Coinciden con filtros", matching.rows.length],
                ["Seleccionados para cargar", uploadRows.length],
              ].map(([label, n]) => (
                <div key={String(label)}>
                  <strong>{Number(n).toLocaleString("es-ES")}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <section className="inspector">
              <div className="section-title">
                <div>
                  <h2>Inspección de datos</h2>
                  <p>
                    Explora cada etapa. La paginación solo cambia lo que ves,
                    nunca lo que se envía.
                  </p>
                </div>
                <FileJson />
              </div>
              <div role="tablist" aria-label="Fases de datos" className="tabs">
                {tabs.map((title, i) => (
                  <button
                    role="tab"
                    aria-selected={tab === i}
                    key={title}
                    onClick={() => {
                      setTab(i)
                      setPage(1)
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
              {error && (
                <p role="alert" className="error callout">
                  {error}
                </p>
              )}
              {tab === 0 ? (
                <div className="raw-panel">
                  <div className="toolbar">
                    <label>
                      JSON de la ciudad
                      <select
                        value={rawCity}
                        onChange={(e) => setRawCity(e.target.value)}
                      >
                        {CITIES.map((c) => (
                          <option key={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="outline"
                      disabled={!raw[rawCity]}
                      onClick={download}
                    >
                      <Download data-icon="inline-start" />
                      Descargar JSON
                    </Button>
                  </div>
                  {raw[rawCity] ? (
                    <>
                      <p>
                        Respuesta original conservada durante esta sesión. El
                        visor muestra hasta 16.000 caracteres; la descarga
                        incluye el JSON completo.
                      </p>
                      <pre>
                        {JSON.stringify(raw[rawCity], null, 2).slice(0, 16000)}
                      </pre>
                    </>
                  ) : (
                    <div className="empty">
                      <FileJson />
                      <strong>Aún no hay un JSON para esta ciudad</strong>
                      <p>
                        Extrae datos para inspeccionar la respuesta original.
                      </p>
                    </div>
                  )}
                </div>
              ) : tab === 5 ? (
                <>
                  <div className="destination-banner">
                    <Database />
                    <div>
                      <strong>Datos persistidos en Supabase</strong>
                      <p>
                        Esta consulta lee el destino real; las filas locales
                        pendientes no aparecen aquí.
                      </p>
                    </div>
                  </div>
                  <div className="toolbar">
                    <label>
                      Ciudad
                      <select
                        value={destCity}
                        onChange={(e) => setDestCity(e.target.value)}
                      >
                        <option value="">Todas</option>
                        {CITIES.map((c) => (
                          <option key={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Desde
                      <input
                        type="date"
                        value={destFrom}
                        onChange={(e) => setDestFrom(e.target.value)}
                      />
                    </label>
                    <label>
                      Hasta
                      <input
                        type="date"
                        value={destTo}
                        onChange={(e) => setDestTo(e.target.value)}
                      />
                    </label>
                    <label>
                      Ordenar por
                      <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as keyof Row)}
                      >
                        {fields.map((f) => (
                          <option key={f} value={f}>
                            {labels[f]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Dirección
                      <select
                        value={String(desc)}
                        onChange={(e) => setDesc(e.target.value === "true")}
                      >
                        <option value="false">Ascendente</option>
                        <option value="true">Descendente</option>
                      </select>
                    </label>
                    <Button
                      variant="outline"
                      disabled={destBusy}
                      onClick={() => readDestination()}
                    >
                      <RefreshCw data-icon="inline-start" />
                      {destBusy ? "Consultando…" : "Actualizar"}
                    </Button>
                  </div>
                  {destError ? (
                    <p className="error callout" role="alert">
                      {destError}
                    </p>
                  ) : !destRead ? (
                    <p className="callout">
                      Pulsa «Actualizar» para consultar Supabase con los filtros
                      elegidos.
                    </p>
                  ) : (
                    <>
                      {table(dest.rows)}
                      <div className="pagination">
                        <span>
                          {dest.total} registros persistidos · página {destPage}
                        </span>
                        <Button
                          variant="outline"
                          disabled={destBusy || destPage === 1}
                          onClick={() => readDestination(destPage - 1)}
                        >
                          Anterior
                        </Button>
                        <Button
                          variant="outline"
                          disabled={destBusy || destPage * 25 >= dest.total}
                          onClick={() => readDestination(destPage + 1)}
                        >
                          Siguiente
                        </Button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  {(tab === 2 || tab === 4) && (
                    <>
                      <div className="filters">
                        <fieldset>
                          <legend>
                            Filtrar ciudades · ninguna marcada = todas
                          </legend>
                          <div className="city-filters">
                            {CITIES.map((c) => (
                              <label key={c.name}>
                                <input
                                  type="checkbox"
                                  checked={filters.cities.includes(c.name)}
                                  onChange={(e) =>
                                    changeFilter(
                                      "cities",
                                      e.target.checked
                                        ? [...filters.cities, c.name]
                                        : filters.cities.filter(
                                            (x) => x !== c.name
                                          )
                                    )
                                  }
                                />
                                {c.name}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <div className="filter-grid">
                          <label>
                            Desde (UTC)
                            <input
                              type="datetime-local"
                              value={filters.from}
                              onChange={(e) =>
                                changeFilter("from", e.target.value)
                              }
                            />
                          </label>
                          <label>
                            Hasta (UTC)
                            <input
                              type="datetime-local"
                              value={filters.to}
                              onChange={(e) =>
                                changeFilter("to", e.target.value)
                              }
                            />
                          </label>
                          {(
                            [
                              ["Temperatura °C", "tmin", "tmax"],
                              ["Humedad %", "hmin", "hmax"],
                              ["Precipitación mm", "pmin", "pmax"],
                            ] as const
                          ).map(([title, min, max]) => (
                            <fieldset className="range" key={min}>
                              <legend>{title}</legend>
                              <input
                                aria-label={`${title} mínima`}
                                placeholder="Mín."
                                type="number"
                                step="any"
                                value={filters[min]}
                                onChange={(e) =>
                                  changeFilter(min, e.target.value)
                                }
                              />
                              <span>—</span>
                              <input
                                aria-label={`${title} máxima`}
                                placeholder="Máx."
                                type="number"
                                step="any"
                                value={filters[max]}
                                onChange={(e) =>
                                  changeFilter(max, e.target.value)
                                }
                              />
                            </fieldset>
                          ))}
                        </div>
                        <div className="toolbar">
                          <label className="rain">
                            <input
                              type="checkbox"
                              checked={filters.rain}
                              onChange={(e) =>
                                changeFilter("rain", e.target.checked)
                              }
                            />
                            Solo registros con lluvia (&gt; 0 mm)
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFilters({ ...emptyFilters })
                              setPage(1)
                            }}
                          >
                            Restablecer filtros
                          </Button>
                          <label>
                            Ordenar por
                            <select
                              value={sort}
                              onChange={(e) => {
                                setSort(e.target.value as keyof Row)
                                setPage(1)
                              }}
                            >
                              {fields.map((f) => (
                                <option key={f} value={f}>
                                  {labels[f]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Dirección
                            <select
                              value={String(desc)}
                              onChange={(e) => {
                                setDesc(e.target.value === "true")
                                setPage(1)
                              }}
                            >
                              <option value="false">Ascendente</option>
                              <option value="true">Descendente</option>
                            </select>
                          </label>
                        </div>
                        {filterError(filters) && (
                          <p className="error" role="alert">
                            {filterError(filters)}
                          </p>
                        )}
                      </div>
                      <div className="selection-bar">
                        <span>
                          <b>{uploadRows.length}</b> filas listas · {outside}{" "}
                          seleccionadas fuera de los filtros
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!matching.rows.length}
                          onClick={() =>
                            setSelected(
                              (s) =>
                                new Set([...s, ...matching.rows.map(keyOf)])
                            )
                          }
                        >
                          Seleccionar todas ({matching.rows.length})
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!selected.size}
                          onClick={() => setSelected(new Set())}
                        >
                          Vaciar selección
                        </Button>
                      </div>
                    </>
                  )}
                  {tab === 3 && (
                    <p className="callout">
                      Descartes por calidad: {rejected.length}. Las exclusiones
                      por filtros ({valid.length - matching.rows.length}) se
                      cuentan por separado. En duplicados se conserva la primera
                      fila válida.
                    </p>
                  )}
                  {tab === 4 && (
                    <p className="callout">
                      Conjunto exacto que se enviará, en el orden elegido.
                      Supabase no conserva el orden de inserción: las consultas
                      posteriores necesitan <code>ORDER BY</code>.
                    </p>
                  )}
                  {table(
                    displayRows.slice((currentPage - 1) * 25, currentPage * 25),
                    tab === 2,
                    tab === 3
                  )}
                  <div className="pagination">
                    <span>
                      {displayRows.length} filas · página {currentPage} de{" "}
                      {maxPage} · 25 por página
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === maxPage}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Siguiente
                    </Button>
                  </div>
                </>
              )}
            </section>
          </section>
        </div>
        <section className="load-panel">
          <div>
            <h2>2. Guarda lo que has seleccionado</h2>
            <p>
              Válidos <ArrowRight /> filtros <ArrowRight /> ordenación{" "}
              <ArrowRight /> selección <ArrowRight /> carga
            </p>
            <small>
              Al comenzar se congela una copia de las filas y su orden. Los
              cambios posteriores no alteran esa carga.
            </small>
          </div>
          <div>
            <Button
              variant="outline"
              disabled={!uploadRows.length}
              onClick={() => {
                setTab(4)
                setPage(1)
              }}
            >
              Revisar vista previa
            </Button>
            <Button
              disabled={!uploadRows.length || loading || busy}
              onClick={() => upload()}
            >
              <Upload data-icon="inline-start" />
              {loading
                ? "Carga en curso…"
                : `Subir ${uploadRows.length.toLocaleString("es-ES")} registros a Supabase`}
            </Button>
          </div>
        </section>
        {batches.length > 0 && (
          <section className="batch-panel" aria-live="polite">
            <h2>Resultado de la carga</h2>
            <p>
              Copia congelada: {snapshot.length} filas · Procesadas y
              verificadas: {processed} · Fallidas: {failed} · Pendientes:{" "}
              {snapshot.length - processed - failed}. No se distinguen
              inserciones de actualizaciones.
            </p>
            <div className="batch-list">
              {batches.map((b, i) => (
                <div key={i}>
                  <strong>
                    Lote {i + 1} · {b.rows.length} filas
                  </strong>
                  <span>
                    {b.state} · {(b.ms / 1000).toFixed(2)} s
                  </span>
                  {b.error && <p className="error">{b.error}</p>}
                </div>
              ))}
            </div>
            {failed > 0 && (
              <Button
                variant="outline"
                disabled={loading || busy}
                onClick={() => upload(true)}
              >
                Reintentar solo lotes fallidos
              </Button>
            )}
          </section>
        )}
        <footer>
          <span>MeteoLab · Primera práctica de Big Data</span>
          <span>Datos reales. Decisiones visibles.</span>
        </footer>
      </main>
    </div>
  )
}
