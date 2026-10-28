import { test, expect } from "@playwright/test"
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

test("pines: hover, selección única, teclado y cierre sin reiniciar el mapa", async ({
  page,
}) => {
  let styles = 0
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("https://api.maptiler.com/maps/**", (route) => {
    styles++
    return route.fulfill({ json: style })
  })
  await page.goto("/")
  await expect(page.locator(".map-state-ready")).toBeVisible()
  const initialStyles = styles
  await expect(page.locator(".city-map-marker svg")).toHaveCount(5)
  await expect(page.locator(".city-map-marker span")).toHaveCount(0)
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  const barcelona = page.getByRole("button", {
    name: "Seleccionar Barcelona",
    exact: true,
  })
  await barcelona.hover()
  await expect(page.getByRole("tooltip")).toHaveText("Barcelona")
  await expect(barcelona).toHaveAttribute("aria-pressed", "false")
  await page.mouse.move(10, 100)
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await barcelona.click()
  await page.mouse.move(10, 100)
  await expect(page.getByRole("tooltip")).toContainText("Barcelona")
  await expect(barcelona).toHaveAttribute(
    "aria-describedby",
    "city-marker-popup"
  )
  const madrid = page.getByRole("button", {
    name: "Seleccionar Madrid",
    exact: true,
  })
  await madrid.click()
  await expect(page.getByRole("tooltip")).toContainText("Madrid")
  await expect(
    page.locator('.city-map-marker[aria-pressed="true"]')
  ).toHaveCount(1)
  await expect(barcelona).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await expect(
    page.locator('.city-map-marker[aria-pressed="true"]')
  ).toHaveCount(0)
  const bilbao = page.getByRole("button", {
    name: "Seleccionar Bilbao",
    exact: true,
  })
  await bilbao.focus()
  await expect(page.getByRole("tooltip")).toHaveText("Bilbao")
  await page.keyboard.press("Enter")
  await expect(bilbao).toHaveAttribute("aria-pressed", "true")
  const link = page.getByRole("link", { name: "Acceder al dashboard" })
  await expect(link).toHaveAttribute("href", "/dashboard?city=Bilbao")
  await page.mouse.click(10, 100)
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  expect(styles).toBe(initialStyles)
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1)
  expect(errors).toEqual([])
})

test.describe("pines táctiles", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  test("tap, cambio de ciudad, encuadre responsive y cierre", async ({
    page,
  }) => {
    await page.route("https://api.maptiler.com/maps/**", (route) =>
      route.fulfill({ json: style })
    )
    await page.goto("/")
    await expect(page.locator(".map-state-ready")).toBeVisible()
    await expect(page.locator("header")).toHaveCount(0)
    expect(await page.locator(".spain-map-hero").boundingBox()).toMatchObject({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    })
    for (const city of [
      "Barcelona",
      "Madrid",
      "Valencia",
      "Sevilla",
      "Bilbao",
    ]) {
      await page
        .getByRole("button", { name: `Seleccionar ${city}`, exact: true })
        .tap()
      await expect(page.getByRole("tooltip")).toContainText(city)
      await expect(
        page.getByRole("complementary", { name: `Información de ${city}` })
      ).toBeVisible()
      await expect(
        page.locator('.city-map-marker[aria-pressed="true"]')
      ).toHaveCount(1)
    }
    await page.setViewportSize({ width: 360, height: 740 })
    await page.waitForTimeout(200)
    const bounds = await page.getByRole("tooltip").boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740)
    await page.getByRole("link", { name: "Acceder al dashboard" }).tap()
    await expect(page).toHaveURL(/dashboard\?city=Bilbao$/)
    await expect(
      page.getByRole("checkbox", { name: /Bilbao/ }).first()
    ).toBeChecked()
  })
})
