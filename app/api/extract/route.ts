import { CITIES, period } from "@/lib/etl/core"
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams
    const city = CITIES.find((c) => c.name === p.get("city"))
    if (!city)
      return Response.json(
        { error: "Selecciona una ciudad válida." },
        { status: 400 }
      )
    const start = p.get("start") ?? "",
      end = p.get("end") ?? ""
    period(start, end)
    const query = new URLSearchParams({
      latitude: String(city.latitude),
      longitude: String(city.longitude),
      start_date: start,
      end_date: end,
      hourly: "temperature_2m,relative_humidity_2m,precipitation",
      timezone: "UTC",
      temperature_unit: "celsius",
      precipitation_unit: "mm",
    })
    const response = await fetch(
      `https://archive-api.open-meteo.com/v1/archive?${query}`,
      { cache: "no-store", signal: AbortSignal.timeout(45000) }
    )
    if (!response.ok)
      throw new Error(
        `Open-Meteo respondió ${response.status}. Revisa las fechas o reintenta.`
      )
    return Response.json(await response.json())
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo extraer." },
      { status: 400 }
    )
  }
}
