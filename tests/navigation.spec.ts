import { test, expect } from "@playwright/test"
const cities = ["Barcelona", "Madrid", "Valencia", "Sevilla", "Bilbao"]
import { readFileSync } from "node:fs"
const historicalStats = JSON.parse(
  readFileSync(new URL("../data/city-stats.json", import.meta.url), "utf8")
) as {
  cities: {
    city: string
    temperature_mean_c: number
    humidity_mean_pct: number
  }[]
}
const style = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "base",
      type: "background",
      paint: { "background-color": "#d5e9e8" },
    },
  ],
}
async function mockMap(page: import("@playwright/test").Page) {
  await page.route("https://api.maptiler.com/maps/**", (route) =>
    route.fulfill({ json: style })
  )
}

test("mapa: cinco ciudades, popups y navegación sin extracción automática", async ({
  page,
}) => {
  await mockMap(page)
  let calls = 0
  page.on("request", (request) => {
    if (
      /\/api\/(extract|measurements)|archive-api\.open-meteo\.com/.test(
        request.url()
      )
    )
      calls++
  })
  await page.goto("/")
  await expect(page.locator(".city-map-marker")).toHaveCount(5)
  await expect(page.locator("header")).toHaveCount(0)
  await expect(page.getByRole("navigation")).toHaveCount(0)
  await expect(page.locator(".brand")).toHaveCount(0)
  const dimensions = await page.locator(".spain-map-hero").boundingBox()
  expect(dimensions).toMatchObject({ x: 0, y: 0, width: 1440, height: 1000 })
  await expect(
    page.getByRole("heading", { name: "Tu primer pipeline ETL" })
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight
    )
  ).toBe(true)
  for (const city of cities) {
    await page
      .getByRole("button", { name: `Seleccionar ${city}`, exact: true })
      .click()
    await expect(
      page.getByRole("complementary", { name: `Información de ${city}` })
    ).toBeVisible()
    const stats = historicalStats.cities.find((entry) => entry.city === city)!
    const formatted = (value: number) =>
      value.toLocaleString("es-ES", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    await expect(page.locator(".city-historical-stats strong")).toHaveText([
      `${formatted(stats.temperature_mean_c)} °C`,
      `${formatted(stats.humidity_mean_pct)} %`,
    ])
    await expect(page.locator(".city-historical-period")).toHaveText(
      "Media histórica · 01/09/2026 – 30/09/2026"
    )
    await expect(page).toHaveURL("/")
    await expect(page.locator(".city-glass-card")).toHaveCSS(
      "backdrop-filter",
      "blur(24px) saturate(1.25)"
    )
    await expect(
      page.getByRole("button", { name: `Seleccionar ${city}`, exact: true })
    ).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("link", { name: "Acceder al dashboard" }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard\\?city=${city}$`))
    await expect(page.getByLabel(city, { exact: false }).first()).toBeChecked()
    await page
      .getByRole("link", { name: "Volver al mapa", exact: true })
      .click()
    await expect(page.locator(".city-map-marker")).toHaveCount(5)
  }
  expect(calls).toBe(0)
})

test("la extracción en curso y la selección sobreviven al retorno al mapa", async ({
  page,
}) => {
  await mockMap(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/extract?*", async (route) => {
    await held
    await route.fulfill({
      json: {
        utc_offset_seconds: 0,
        hourly: {
          time: ["2026-09-01T00:00"],
          temperature_2m: [20],
          relative_humidity_2m: [50],
          precipitation: [0],
        },
      },
    })
  })
  await page.goto("/dashboard?city=Madrid")
  await page.getByLabel("Fecha final", { exact: true }).fill("2026-09-01")
  const extraction = page.waitForRequest("**/api/extract?*")
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await extraction
  await page.getByRole("link", { name: "Volver al mapa", exact: true }).click()
  release()
  await page
    .getByRole("button", { name: "Seleccionar Madrid", exact: true })
    .click()
  await page.getByRole("link", { name: "Acceder al dashboard" }).click()
  await page
    .getByRole("navigation", { name: "Etapas del dashboard" })
    .getByRole("button")
    .nth(1)
    .click()
  await expect(
    page.getByRole("button", {
      name: "Seleccionar todos los filtrados (1)",
      exact: true,
    })
  ).toBeVisible()
  await page
    .getByRole("button", {
      name: "Seleccionar todos los filtrados (1)",
      exact: true,
    })
    .click()
  await page.getByRole("link", { name: "Volver al mapa", exact: true }).click()
  await page
    .getByRole("button", { name: "Seleccionar Madrid", exact: true })
    .click()
  await expect(page.getByText("25,3 °C", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Acceder al dashboard" }).click()
  await page
    .getByRole("navigation", { name: "Etapas del dashboard" })
    .getByRole("button")
    .nth(3)
    .click()
  await expect(
    page.getByRole("button", {
      name: "Subir 1 registros a Supabase",
      exact: true,
    })
  ).toBeEnabled()
  await page
    .getByRole("navigation", { name: "Etapas del dashboard" })
    .getByRole("button")
    .nth(0)
    .click()
  await expect(page.getByLabel("Fecha final", { exact: true })).toHaveValue(
    "2026-09-01"
  )
})

test("error, reintento y alternativa de ciudades sin mapa", async ({
  page,
}) => {
  let fail = true
  await page.route("https://api.maptiler.com/maps/**", (route) =>
    fail
      ? route.fulfill({ status: 403, json: {} })
      : route.fulfill({ json: style })
  )
  await page.goto("/")
  await expect(page.locator(".map-alternative [role=alert]")).toBeVisible()
  await expect(page.locator(".fallback-cities button")).toHaveCount(5)
  await page.getByRole("button", { name: "Bilbao", exact: true }).click()
  await expect(
    page.getByRole("complementary", { name: "Información de Bilbao" })
  ).toBeVisible()
  fail = false
  await page.getByRole("button", { name: "Reintentar", exact: true }).click()
  await expect(page.locator(".map-state-ready")).toBeVisible()
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1)
})

test("timeout total de 15 segundos permite acceder sin mapa", async ({
  page,
}) => {
  await page.route("https://api.maptiler.com/maps/**", () => {})
  await page.goto("/")
  await expect(page.locator(".map-alternative [role=alert]")).toContainText(
    "15 segundos",
    {
      timeout: 18000,
    }
  )
  await page.getByRole("button", { name: "Valencia", exact: true }).click()
  await page.getByRole("link", { name: "Acceder al dashboard" }).click()
  await expect(page).toHaveURL(/dashboard\?city=Valencia$/)
  await expect(
    page.getByLabel("Valencia", { exact: false }).first()
  ).toBeChecked()
})
