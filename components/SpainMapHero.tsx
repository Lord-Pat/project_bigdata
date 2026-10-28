"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import type {
  Map as MapLibreMap,
  Marker,
  Popup,
  StyleSpecification,
} from "maplibre-gl"
import { CITIES } from "@/lib/etl/core"
import { Thermometer, Droplets } from "lucide-react"
import historicalStats from "@/data/city-stats.json"
import "maplibre-gl/dist/maplibre-gl.css"

const configuredUrl = process.env.NEXT_PUBLIC_MAPTILER_URL
const cityStats = new Map(
  historicalStats.cities.map((city) => [city.city, city])
)
const formatMean = (value: number) =>
  value.toLocaleString("es-ES", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
const formatPeriodDate = (value: string) => value.split("-").reverse().join("/")
function mapStyleUrl() {
  if (!configuredUrl)
    throw new Error(
      "Configura NEXT_PUBLIC_MAPTILER_URL con la URL del estilo de MapTiler."
    )
  const url = new URL(configuredUrl)
  if (url.protocol !== "https:")
    throw new Error("La URL del estilo debe utilizar HTTPS.")
  if (
    url.hostname === "api.maptiler.com" &&
    /^\/maps\/[^/]+\/?$/.test(url.pathname)
  ) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/style.json`
  }
  return url.toString()
}
type City = (typeof CITIES)[number]
type Status = { phase: "loading" | "ready" | "error"; message?: string }

export default function SpainMapHero() {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<MapLibreMap | null>(null)
  const popup = useRef<Popup | null>(null)
  const selection = useRef<City | null>(null)
  const markers = useRef<
    { city: City; marker: Marker; button: HTMLButtonElement }[]
  >([])
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<Status>({ phase: "loading" })
  const [selected, setSelected] = useState<City | null>(null)
  const stats = selected ? cityStats.get(selected.name) : undefined

  const showPopup = useCallback((city: City | null) => {
    markers.current.forEach(({ button }) => {
      button.removeAttribute("aria-describedby")
      button.removeAttribute("aria-controls")
    })
    const current = popup.current,
      map = instance.current
    if (!city || !current || !map) {
      current?.remove()
      return
    }
    current
      .setLngLat([city.longitude, city.latitude])
      .setText(city.name)
      .addTo(map)
    const element = current.getElement()
    element.id = "city-marker-popup"
    element.setAttribute("role", "tooltip")
    markers.current
      .find((entry) => entry.city.name === city.name)
      ?.button.setAttribute("aria-describedby", element.id)
    const position = map.project([city.longitude, city.latitude]),
      width = element.offsetWidth
    const center = Math.max(
      12 + width / 2,
      Math.min(map.getContainer().clientWidth - 12 - width / 2, position.x)
    )
    current.setOffset([center - position.x, -42])
  }, [])

  useEffect(() => {
    if (!container.current) return
    const started = performance.now()
    const timing: Record<string, number> = {}
    let disposed = false
    let failed = false
    let observer: ResizeObserver | undefined
    const abort = new AbortController()
    const listeners = new AbortController()
    const measure = (name: string, since = started) => {
      const duration = Math.round(performance.now() - since)
      timing[name] = duration
      performance.measure(`meteolab:map:${name}`, {
        start: since,
        end: performance.now(),
      })
      return duration
    }
    const report = (outcome: string) => {
      window.dispatchEvent(
        new CustomEvent("meteolab:map-metrics", {
          detail: { ...timing, outcome },
        })
      )
      console.info("MeteoLab · mapa (ms)", { ...timing, outcome })
    }
    const release = () => {
      observer?.disconnect()
      listeners.abort()
      popup.current?.remove()
      popup.current = null
      markers.current.forEach(({ marker }) => marker.remove())
      markers.current = []
      instance.current?.remove()
      instance.current = null
    }
    const fail = (message: string) => {
      if (disposed || failed) return
      failed = true
      abort.abort()
      clearTimeout(timeout)
      release()
      measure("total")
      report("error")
      setStatus({ phase: "error", message })
    }
    // Covers module download, style request, WebGL and tile loading together.
    const timeout = setTimeout(
      () =>
        fail(
          "El mapa no ha terminado de cargar en 15 segundos. Puedes elegir una ciudad y acceder al dashboard o reintentarlo."
        ),
      15000
    )
    async function initialize() {
      try {
        const styleUrl = mapStyleUrl()
        const resourceUrl = (value: string) =>
          new URL(value, styleUrl).href
            .replace(/%7B/gi, "{")
            .replace(/%7D/gi, "}")
        const libraryPromise = import("maplibre-gl").then((library) => {
          measure("library")
          return library
        })
        const stylePromise = (async () => {
          const response = await fetch(styleUrl, { signal: abort.signal })
          if (!response.ok)
            throw new Error(
              "No se pudo obtener el estilo de MapTiler. Revisa la clave pública y sus dominios permitidos."
            )
          const style = (await response.json()) as StyleSpecification
          if (
            style.version !== 8 ||
            !style.sources ||
            !Array.isArray(style.layers)
          )
            throw new Error(
              "La URL configurada no devuelve un estilo cartográfico válido."
            )
          // Keep relative style resources working when supplying the downloaded JSON.
          if (typeof style.sprite === "string")
            style.sprite = resourceUrl(style.sprite)
          if (style.glyphs) style.glyphs = resourceUrl(style.glyphs)
          for (const source of Object.values(style.sources)) {
            if ("url" in source && typeof source.url === "string")
              source.url = resourceUrl(source.url)
          }
          measure("style")
          return style
        })()
        const [library, style] = await Promise.all([
          libraryPromise,
          stylePromise,
        ])
        if (disposed || failed || !container.current) return
        library.setWorkerUrl(
          `/maplibre/${library.getVersion()}/maplibre-gl-worker.mjs`
        )
        library.setWorkerCount(2)
        const bounds = new library.LngLatBounds()
        CITIES.forEach((city) => bounds.extend([city.longitude, city.latitude]))
        // Include the whole peninsula, with bounds derived from the existing cities.
        const peninsula = new library.LngLatBounds(
          [bounds.getWest() - 4.0, bounds.getSouth() - 1.5],
          [bounds.getEast() + 1.5, bounds.getNorth() + 0.5]
        )
        const createStarted = performance.now()
        const map = new library.Map({
          container: container.current,
          style,
          center: [-3.7, 40.2],
          zoom: 5,
          bearing: 0,
          pitch: 0,
          maxPitch: 0,
          interactive: false,
          scrollZoom: false,
          boxZoom: false,
          dragRotate: false,
          dragPan: false,
          keyboard: false,
          doubleClickZoom: false,
          touchZoomRotate: false,
          touchPitch: false,
          renderWorldCopies: false,
          attributionControl: { compact: false },
          fadeDuration: 0,
        })
        instance.current = map
        popup.current = new library.Popup({
          className: "city-marker-popup",
          anchor: "bottom",
          closeButton: false,
          closeOnClick: false,
          closeOnMove: false,
          focusAfterOpen: false,
          offset: 42,
          maxWidth: "180px",
        })
        measure("instance", createStarted)
        const fit = () => {
          if (disposed || failed || !container.current || !instance.current)
            return
          const { width, height } = container.current.getBoundingClientRect()
          const mobile = width < 760
          map.resize()
          map.fitBounds(peninsula, {
            padding: {
              top: 60,
              bottom: mobile ? Math.min(290, height * 0.38) : 64,
              left: mobile ? 28 : 60,
              right: mobile ? 28 : Math.min(380, width * 0.28),
            },
            duration: 0,
            absolutePadding: true,
            maxZoom: 6.5,
          })
          if (selection.current) showPopup(selection.current)
        }
        markers.current = CITIES.map((city) => {
          const button = document.createElement("button")
          button.type = "button"
          button.className = "city-map-marker"
          button.setAttribute("aria-label", `Seleccionar ${city.name}`)
          button.setAttribute("aria-pressed", "false")
          button.setAttribute("aria-expanded", "false")
          button.innerHTML =
            '<svg class="city-pin" viewBox="0 0 32 42" aria-hidden="true" focusable="false"><path d="M16 1.5C8 1.5 1.5 8 1.5 16c0 10.5 14.5 24 14.5 24S30.5 26.5 30.5 16C30.5 8 24 1.5 16 1.5Z"/><circle cx="16" cy="16" r="5"/></svg>'
          button.addEventListener(
            "click",
            () => {
              selection.current = city
              setSelected(city)
              showPopup(city)
            },
            { signal: listeners.signal }
          )
          button.addEventListener(
            "pointerenter",
            (event) => {
              if (event.pointerType === "mouse") showPopup(city)
            },
            { signal: listeners.signal }
          )
          button.addEventListener(
            "pointerleave",
            (event) => {
              if (event.pointerType === "mouse") showPopup(selection.current)
            },
            { signal: listeners.signal }
          )
          button.addEventListener("focus", () => showPopup(city), {
            signal: listeners.signal,
          })
          button.addEventListener("blur", () => showPopup(selection.current), {
            signal: listeners.signal,
          })
          const marker = new library.Marker({
            element: button,
            anchor: "bottom",
          })
            .setLngLat([city.longitude, city.latitude])
            .addTo(map)
          return { city, marker, button }
        })
        const tilesStarted = performance.now()
        map.once("load", () => {
          if (disposed || failed) return
          clearTimeout(timeout)
          measure("tilesAndFonts", tilesStarted)
          measure("total")
          report("ready")
          setStatus({ phase: "ready" })
        })
        map.on("error", () => {
          if (!map.isStyleLoaded())
            fail(
              "No se ha podido renderizar el mapa. Puedes seleccionar una ciudad sin mapa o reintentar la carga."
            )
        })
        fit()
        observer = new ResizeObserver(fit)
        observer.observe(container.current)
      } catch (error) {
        if (!disposed && !failed)
          fail(
            error instanceof Error && !/https?:|key=/i.test(error.message)
              ? error.message
              : "No se ha podido cargar MapTiler. Comprueba la conexión y la configuración del estilo."
          )
      }
    }
    void initialize()
    return () => {
      disposed = true
      clearTimeout(timeout)
      abort.abort()
      release()
    }
  }, [attempt, showPopup])

  useEffect(() => {
    selection.current = selected
    markers.current.forEach(({ city, button }) => {
      const active = city.name === selected?.name
      button.classList.toggle("is-selected", active)
      button.setAttribute("aria-pressed", String(active))
      button.setAttribute("aria-expanded", String(active))
      button.removeAttribute("aria-describedby")
    })
    showPopup(selected)
  }, [selected, status.phase, showPopup])

  useEffect(() => {
    const close = () => {
      setSelected(null)
      popup.current?.remove()
      markers.current.forEach(({ button }) =>
        button.removeAttribute("aria-describedby")
      )
    }
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(
          ".city-map-marker, .city-marker-popup, .city-glass-card, .fallback-cities"
        )
      )
        close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [])

  return (
    <section
      className={`spain-map-hero map-state-${status.phase}`}
      aria-label="Explora España, selecciona una ciudad"
    >
      <div
        ref={container}
        className="spain-map-hero__map"
        aria-label="Mapa de España"
      />
      {status.phase === "loading" && (
        <div className="map-loading" role="status">
          <span className="map-loading-dot" />
          Preparando el mapa de España…
          <small>
            Selecciona una ciudad para explorar su laboratorio de datos.
          </small>
        </div>
      )}
      {status.phase !== "ready" && (
        <div className="map-alternative">
          {status.phase === "error" && (
            <>
              <h1>Explora España</h1>
              <p role="alert">{status.message}</p>
              <button
                className="map-retry"
                onClick={() => {
                  setStatus({ phase: "loading" })
                  setAttempt((value) => value + 1)
                }}
              >
                Reintentar
              </button>
            </>
          )}
          <div
            className="fallback-cities"
            aria-label="Ciudades disponibles sin mapa"
          >
            {CITIES.map((city) => (
              <button
                key={city.name}
                onClick={() => setSelected(city)}
                aria-pressed={selected?.name === city.name}
              >
                {city.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {selected && (
        <aside
          className="city-glass-card"
          aria-label={`Información de ${selected.name}`}
        >
          <button
            className="city-card-close"
            aria-label="Cerrar información de ciudad"
            onClick={() => setSelected(null)}
          >
            ×
          </button>
          <span className="city-card-caption">Laboratorio meteorológico</span>
          <h1>{selected.name}</h1>
          <dl>
            <div>
              <dt>Latitud</dt>
              <dd>{selected.latitude.toFixed(2)}°</dd>
            </div>
            <div>
              <dt>Longitud</dt>
              <dd>{selected.longitude.toFixed(2)}°</dd>
            </div>
          </dl>
          {stats ? (
            <>
              <div className="city-historical-stats">
                <div>
                  <Thermometer aria-hidden="true" />
                  <span>Temperatura media</span>
                  <strong>{formatMean(stats.temperature_mean_c)} °C</strong>
                </div>
                <div>
                  <Droplets aria-hidden="true" />
                  <span>Humedad media</span>
                  <strong>{formatMean(stats.humidity_mean_pct)} %</strong>
                </div>
              </div>
              <p className="city-historical-period">
                Media histórica · {formatPeriodDate(stats.start_date)} –{" "}
                {formatPeriodDate(stats.end_date)}
              </p>
            </>
          ) : (
            <p>Datos no disponibles</p>
          )}
          <Link
            className="city-dashboard-link"
            href={`/dashboard?city=${encodeURIComponent(selected.name)}`}
            prefetch={false}
          >
            Acceder al dashboard <span aria-hidden="true">→</span>
          </Link>
        </aside>
      )}
    </section>
  )
}
