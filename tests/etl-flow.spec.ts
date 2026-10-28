import { test, expect, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
async function step(page: Page, index: number) {
  await page
    .getByRole("navigation", { name: "Etapas del dashboard" })
    .getByRole("button")
    .nth(index)
    .click()
}
const response = (temperature: number | null = 20, audit = "") => ({
  utc_offset_seconds: 0,
  hourly: {
    time: ["2026-09-01T00:00"],
    temperature_2m: [temperature],
    relative_humidity_2m: [50],
    precipitation: [1],
  },
  audit,
})

test("A/B/C: avance automático, ciudades extraídas y reemplazo confirmado sin acumulación", async ({
  page,
}) => {
  const calls: string[] = []
  await page.route("**/api/extract?*", (route) => {
    calls.push(new URL(route.request().url()).searchParams.get("city")!)
    return route.fulfill({ json: response() })
  })
  await page.goto("/dashboard?city=Barcelona")
  await page
    .getByRole("checkbox", { name: /Madrid/ })
    .first()
    .check()
  await page.getByLabel("Fecha final", { exact: true }).fill("2026-09-01")
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Revisa y selecciona los datos" })
  ).toBeVisible()
  await expect(page.locator(".city-filters label")).toHaveText([
    "Barcelona",
    "Madrid",
  ])
  await expect(page.locator(".counters > div strong")).toHaveText([
    "2",
    "2",
    "0",
    "2",
    "0",
  ])
  await page
    .getByRole("button", {
      name: "Seleccionar todos los filtrados (2)",
      exact: true,
    })
    .click()
  await page.getByLabel("Solo registros con lluvia").check()
  await page
    .getByRole("button", { name: "Modificar extracción", exact: true })
    .click()
  await expect(page.getByLabel("Fecha final", { exact: true })).toHaveValue(
    "2026-09-01"
  )
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  expect(calls).toHaveLength(2)
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()
  await step(page, 1)
  await expect(page.getByLabel("Solo registros con lluvia")).toBeChecked()
  await expect(page.locator(".counters > div strong").last()).toHaveText("2")
  await page
    .getByRole("button", { name: "Modificar extracción", exact: true })
    .click()
  await page
    .getByRole("checkbox", { name: /Valencia/ })
    .first()
    .check()
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await page
    .getByRole("button", { name: "Confirmar nueva extracción", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Revisa y selecciona los datos" })
  ).toBeVisible()
  await expect(page.locator(".city-filters label")).toHaveText([
    "Barcelona",
    "Madrid",
    "Valencia",
  ])
  await expect(page.locator(".counters > div strong")).toHaveText([
    "3",
    "3",
    "0",
    "3",
    "0",
  ])
  await expect(page.getByLabel("Solo registros con lluvia")).not.toBeChecked()
  expect(calls).toHaveLength(5)
})

test("B/E/F: fallos parciales, ciudad sin válidos y descarga completa del JSON obtenido", async ({
  page,
}) => {
  await page.route("**/api/extract?*", (route) => {
    const city = new URL(route.request().url()).searchParams.get("city")
    return city === "Valencia"
      ? route.fulfill({
          status: 502,
          json: { error: "Fallo controlado de Valencia" },
        })
      : route.fulfill({
          json: response(city === "Madrid" ? null : 20, "x".repeat(20000)),
        })
  })
  await page.goto("/dashboard?city=Barcelona")
  await page
    .getByRole("checkbox", { name: /Madrid/ })
    .first()
    .check()
  await page
    .getByRole("checkbox", { name: /Valencia/ })
    .first()
    .check()
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Revisa y selecciona los datos" })
  ).toBeVisible()
  await expect(page.locator(".city-filters label")).toHaveText(["Barcelona"])
  await expect(page.locator(".dash-empty-city")).toContainText("Madrid")
  await expect(page.locator(".dash-empty-city")).toContainText(
    "No hay registros válidos"
  )
  await expect(
    page.getByRole("region", { name: "Ciudades con extracción fallida" })
  ).toContainText("Valencia")
  await expect(
    page.getByRole("button", { name: "Reintentar Valencia", exact: true })
  ).toBeEnabled()
  await step(page, 2)
  await page
    .getByRole("tab", { name: "JSON original de Open-Meteo", exact: true })
    .click()
  await expect(
    page.getByLabel("JSON de la ciudad").locator("option")
  ).toHaveText(["Barcelona", "Madrid"])
  await page.getByLabel("JSON de la ciudad").selectOption("Madrid")
  expect((await page.locator("pre").textContent())!.length).toBeLessThanOrEqual(
    16000
  )
  const event = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Descargar JSON original", exact: true })
    .click()
  const download = await event
  expect(download.suggestedFilename()).toBe("Madrid-original.json")
  const json = JSON.parse(await readFile((await download.path())!, "utf8"))
  expect(json.audit).toHaveLength(20000)
})

