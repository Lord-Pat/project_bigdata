import { test, expect, type Page } from "@playwright/test"
async function step(page: Page, index: number) {
  await page
    .getByRole("navigation", { name: "Etapas del dashboard" })
    .getByRole("button")
    .nth(index)
    .click()
}

test("cuatro etapas sin datos de demostración ni extracciones automáticas", async ({
  page,
}) => {
  let requests = 0
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests++
  })
  await page.goto("/dashboard?city=Valencia")
  await expect(
    page.getByRole("checkbox", { name: /Valencia/ }).first()
  ).toBeChecked()
  await expect(
    page
      .getByRole("navigation", { name: "Etapas del dashboard" })
      .getByRole("button")
  ).toHaveCount(4)
  await expect(page.locator(".dash-sidebar")).toHaveCount(0)
  for (const index of [1, 2, 3, 0]) await step(page, index)
  await step(page, 1)
  await expect(page.locator(".counters > div strong")).toHaveText([
    "0",
    "0",
    "0",
    "0",
    "0",
  ])
  expect(requests).toBe(0)
  await expect(
    page.getByText("MODO DEMOSTRACIÓN", { exact: false })
  ).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const index of [0, 1, 2, 3]) {
    await step(page, index)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
})

test("datos reales del estado: calidad, filtros, JSON, selección y carga entre etapas", async ({
  page,
}) => {
  let extracts = 0
  const sent: unknown[][] = []
  await page.route("**/api/extract?*", (route) => {
    extracts++
    return route.fulfill({
      json: {
        utc_offset_seconds: 0,
        hourly: {
          time: [
            "2026-09-01T00:00",
            "2026-09-01T01:00",
            "2026-09-01T02:00",
            "2026-09-01T00:00",
          ],
          temperature_2m: [20, 21, null, 20],
          relative_humidity_2m: [50, 60, 70, 50],
          precipitation: [0, 1, 0, 0],
        },
      },
    })
  })
  await page.route("**/api/measurements*", (route) => {
    if (route.request().method() === "POST") {
      const rows = route.request().postDataJSON()
      sent.push(rows)
      return route.fulfill({
        json: { processed: rows.length, verified: rows.length },
      })
    }
    return route.fulfill({
      json: { rows: sent.flat(), total: sent.flat().length },
    })
  })
  await page.goto("/dashboard?city=Madrid")
  await page.getByLabel("Fecha final", { exact: true }).fill("2026-09-01")
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await step(page, 1)
  await expect(page.locator(".counters > div strong")).toHaveText([
    "4",
    "2",
    "2",
    "2",
    "0",
  ])
  await page.getByRole("tab", { name: "Rechazados", exact: true }).click()
  await expect(page.locator("tbody tr")).toHaveCount(2)
  await page.getByRole("tab", { name: "Válidos", exact: true }).click()
  await page
    .getByRole("button", {
      name: "Seleccionar todos los filtrados (2)",
      exact: true,
    })
    .click()
  await page.getByLabel("Solo registros con lluvia").check()
  await expect(page.locator(".counters > div strong")).toHaveText([
    "4",
    "2",
    "2",
    "1",
    "1",
  ])
  await page.getByRole("button", { name: "Revisar datos" }).click()
  await expect(
    page.getByRole("tab", {
      name: "JSON seleccionado para Supabase",
      exact: true,
    })
  ).toHaveAttribute("aria-selected", "true")
  await expect(page.locator("pre")).toContainText('"ciudad": "Madrid"')
  await page
    .getByRole("tab", { name: "JSON original de Open-Meteo", exact: true })
    .click()
  await expect(page.locator("pre")).toContainText('"temperature_2m"')
  const download = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Descargar JSON original", exact: true })
    .click()
  expect((await download).suggestedFilename()).toBe("Madrid-original.json")
  await page.getByRole("tab", { name: "Transformados", exact: true }).click()
  await expect(page.locator("tbody tr")).toHaveCount(4)
  await page.getByRole("tab", { name: "Vista previa", exact: true }).click()
  await expect(page.locator("tbody tr")).toHaveCount(1)
  await step(page, 1)
  await expect(page.getByLabel("Solo registros con lluvia")).toBeChecked()
  await page.getByRole("button", { name: "Revisar datos" }).click()
  await page.getByRole("button", { name: "Ir a Supabase" }).click()
  expect(sent).toHaveLength(0)
  await expect(
    page.getByRole("button", { name: /Subir 1 registros a Supabase/ })
  ).toHaveCount(1)
  await page
    .getByRole("button", { name: "Subir 1 registros a Supabase", exact: true })
    .click()
  await expect(page.getByText(/Procesadas y verificadas: 1/)).toBeVisible()
  expect(sent).toHaveLength(1)
  expect(sent[0]).toHaveLength(1)
  expect((sent[0][0] as { ciudad: string }).ciudad).toBe("Madrid")
  await page
    .getByRole("tab", { name: "Datos en Supabase", exact: true })
    .click()
  await page.getByRole("button", { name: "Actualizar", exact: true }).click()
  await expect(page.getByText(/1 registros persistidos/)).toBeVisible()
  await step(page, 0)
  await expect(page.getByLabel("Fecha final", { exact: true })).toHaveValue(
    "2026-09-01"
  )
  expect(extracts).toBe(1)
})

test("una extracción finalizada avanza a exploración aunque se visite otra etapa", async ({
  page,
}) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/extract?*", async (route) => {
    await pending
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
  const request = page.waitForRequest("**/api/extract?*")
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await request
  await step(page, 2)
  release()
  await expect(
    page.getByRole("heading", { name: "Revisa y selecciona los datos" })
  ).toBeVisible()
  await expect(
    page.getByRole("tab", { name: "Válidos", exact: true })
  ).toHaveAttribute("aria-selected", "true")
})
