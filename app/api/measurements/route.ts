import { clean, fields, keyOf, type Candidate, type Row } from "@/lib/etl/core"
import { apiError, database, localGuard } from "@/lib/etl/server"
export async function POST(request: Request) {
  try {
    localGuard(request)
    if (Number(request.headers.get("content-length")) > 180000)
      throw new Error("Petición demasiado grande (máximo 180 KB).")
    const reader = request.body?.getReader()
    if (!reader) throw new Error("Petición vacía.")
    let size = 0
    const parts: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 180000) {
        await reader.cancel()
        throw new Error("Petición demasiado grande (máximo 180 KB).")
      }
      parts.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const part of parts) {
      bytes.set(part, offset)
      offset += part.length
    }
    const body = JSON.parse(new TextDecoder().decode(bytes))
    if (
      !Array.isArray(body) ||
      !body.length ||
      body.length > 500 ||
      body.some(
        (r) => !r || typeof r !== "object" || fields.some((f) => !(f in r))
      )
    )
      throw new Error("Envía entre 1 y 500 registros completos.")
    const { valid, rejected } = clean(body as Candidate[])
    if (rejected.length)
      throw new Error(`Lote inválido: ${rejected[0].reason}.`)
    const rows = valid.map((r) =>
      Object.fromEntries(fields.map((f) => [f, r[f]]))
    )
    await database(new URLSearchParams({ on_conflict: "ciudad,fecha_hora" }), {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    })
    const found = new Set<string>()
    // Small verification queries keep URLs bounded even for 500 unrelated keys.
    for (let i = 0; i < valid.length; i += 40) {
      const group = valid.slice(i, i + 40)
      const or = group
        .map(
          (r) =>
            `and(ciudad.eq.${JSON.stringify(r.ciudad)},fecha_hora.eq.${r.fecha_hora})`
        )
        .join(",")
      const response = await database(
        new URLSearchParams({
          select: "ciudad,fecha_hora",
          or: `(${or})`,
          limit: "40",
        })
      )
      const persisted = (await response.json()) as Row[]
      for (const row of persisted)
        found.add(
          keyOf({ ...row, fecha_hora: new Date(row.fecha_hora).toISOString() })
        )
    }
    if (valid.some((r) => !found.has(keyOf(r))))
      throw new Error(
        "La escritura terminó, pero no se verificaron todas las claves. Reintenta el lote: el upsert evita duplicados."
      )
    return Response.json(
      { processed: valid.length, verified: valid.length },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return apiError(error)
  }
}
export async function GET(request: Request) {
  try {
    localGuard(request)
    const p = new URL(request.url).searchParams
    const page = Math.max(1, Math.min(100000, Number(p.get("page")) || 1))
    const sort = fields.includes(p.get("sort") as (typeof fields)[number])
      ? p.get("sort")!
      : "fecha_hora"
    const q = new URLSearchParams({
      select: "*",
      order: `${sort}.${p.get("desc") === "true" ? "desc" : "asc"},id.asc`,
      limit: "25",
      offset: String((Math.floor(page) - 1) * 25),
    })
    if (p.get("city")) q.set("ciudad", `eq.${p.get("city")}`)
    for (const [param, op] of [
      ["from", "gte"],
      ["to", "lte"],
    ])
      if (p.get(param)) {
        const date = p.get(param)!
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date))
        )
          throw new Error("Filtro de fecha inválido.")
        q.append(
          "fecha_hora",
          `${op}.${date}T${op === "gte" ? "00:00:00" : "23:59:59.999"}Z`
        )
      }
    const response = await database(q, { headers: { Prefer: "count=exact" } })
    return Response.json(
      {
        rows: await response.json(),
        total: Number(
          response.headers.get("content-range")?.split("/")[1] || 0
        ),
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return apiError(error)
  }
}