test("F: todos los fallos permanecen en extracción y el reintento actualiza las opciones", async ({
  page,
}) => {
  let recover = false
  await page.route("**/api/extract?*", (route) => {
    const city = new URL(route.request().url()).searchParams.get("city")
    return recover && city === "Madrid"
      ? route.fulfill({ json: response() })
      : route.fulfill({
          status: 502,
          json: { error: "Servicio no disponible" },
        })
  })
  await page.goto("/dashboard?city=Barcelona")
  await page
    .getByRole("checkbox", { name: /Madrid/ })
    .first()
    .check()
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Reintentar Madrid", exact: true })
  ).toBeEnabled()
  await expect(
    page.getByRole("heading", { name: "Configura tu extracción" })
  ).toBeVisible()
  await step(page, 2)
  await page
    .getByRole("tab", { name: "JSON original de Open-Meteo", exact: true })
    .click()
  await expect(page.getByLabel("JSON de la ciudad")).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Descargar JSON original", exact: true })
  ).toBeDisabled()
  await step(page, 0)
  recover = true
  await page
    .getByRole("button", { name: "Reintentar Madrid", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Revisa y selecciona los datos" })
  ).toBeVisible()
  await expect(page.locator(".city-filters label")).toHaveText(["Madrid"])
  await step(page, 2)
  await page
    .getByRole("tab", { name: "JSON original de Open-Meteo", exact: true })
    .click()
  await expect(
    page.getByLabel("JSON de la ciudad").locator("option")
  ).toHaveText(["Madrid"])
  await expect(page.getByLabel("JSON de la ciudad")).toHaveValue("Madrid")
})

test("G: histórico de Supabase independiente, sin selección local no permite cargar", async ({
  page,
}) => {
  let posts = 0
  await page.route("**/api/measurements*", (route) => {
    if (route.request().method() === "POST") posts++
    return route.fulfill({
      json: {
        rows: [
          {
            ciudad: "Sevilla",
            fecha_hora: "2026-08-01T00:00:00.000Z",
            temperatura_c: 31,
            humedad_pct: 50,
            precipitacion_mm: 0,
          },
        ],
        total: 1,
      },
    })
  })
  await page.goto("/dashboard?city=Barcelona")
  await step(page, 3)
  await expect(
    page.getByRole("button", {
      name: "Subir 0 registros a Supabase",
      exact: true,
    })
  ).toBeDisabled()
  await expect(
    page
      .getByText("Selecciona registros antes de continuar con la carga.")
      .first()
  ).toBeVisible()
  await page
    .getByRole("tab", { name: "Datos en Supabase", exact: true })
    .click()
  await expect(
    page
      .getByRole("combobox", { name: "Ciudad", exact: true })
      .locator("option")
  ).toHaveCount(6)
  await page
    .getByRole("combobox", { name: "Ciudad", exact: true })
    .selectOption("Sevilla")
  await page.getByRole("button", { name: "Actualizar", exact: true }).click()
  await expect(page.locator("tbody tr")).toContainText("Sevilla")
  await expect(page.locator(".destination-banner")).toContainText(
    "destino real"
  )
  await step(page, 1)
  await expect(page.locator(".city-filters input")).toHaveCount(0)
  expect(posts).toBe(0)
})
