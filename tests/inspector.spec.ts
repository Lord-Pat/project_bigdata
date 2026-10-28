import { test, expect, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"

const stages = (page: Page) =>
  page
    .getByRole("navigation", { name: "Etapas del dashboard" })
    .getByRole("button")
async function prepared(page: Page) {
  return JSON.parse(
    (await page
      .locator('pre[aria-label="JSON seleccionado para Supabase"]')
      .textContent())!
  )
}
async function extract(page: Page) {
  await page.route("**/api/extract?*", (route) =>
    route.fulfill({
      json: {
        utc_offset_seconds: 0,
        hourly: {
          time: Array.from({ length: 300 }, (_, i) =>
            new Date(Date.UTC(2026, 8, 1, i)).toISOString().slice(0, 16)
          ),
          temperature_2m: Array(300).fill(20),
          relative_humidity_2m: Array(300).fill(50),
          precipitation: Array.from({ length: 300 }, (_, i) => i % 2),
        },
      },
    })
  )
  await page.goto("/dashboard?city=Barcelona")
  await page.getByRole("checkbox", { name: /Madrid/ }).check()
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await expect(stages(page).nth(0)).toHaveAttribute("data-completed", "true")
  await page
    .getByRole("button", {
      name: "Seleccionar todos los filtrados (600)",
      exact: true,
    })
    .click()
}

test("JSON completo de varias ciudades, descarga, filtros y revisión invalidada", async ({
  page,
  context,
}) => {
  let requests = 0
  const sent: unknown[][] = []
  page.on("request", (request) => {
    if (request.url().includes("/api/extract?")) requests++
  })
  await page.route("**/api/measurements", (route) => {
    const rows = route.request().postDataJSON()
    sent.push(rows)
    return route.fulfill({
      json: { processed: rows.length, verified: rows.length },
    })
  })
  await extract(page)
  await expect(stages(page).nth(1)).toHaveAttribute("data-completed", "false")
  await page.getByRole("button", { name: "Revisar datos", exact: true }).click()
  await expect(stages(page).nth(1)).toHaveAttribute("data-completed", "true")
  const initial = await prepared(page)
  expect(initial).toHaveLength(600)
  expect([
    ...new Set(initial.map((row: { ciudad: string }) => row.ciudad)),
  ]).toEqual(["Barcelona", "Madrid"])
  expect(Object.keys(initial[0])).toEqual([
    "ciudad",
    "fecha_hora",
    "temperatura_c",
    "humedad_pct",
    "precipitacion_mm",
  ])
  const event = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Descargar JSON seleccionado", exact: true })
    .click()
  const download = await event
  expect(download.suggestedFilename()).toBe(
    "meteolab-registros-seleccionados.json"
  )
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(
    initial
  )
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page
    .getByRole("button", { name: "Copiar JSON seleccionado", exact: true })
    .click()
  expect(
    JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
  ).toEqual(initial)
  await stages(page).nth(3).click()
  await expect(stages(page).nth(2)).toHaveAttribute("data-completed", "false")
  await stages(page).nth(2).click()
  await page.getByRole("button", { name: "Ir a Supabase", exact: true }).click()
  await expect(stages(page).nth(2)).toHaveAttribute("data-completed", "true")
  expect(sent).toHaveLength(0)
  await stages(page).nth(1).click()
  await page.getByLabel("Solo registros con lluvia").check()
  await expect(stages(page).nth(2)).toHaveAttribute("data-completed", "false")
  await page.getByRole("button", { name: "Revisar datos", exact: true }).click()
  const filtered = await prepared(page)
  expect(filtered).toHaveLength(300)
  expect(
    filtered.every(
      (row: { precipitacion_mm: number }) => row.precipitacion_mm > 0
    )
  ).toBe(true)
  await page.getByRole("button", { name: "Ir a Supabase", exact: true }).click()
  await page
    .getByRole("button", {
      name: "Subir 300 registros a Supabase",
      exact: true,
    })
    .click()
  await expect(stages(page).nth(3)).toHaveAttribute("data-completed", "true")
  expect(sent.flat()).toEqual(filtered)
  expect(requests).toBe(2)
  await stages(page).nth(0).click()
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await page
    .getByRole("button", { name: "Confirmar nueva extracción", exact: true })
    .click()
  for (const i of [1, 2, 3])
    await expect(stages(page).nth(i)).toHaveAttribute("data-completed", "false")
})

test("check de carga solo tras verificar todos los lotes y snapshot independiente", async ({
  page,
}) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const sent: unknown[][] = []
  await page.route("**/api/measurements", async (route) => {
    const rows = route.request().postDataJSON()
    sent.push(rows)
    calls++
    if (calls === 1) await pending
    await route.fulfill(
      calls === 2
        ? { json: { verified: 0 } }
        : { json: { verified: rows.length } }
    )
  })
  await extract(page)
  await page.getByRole("button", { name: "Revisar datos", exact: true }).click()
  const original = await prepared(page)
  await page.getByRole("button", { name: "Ir a Supabase", exact: true }).click()
  const request = page.waitForRequest("**/api/measurements")
  await page
    .getByRole("button", {
      name: "Subir 600 registros a Supabase",
      exact: true,
    })
    .click()
  await request
  await expect(stages(page).nth(3)).toHaveAttribute("data-completed", "false")
  release()
  await expect(stages(page).nth(3)).toHaveAttribute("data-error", "true")
  await expect(stages(page).nth(3)).toHaveAttribute("data-completed", "false")
  await stages(page).nth(1).click()
  await page
    .getByRole("button", { name: "Vaciar selección", exact: true })
    .click()
  await stages(page).nth(2).click()
  await expect(
    page.getByText("No has seleccionado registros para exportar.", {
      exact: true,
    })
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: "Descargar JSON seleccionado",
      exact: true,
    })
  ).toBeDisabled()
  await page
    .getByRole("tab", { name: "JSON de la última carga", exact: true })
    .click()
  expect(
    JSON.parse(
      (await page
        .locator('pre[aria-label="JSON de la última carga"]')
        .textContent())!
    )
  ).toEqual(original)
  await stages(page).nth(3).click()
  await page
    .getByRole("button", {
      name: "Reintentar solo lotes fallidos",
      exact: true,
    })
    .click()
  await expect(stages(page).nth(3)).toHaveAttribute("data-completed", "true")
  expect(sent.slice(0, 2).flat()).toEqual(original)
  expect(sent[2]).toEqual(sent[1])
  await stages(page).nth(2).click()
  await page
    .getByRole("tab", { name: "JSON original de Open-Meteo", exact: true })
    .click()
  await expect(
    page.getByLabel("JSON de la ciudad").locator("option")
  ).toHaveText(["Barcelona", "Madrid"])
})
