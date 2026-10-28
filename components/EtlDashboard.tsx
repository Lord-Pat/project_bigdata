"use client"
import Link from "next/link"
import "./dashboard.css"
import { MapPin, ArrowLeft } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Download,
  Database,
  ArrowRight,
  Check,
  FileJson,
  RefreshCw,
  Upload,
  Layers,
  Copy,
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
  "JSON original de Open-Meteo",
  "Transformados",
  "Válidos",
  "Rechazados",
  "Vista previa",
  "Datos en Supabase",
  "JSON seleccionado para Supabase",
  "JSON de la última carga",
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
export default function EtlDashboard({
  requestedCity,
  onSummary,
}: {
  requestedCity?: string
  onSummary: (
    value: Record<string, { extracted: number; valid: number }>
  ) => void
}) {
  const [cities, setCities] = useState<string[]>([
      requestedCity || "Barcelona",
    ]),
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
    [rawCity, setRawCity] = useState(requestedCity || "Barcelona")
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
  const [view, setView] = useState(0)
  const [runFinished, setRunFinished] = useState(false)
  const [confirmReplacement, setConfirmReplacement] = useState(false)
  const [selectionAccepted, setSelectionAccepted] = useState<Row[] | null>(null)
  const [inspectionAccepted, setInspectionAccepted] = useState<Row[] | null>(
    null
  )
  const [copyStatus, setCopyStatus] = useState({ json: "", message: "" })
  const stageTabs = useRef([0, 2, 6, 4])
  function goStage(next: number, dataTab?: number) {
    if (view === 1 && next === 2 && uploadRows.length)
      setSelectionAccepted(uploadRows)
    stageTabs.current[view] = tab
    setView(next)
    setTab(dataTab ?? (next === 2 ? 6 : stageTabs.current[next]))
  }
  function finishInspection() {
    if (uploadRows.length) setInspectionAccepted(uploadRows)
    goStage(3)
  }
  const [appliedCity, setAppliedCity] = useState(requestedCity)
  if (requestedCity && requestedCity !== appliedCity && !busy && !loading) {
    setCities([requestedCity])
    setAppliedCity(requestedCity)
  }
  useEffect(() => {
    const summary = Object.fromEntries(
      Object.entries(raw).map(([city, data]) => [
        city,
        {
          extracted: Array.isArray(data.hourly?.time)
            ? data.hourly.time.length
            : 0,
          valid: valid.filter((row) => row.ciudad === city).length,
        },
      ])
    )
    onSummary(summary)
  }, [raw, valid, onSummary])
  useEffect(() => {
    if (!busy && !loading) return
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", protect)
    return () => window.removeEventListener("beforeunload", protect)
  }, [busy, loading])
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
  const selectedJson = useMemo(
    () => JSON.stringify(uploadRows, null, 2),
    [uploadRows]
  )
  function downloadSelected() {
    if (!uploadRows.length) return
    const url = URL.createObjectURL(
      new Blob([selectedJson], { type: "application/json" })
    )
    const link = document.createElement("a")
    link.href = url
    link.download = "meteolab-registros-seleccionados.json"
    link.click()
    URL.revokeObjectURL(url)
  }
  async function copySelected() {
    if (!uploadRows.length) return
    try {
      await navigator.clipboard.writeText(selectedJson)
      setCopyStatus({
        json: selectedJson,
        message: "JSON copiado al portapapeles.",
      })
    } catch {
      setCopyStatus({
        json: selectedJson,
        message: "No se pudo copiar. Puedes descargar el JSON seleccionado.",
      })
    }
  }
  const jsonCities = Object.keys(raw)
  const successfulCities = jsonCities.filter(
    (city) => cityRuns[city]?.state === "Completada"
  )
  const localCities = [...new Set(valid.map((row) => row.ciudad))].filter(
    (city) => successfulCities.includes(city)
  )
  const citiesWithoutValidRows = successfulCities.filter(
    (city) => !localCities.includes(city)
  )
  const extractionFailures = Object.entries(cityRuns).filter(
    ([, run]) => !!run.error
  )
  const selectionCities = [...new Set(uploadRows.map((row) => row.ciudad))]
  if (jsonCities.length && !jsonCities.includes(rawCity))
    setRawCity(jsonCities[0])
  if (runFinished && !busy) {
    setRunFinished(false)
    setView(successfulCities.length ? 1 : 0)
    setTab(2)
  }
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
  async function runExtraction(retry?: string) {
    if (extractLock.current || lock.current || (!retry && configError)) return
    setConfirmReplacement(false)
    setRunFinished(false)
    if (!retry) setFilters({ ...emptyFilters })
    try {
      await extract(retry)
    } finally {
      setRunFinished(true)
    }
  }
  function requestExtraction() {
    const activeFilters = Object.values(filters).some((value) =>
      Array.isArray(value)
        ? value.length > 0
        : typeof value === "boolean"
          ? value
          : value !== ""
    )
    if (
      jsonCities.length ||
      transformed.length ||
      selected.size ||
      batches.length ||
      activeFilters
    ) {
      setConfirmReplacement(true)
    } else void runExtraction()
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
  const allowedTabs =
    view === 1
      ? [2, 3]
      : view === 2
        ? [6, 0, 1, 4, ...(snapshot.length ? [7] : [])]
        : [4, 5]
  const visibleTab =
    view === 0 || allowedTabs.includes(tab) ? tab : [0, 2, 6, 4][view]
  const displayRows: Candidate[] =
    visibleTab === 1
      ? transformed
      : visibleTab === 2
        ? matching.rows
        : visibleTab === 3
          ? rejected.map((r) => r.row)
          : visibleTab === 4
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
                      {visibleTab === 4
                        ? "Selecciona registros antes de continuar con la carga."
                        : !jsonCities.length
                          ? "Todavía no has realizado ninguna extracción."
                          : !valid.length
                            ? "No hay registros válidos. Revisa los registros rechazados y los errores de procesamiento."
                            : transformed.length
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
  const flow = [
    {
      title: "Extracción de datos",
      short: "Extraer",
      sub: "Origen y periodo",
      heading: "Configura tu extracción",
      description:
        "Confirma las ubicaciones y las fechas antes de descargar las mediciones de Open-Meteo.",
      sideTitle: "Antes de comenzar",
      sideBody:
        "Confirma las ciudades y el rango de fechas. La extracción utiliza mediciones horarias en UTC y admite un máximo de 31 días.",
    },
    {
      title: "Exploración y selección",
      short: "Explorar",
      sub: "Validar y seleccionar",
      heading: "Revisa y selecciona los datos",
      description:
        "Distingue los registros válidos de los descartados. Filtra y decide cuáles quieres cargar.",
      sideTitle: "Tu selección",
      sideBody:
        "Solo los registros válidos, seleccionados y dentro de los filtros llegarán a la vista previa. Los descartes de calidad se cuentan por separado.",
    },
    {
      title: "Inspector JSON",
      short: "Inspeccionar",
      sub: "JSON y vista previa",
      heading: "Inspecciona los resultados",
      description:
        "Comprueba el origen y el formato de los datos antes de continuar hacia su almacenamiento.",
      sideTitle: "Antes de guardar",
      sideBody:
        "El JSON original permite auditar la respuesta. La vista previa muestra exactamente las filas seleccionadas que se enviarán a Supabase.",
    },
    {
      title: "Carga a Supabase",
      short: "Guardar",
      sub: "Carga a Supabase",
      heading: "Carga a Supabase",
      description:
        "Revisa el conjunto final y el resultado de cada lote. Los datos locales y los persistidos se consultan por separado.",
      sideTitle: loading
        ? "Carga en curso"
        : failed
          ? "Revisa los lotes fallidos"
          : processed
            ? "Resultado de la carga"
            : "Listo para confirmar",
      sideBody:
        "La carga utiliza lotes de hasta 500 filas con upsert y verificación posterior de persistencia. Los lotes fallidos pueden reintentarse.",
    },
  ]
  const currentFlow = flow[view]
  const extractedCount = Object.values(raw).reduce(
    (count, data) => count + (data.hourly?.time?.length || 0),
    0
  )
  const completed = [
    !busy &&
      valid.length > 0 &&
      stages.slice(1, 3).every((item) => item.state === "Completada"),
    uploadRows.length > 0 && selectionAccepted === uploadRows,
    uploadRows.length > 0 && inspectionAccepted === uploadRows,
    !loading &&
      batches.length > 0 &&
      batches.every((batch) => batch.state === "Completada"),
  ]
  const summaries = [
    [
      ["Ubicaciones", cities.length],
      ["Duración", days ? `${days} días` : "Periodo no válido"],
      ["Volumen previsto", days * cities.length * 24],
    ],
    [
      ["Registros válidos", valid.length],
      ["Rechazados", rejected.length],
      ["Seleccionados para cargar", uploadRows.length],
    ],
    [
      ["Respuestas originales", Object.keys(raw).length],
      ["Transformados", transformed.length],
      ["Selección final", uploadRows.length],
    ],
    [
      ["Filas preparadas", uploadRows.length],
      ["Ciudades en la selección", selectionCities.join(", ") || "Ninguna"],
      ["Lotes necesarios", Math.ceil(uploadRows.length / 500)],
      ["Procesadas y verificadas", processed],
      ["Fallidas", failed],
    ],
  ]

  const extractionPanel = (
    <aside className="extraction">
      <h2>01 · Datos de origen</h2>
      <p>
        Datos históricos horarios de Open-Meteo. Todas las fechas y horas en
        UTC.
      </p>
      <fieldset disabled={busy || loading}>
        <legend>Ciudades</legend>
        <div className="dash-city-chips">
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
        </div>
        <div className="dash-date-fields">
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
        </div>
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
        className="extract-button dash-primary"
        aria-busy={busy}
        disabled={busy || loading || !!configError}
        onClick={requestExtraction}
      >
        <Download data-icon="inline-start" />
        {busy ? "Extrayendo datos…" : "Extraer datos"}
      </Button>
      {confirmReplacement && (
        <div
          className="dash-replace-confirm"
          role="alertdialog"
          aria-labelledby="replace-extraction-title"
        >
          <strong id="replace-extraction-title">
            Sustituir la extracción actual
          </strong>
          <p>
            Esta nueva extracción reemplazará los resultados, los filtros, la
            selección y los resultados de lotes de esta sesión. No se acumulará
            con la extracción anterior ni borrará datos de Supabase.
          </p>
          <div>
            <Button
              variant="outline"
              onClick={() => setConfirmReplacement(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={busy || loading || !!configError}
              onClick={() => runExtraction()}
            >
              Confirmar nueva extracción
            </Button>
          </div>
        </div>
      )}
      <small>
        °C · humedad % · precipitación mm
        <br />
        Fuente:{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
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
                    onClick={() => runExtraction(city)}
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
  )
  const pipelinePanel = (
    <div className="pipeline">
      {currentStages.map((s, i) => (
        <div key={names[i]} className="stage">
          <div
            className={`stage-node ${s.state === "Completada" ? "done" : ""}`}
          >
            {s.state === "Completada" ? <Check /> : i + 1}
          </div>
          <strong>{names[i]}</strong>
          <span className={`status ${s.state === "Con errores" ? "bad" : ""}`}>
            {s.state}
          </span>
          <small>
            {s.input} → {s.output} {i === 0 ? "ciudades / filas" : "filas"}
          </small>
          <small>{s.ms.toFixed(1)} ms</small>
          <p>{descriptions[i]}</p>
        </div>
      ))}
    </div>
  )
  const metricCards = (
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
  )
  const inspectorPanel = (
    <section className="inspector">
      <div className="section-title">
        <div>
          <h2>
            {view === 1
              ? "Control de calidad y selección"
              : view === 2
                ? "Inspector de datos"
                : visibleTab === 5
                  ? "Datos guardados en Supabase"
                  : "Vista previa antes de subir"}
          </h2>
          <p>
            Explora cada etapa. La paginación solo cambia lo que ves, nunca lo
            que se envía.
          </p>
        </div>
        <FileJson />
      </div>
      <div role="tablist" aria-label="Fases de datos" className="tabs">
        {allowedTabs
          .map((i) => ({ title: tabs[i], i }))
          .map(({ title, i }) => (
            <button
              role="tab"
              aria-selected={visibleTab === i}
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
      {visibleTab === 6 || visibleTab === 7 ? (
        <div className="raw-panel">
          {visibleTab === 7 ? (
            <>
              <p className="callout">
                Copia congelada de la última operación: {snapshot.length}{" "}
                registros. Los cambios de selección no alteran este conjunto.
                Consulta los lotes para conocer cuáles se verificaron.
              </p>
              <pre aria-label="JSON de la última carga">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </>
          ) : uploadRows.length ? (
            <>
              <p>
                Conjunto completo preparado para enviar: {uploadRows.length}{" "}
                registros de {selectionCities.length} ciudades. Conserva el
                orden, los tipos y las fechas UTC del payload real.
              </p>
              <pre aria-label="JSON seleccionado para Supabase">
                {selectedJson}
              </pre>
            </>
          ) : (
            <div className="empty">
              <FileJson />
              <strong>No has seleccionado registros para exportar.</strong>
              <p>
                Vuelve a Exploración y selecciona los datos que quieras preparar
                para Supabase.
              </p>
              <Button variant="outline" onClick={() => goStage(1, 2)}>
                Volver a Exploración
              </Button>
            </div>
          )}
        </div>
      ) : visibleTab === 0 ? (
        <div className="raw-panel">
          <div className="toolbar">
            <label>
              JSON de la ciudad
              <select
                value={jsonCities.includes(rawCity) ? rawCity : ""}
                disabled={!jsonCities.length}
                onChange={(e) => setRawCity(e.target.value)}
              >
                {!jsonCities.length && (
                  <option value="">Sin JSON disponibles</option>
                )}
                {jsonCities.map((city) => (
                  <option key={city}>{city}</option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={!raw[rawCity]}
              onClick={download}
            >
              <Download data-icon="inline-start" />
              Descargar JSON original
            </Button>
          </div>
          {raw[rawCity] ? (
            <>
              <p>
                Respuesta original conservada durante esta sesión. El visor
                muestra hasta 16.000 caracteres; la descarga incluye el JSON
                completo.
              </p>
              <pre>{JSON.stringify(raw[rawCity], null, 2).slice(0, 16000)}</pre>
            </>
          ) : (
            <div className="empty">
              <FileJson />
              <strong>Aún no hay un JSON para esta ciudad</strong>
              <p>Extrae datos para inspeccionar la respuesta original.</p>
            </div>
          )}
        </div>
      ) : visibleTab === 5 ? (
        <>
          <div className="destination-banner">
            <Database />
            <div>
              <strong>Datos persistidos en Supabase</strong>
              <p>
                Esta consulta lee el destino real; las filas locales pendientes
                no aparecen aquí. Puede incluir otras ciudades y extracciones
                anteriores, independientemente de esta sesión.
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
          {view === 1 && visibleTab === 2 && (
            <>
              <div className="filters">
                <fieldset>
                  <legend>Filtrar ciudades · ninguna marcada = todas</legend>
                  <div className="city-filters">
                    {!localCities.length && (
                      <p>
                        No hay ciudades con registros válidos para seleccionar.
                      </p>
                    )}
                    {localCities.map((city) => (
                      <label key={city}>
                        <input
                          type="checkbox"
                          checked={filters.cities.includes(city)}
                          onChange={(e) =>
                            changeFilter(
                              "cities",
                              e.target.checked
                                ? [...filters.cities, city]
                                : filters.cities.filter((x) => x !== city)
                            )
                          }
                        />
                        {city}
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
                      onChange={(e) => changeFilter("from", e.target.value)}
                    />
                  </label>
                  <label>
                    Hasta (UTC)
                    <input
                      type="datetime-local"
                      value={filters.to}
                      onChange={(e) => changeFilter("to", e.target.value)}
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
                        onChange={(e) => changeFilter(min, e.target.value)}
                      />
                      <span>—</span>
                      <input
                        aria-label={`${title} máxima`}
                        placeholder="Máx."
                        type="number"
                        step="any"
                        value={filters[max]}
                        onChange={(e) => changeFilter(max, e.target.value)}
                      />
                    </fieldset>
                  ))}
                </div>
                <div className="toolbar">
                  <label className="rain">
                    <input
                      type="checkbox"
                      checked={filters.rain}
                      onChange={(e) => changeFilter("rain", e.target.checked)}
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
            </>
          )}
          {visibleTab === 3 && (
            <p className="callout">
              Descartes por calidad: {rejected.length}. Las exclusiones por
              filtros ({valid.length - matching.rows.length}) se cuentan por
              separado. En duplicados se conserva la primera fila válida.
            </p>
          )}
          {visibleTab === 4 && (
            <p className="callout">
              Conjunto exacto que se enviará, en el orden elegido. Supabase no
              conserva el orden de inserción: las consultas posteriores
              necesitan <code>ORDER BY</code>.
            </p>
          )}
          {table(
            displayRows.slice((currentPage - 1) * 25, currentPage * 25),
            visibleTab === 2,
            visibleTab === 3
          )}
          <div className="pagination">
            <span>
              {displayRows.length} filas · página {currentPage} de {maxPage} ·
              25 por página
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
  )
  const uploadPanel = (
    <div className="dash-upload-actions">
      <div className="toolbar">
        <Button
          variant="outline"
          disabled={!uploadRows.length}
          onClick={() => {
            goStage(2, 4)
            setPage(1)
          }}
        >
          Revisar vista previa
        </Button>
        <Button variant="outline" onClick={() => goStage(1, 2)}>
          Volver a selección
        </Button>
        <Button
          className="dash-primary"
          aria-busy={loading}
          disabled={!uploadRows.length || loading || busy}
          onClick={() => upload()}
        >
          <Upload data-icon="inline-start" />
          {loading
            ? "Carga en curso…"
            : `Subir ${uploadRows.length.toLocaleString("es-ES")} registros a Supabase`}
        </Button>
      </div>
      <small>
        Al comenzar se congela una copia de las filas y su orden. Los cambios
        posteriores no alteran esa carga.
      </small>
    </div>
  )
  const batchPanel =
    batches.length > 0 ? (
      <section className="batch-panel" aria-live="polite">
        <h2>Resultado de la carga</h2>
        <Button variant="outline" onClick={() => goStage(2, 7)}>
          Ver JSON de la última carga
        </Button>
        <p>
          Copia congelada: {snapshot.length} filas · Procesadas y verificadas:{" "}
          {processed} · Fallidas: {failed} · Pendientes:{" "}
          {snapshot.length - processed - failed}. No se distinguen inserciones
          de actualizaciones.
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
    ) : null

  return (
    <div className="etl-dashboard dash-shell">
      <div className="dash-main">
        <header className="dash-topbar">
          <div className="dash-breadcrumb">
            <Link href="/" prefetch={false}>
              Mapa de España
            </Link>
            <span>›</span>
            <span>{cities.length ? cities.join(", ") : "Sin ciudades"}</span>
            <span>›</span>
            <strong>Dashboard ETL</strong>
          </div>
          <Link className="dash-back" href="/" prefetch={false}>
            <ArrowLeft />
            Volver al mapa
          </Link>
        </header>
        <main className="dash-body">
          <div className="dash-title-row">
            <div>
              <p className="dash-kicker">CENTRO DE TRABAJO · ETL</p>
              <h1>{currentFlow.heading}</h1>
              <p className="dash-subtitle">{currentFlow.description}</p>
            </div>
            <div className="dash-location">
              <MapPin />
              <span>{cities.join(", ") || "Sin ciudades"}</span>
            </div>
          </div>
          <nav className="dash-steps" aria-label="Etapas del dashboard">
            {flow.map((item, index) => (
              <button
                key={item.title}
                data-completed={completed[index]}
                data-error={index === 3 && failed > 0}
                aria-label={`${index === 0 ? "Extracción" : item.title}: ${completed[index] ? "completada" : index === 3 && failed > 0 ? "con errores" : view === index ? "activa" : "pendiente"}`}
                aria-current={view === index ? "step" : undefined}
                onClick={() => goStage(index)}
              >
                <span className="dash-step-bubble">
                  {completed[index] ? (
                    <Check />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span>
                  <strong>{index === 0 ? "Extracción" : item.title}</strong>
                  <small>{item.sub}</small>
                </span>
              </button>
            ))}
          </nav>
          <div className="dash-stage-layout">
            <div className="dash-content-stack">
              {view === 0 ? (
                <>
                  {extractionPanel}
                  <section className="dash-panel">
                    <div className="dash-panel-top">
                      <h2>02 · Estado del pipeline</h2>
                      <span className="dash-info-badge">
                        {busy
                          ? "En curso"
                          : extractedCount
                            ? "Datos de esta sesión"
                            : "Sin ejecutar"}
                      </span>
                    </div>
                    <p className="dash-panel-desc">
                      Las cinco fases muestran el estado, el volumen y el tiempo
                      reales de cada operación.
                    </p>
                    {pipelinePanel}
                  </section>
                  {error && (
                    <p className="error callout" role="alert">
                      {error}
                    </p>
                  )}
                </>
              ) : (
                <>
                  {view === 1 && metricCards}
                  {view === 1 && (
                    <div className="selection-bar">
                      <span>
                        <b>{uploadRows.length}</b> filas listas · {outside}{" "}
                        seleccionadas fuera de los filtros
                      </span>
                      <Button
                        className="dash-primary"
                        disabled={!matching.rows.length}
                        onClick={() =>
                          setSelected(
                            (s) => new Set([...s, ...matching.rows.map(keyOf)])
                          )
                        }
                      >
                        <Check data-icon="inline-start" />
                        Seleccionar todos los filtrados ({matching.rows.length})
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!selected.size}
                        onClick={() => setSelected(new Set())}
                      >
                        Vaciar selección
                      </Button>
                      <Button
                        className="dash-primary"
                        onClick={() => goStage(2)}
                      >
                        Revisar datos <ArrowRight data-icon="inline-end" />
                      </Button>
                    </div>
                  )}
                  {view === 2 && (
                    <section
                      className="dash-panel dash-json-summary"
                      aria-label="Preparación del JSON"
                    >
                      <div className="dash-json-metrics">
                        <span>
                          <strong>{uploadRows.length}</strong> registros
                          seleccionados
                        </span>
                        <span>
                          <strong>{selectionCities.length}</strong> ciudades
                        </span>
                        <span>
                          Formato <strong>JSON · array</strong>
                        </span>
                        <span>
                          {uploadRows.length
                            ? "Preparado para Supabase"
                            : "Pendiente de selección"}
                        </span>
                      </div>
                      <div className="dash-stage-actions">
                        <Button
                          className="dash-primary"
                          disabled={!uploadRows.length}
                          onClick={downloadSelected}
                        >
                          <Download />
                          Descargar JSON seleccionado
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!uploadRows.length}
                          onClick={copySelected}
                        >
                          <Copy />
                          Copiar JSON seleccionado
                        </Button>
                        <Button
                          className="dash-primary"
                          onClick={finishInspection}
                        >
                          Ir a Supabase <ArrowRight data-icon="inline-end" />
                        </Button>
                      </div>
                      {copyStatus.json === selectedJson &&
                        copyStatus.message && (
                          <p role="status">{copyStatus.message}</p>
                        )}
                    </section>
                  )}
                  {view === 1 && !jsonCities.length && !busy && (
                    <p className="callout" role="status">
                      Todavía no has realizado ninguna extracción correcta.
                      Vuelve a Extracción de datos para comenzar.
                    </p>
                  )}
                  {view === 1 &&
                    !busy &&
                    citiesWithoutValidRows.map((city) => (
                      <div className="dash-empty-city" role="status" key={city}>
                        <strong>{city}</strong>
                        <p>
                          No hay registros válidos para esta ciudad. Su JSON
                          está disponible en el inspector; revisa los rechazados
                          o los errores de procesamiento.
                        </p>
                      </div>
                    ))}
                  {view === 1 && extractionFailures.length > 0 && (
                    <section
                      className="dash-extraction-warning"
                      aria-label="Ciudades con extracción fallida"
                    >
                      <strong>
                        {successfulCities.length
                          ? "Extracción parcial: puedes continuar con los resultados obtenidos."
                          : "No se ha obtenido ninguna ciudad correctamente. Vuelve a extracción o reintenta las ciudades fallidas."}
                      </strong>
                      {extractionFailures.map(([city, run]) => (
                        <div key={city}>
                          <p>
                            {city}: {run.error}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || loading}
                            onClick={() => runExtraction(city)}
                          >
                            Reintentar {city}
                          </Button>
                        </div>
                      ))}
                    </section>
                  )}
                  {view === 3 && (
                    <section
                      className="dash-panel dash-upload-summary"
                      aria-label="Preparación de la carga"
                    >
                      <h2>Selección final para Supabase</h2>
                      <div className="dash-upload-counts">
                        <div>
                          <span>Extraídos localmente</span>
                          <strong>{extractedCount}</strong>
                        </div>
                        <div>
                          <span>Seleccionados para enviar</span>
                          <strong>{uploadRows.length}</strong>
                        </div>
                        <div>
                          <span>Procesados y verificados</span>
                          <strong>{processed}</strong>
                        </div>
                      </div>
                      <p>
                        Ciudades en la selección:{" "}
                        <strong>
                          {selectionCities.join(", ") || "Ninguna"}
                        </strong>{" "}
                        · Lotes previstos:{" "}
                        <strong>{Math.ceil(uploadRows.length / 500)}</strong>.
                      </p>
                      <p>
                        Estado:{" "}
                        {loading
                          ? "Carga en curso"
                          : failed
                            ? "Hay lotes fallidos"
                            : processed
                              ? "Consulta el resultado de los lotes"
                              : "Sin enviar"}
                        .
                      </p>
                      {!uploadRows.length && (
                        <div className="callout">
                          <p>
                            Selecciona registros antes de continuar con la
                            carga.
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => goStage(1, 2)}
                          >
                            Volver a exploración
                          </Button>
                        </div>
                      )}
                      {uploadPanel}
                    </section>
                  )}
                  {inspectorPanel}
                </>
              )}
              {view === 3 && <>{batchPanel}</>}
              <div className="dash-stage-actions">
                {view === 1 && (
                  <Button variant="outline" onClick={() => goStage(0)}>
                    Modificar extracción
                  </Button>
                )}
                {view > 0 && (
                  <Button variant="outline" onClick={() => goStage(view - 1)}>
                    Etapa anterior
                  </Button>
                )}
              </div>
            </div>
            <aside className="dash-side-card" aria-label="Resumen de la etapa">
              <p className="dash-kicker">
                PASO {String(view + 1).padStart(2, "0")} ·{" "}
                {currentFlow.title.toUpperCase()}
              </p>
              <h2>{currentFlow.sideTitle}</h2>
              <p>{currentFlow.sideBody}</p>
              {summaries[view].map(([label, value]) => (
                <div className="dash-summary-line" key={String(label)}>
                  <span>{label}</span>
                  <strong>
                    {typeof value === "number"
                      ? value.toLocaleString("es-ES")
                      : value}
                  </strong>
                </div>
              ))}
              {view === 3 && (
                <Button variant="outline" onClick={() => goStage(3, 5)}>
                  Consultar datos guardados
                </Button>
              )}
              <small>
                Datos de esta sesión. Cambiar de etapa no ejecuta operaciones ni
                descarta tu selección.
              </small>
            </aside>
          </div>
        </main>
      </div>
    </div>
  )
}
