import { test, expect } from "@playwright/test"
test("flujo real: 24 horas, selección y preview", async ({ page, request }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto("http://localhost:3000")
  await expect(page).toHaveTitle(/MeteoLab/)
  await page.screenshot({ path: "tests/desktop.png", fullPage: true })
  await page.getByLabel("Fecha final", { exact: true }).fill("2026-09-01")
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Seleccionar todas (24)", exact: true })
  ).toBeVisible({ timeout: 60000 })
  await page
    .getByRole("button", { name: "Seleccionar todas (24)", exact: true })
    .click()
  await page.getByRole("tab", { name: "Vista previa", exact: true }).click()
  await expect(page.locator("tbody tr")).toHaveCount(24)
  await expect(
    page.getByRole("button", {
      name: "Subir 24 registros a Supabase",
      exact: true,
    })
  ).toBeEnabled()
  await page.getByLabel("Solo registros con lluvia").check()
  await expect(
    page.getByText(/seleccionadas fuera de los filtros/)
  ).toBeVisible()
  await page
    .getByRole("tab", { name: "Datos en Supabase", exact: true })
    .click()
  const destinationResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/measurements?") && r.request().method() === "GET"
  )
  await page.getByRole("button", { name: "Actualizar", exact: true }).click()
  const destination = await destinationResponse
  const destinationBody = await destination.json()
  if (destination.ok())
    await expect(page.getByText(/registros persistidos · página/)).toBeVisible()
  else
    await expect(page.locator("p[role=alert]")).toHaveText(
      destinationBody.error
    )
  const invalid = await request.post("http://localhost:3000/api/measurements", {
    data: [{ ciudad: "X" }],
  })
  expect(invalid.status()).toBe(400)
  expect(errors).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: "tests/mobile.png", fullPage: true })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
})
test("fixtures aislados: selección entre páginas, fallo parcial, snapshot y reintento", async ({
  page,
}) => {
  const hours = 720
  const times = Array.from({ length: hours }, (_, i) =>
    new Date(Date.UTC(2026, 8, 1, i)).toISOString().slice(0, 16)
  )
  await page.route("**/api/extract?*", (r) =>
    r.fulfill({
      json: {
        utc_offset_seconds: 0,
        hourly: {
          time: times,
          temperature_2m: Array(hours).fill(20),
          relative_humidity_2m: Array(hours).fill(50),
          precipitation: Array(hours).fill(1),
        },
      },
    })
  )
  const payloads: unknown[][] = []
  let call = 0
  await page.route("**/api/measurements", async (r) => {
    if (r.request().method() !== "POST") return r.continue()
    const rows = r.request().postDataJSON()
    payloads.push(rows)
    call++
    await new Promise((resolve) => setTimeout(resolve, 100))
    await r.fulfill(
      call === 2
        ? { status: 503, json: { error: "Fallo controlado del lote" } }
        : { json: { processed: rows.length, verified: rows.length } }
    )
  })
  await page.goto("http://localhost:3000")
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Seleccionar todas (720)", exact: true })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Seleccionar todas (720)", exact: true })
    .click()
  await page.getByRole("button", { name: "Siguiente", exact: true }).click()
  await expect(page.locator("tbody input:checked")).toHaveCount(25)
  await page.getByRole("tab", { name: "Vista previa", exact: true }).click()
  const firstDate = await page
    .locator("tbody tr")
    .first()
    .locator("td")
    .nth(1)
    .textContent()
  await page
    .getByRole("button", {
      name: "Subir 720 registros a Supabase",
      exact: true,
    })
    .click()
  await page.getByLabel("Temperatura °C mínima").fill("100")
  await expect(page.getByText(/Procesadas y verificadas: 500/)).toBeVisible()
  expect(payloads.map((p) => p.length)).toEqual([500, 220])
  expect((payloads[0][0] as { fecha_hora: string }).fecha_hora).toBe(firstDate)
  await page
    .getByRole("button", {
      name: "Reintentar solo lotes fallidos",
      exact: true,
    })
    .click()
  await expect(page.getByText(/Procesadas y verificadas: 720/)).toBeVisible()
  expect(payloads.map((p) => p.length)).toEqual([500, 220, 220])
  expect(payloads[1]).toEqual(payloads[2])
})

test("reintento de una ciudad conserva el periodo original y no duplica", async ({
  page,
}) => {
  const calls: URL[] = []
  let madrid = 0
  await page.route("**/api/extract?*", async (r) => {
    const url = new URL(r.request().url())
    calls.push(url)
    if (url.searchParams.get("city") === "Madrid" && madrid++ === 0)
      return r.fulfill({
        status: 502,
        json: { error: "Fallo controlado de Madrid" },
      })
    return r.fulfill({
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
  await page.goto("http://localhost:3000")
  await page.getByLabel("Madrid", { exact: false }).first().check()
  await page.getByRole("button", { name: "Extraer datos", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Reintentar Madrid", exact: true })
  ).toBeEnabled()
  await page.getByLabel("Fecha final", { exact: true }).fill("2026-09-15")
  await page
    .getByRole("button", { name: "Reintentar Madrid", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Seleccionar todas (2)", exact: true })
  ).toBeVisible()
  expect(calls.map((c) => c.searchParams.get("city"))).toEqual([
    "Barcelona",
    "Madrid",
    "Madrid",
  ])
  expect(calls[2].searchParams.get("end")).toBe("2026-09-30")
})
