import assert from "node:assert/strict"
import { test } from "node:test"
import "./setup.mjs"
const measurements = await import("../app/api/measurements/route.ts")

test("producción sin login: habilitación explícita, origen, límites, upsert y persistencia", async () => {
  const originalEnv = { ...process.env }
  const originalFetch = globalThis.fetch
  Object.assign(process.env, {
    NODE_ENV: "production",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test-private",
  })
  delete process.env.APP_ORIGIN
  delete process.env.ETL_PERMITIR_EN_PRODUCCION
  const origin = "https://meteolab.example"
  const row = {
    ciudad: "Barcelona",
    fecha_hora: "2026-09-01T00:00:00.000Z",
    temperatura_c: 20,
    humedad_pct: 50,
    precipitacion_mm: 0,
  }
  let calls = 0
  let fail = false
  let persisted = true
  globalThis.fetch = async (input, init) => {
    calls++
    assert.match(
      String(input),
      /^https:\/\/example.supabase.co\/rest\/v1\/mediciones_meteorologicas\?/
    )
    assert.equal(
      new Headers(init?.headers).get("apikey"),
      "sb_secret_test-private"
    )
    assert.equal(new Headers(init?.headers).get("authorization"), null)
    if (fail)
      return Response.json(
        { code: "42501", message: "Denied sb_secret_test-private" },
        { status: 403 }
      )
    if (init?.method === "POST") {
      assert.match(String(input), /on_conflict=ciudad%2Cfecha_hora/)
      assert.equal(
        new Headers(init.headers).get("Prefer"),
        "resolution=merge-duplicates,return=minimal"
      )
      assert.deepEqual(JSON.parse(String(init.body)), [row])
      return new Response(null, { status: 201 })
    }
    return Response.json(persisted ? [row] : [], {
      headers: { "content-range": "0-0/1" },
    })
  }
  function request(
    method = "GET",
    body?: unknown,
    source: string | null = origin
  ) {
    return new Request(`${origin}/api/measurements`, {
      method,
      headers: {
        ...(source ? { origin: source } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  try {
    for (const value of [undefined, "false", "TRUE", "1"]) {
      if (value === undefined) delete process.env.ETL_PERMITIR_EN_PRODUCCION
      else process.env.ETL_PERMITIR_EN_PRODUCCION = value
      assert.equal((await measurements.GET(request())).status, 403)
      assert.equal(
        (await measurements.POST(request("POST", [row]))).status,
        403
      )
    }
    assert.equal(calls, 0)
    process.env.ETL_PERMITIR_EN_PRODUCCION = "true"
    assert.equal(
      (await measurements.POST(request("POST", [row], null))).status,
      403
    )
    assert.equal(
      (
        await measurements.POST(
          request("POST", [row], "https://attacker.example")
        )
      ).status,
      403
    )
    assert.equal(
      (
        await measurements.GET(
          request("GET", undefined, "https://attacker.example")
        )
      ).status,
      403
    )
    const crossSite = request("POST", [row])
    crossSite.headers.set("sec-fetch-site", "cross-site")
    assert.equal((await measurements.POST(crossSite)).status, 403)
    process.env.APP_ORIGIN = "https://canonical.example"
    assert.equal((await measurements.POST(request("POST", [row]))).status, 403)
    delete process.env.APP_ORIGIN
    assert.equal(
      (await measurements.POST(request("POST", [{ ciudad: "X" }]))).status,
      400
    )
    assert.equal(
      (await measurements.POST(request("POST", Array(501).fill(row)))).status,
      400
    )
    assert.equal(
      (await measurements.POST(request("POST", "x".repeat(180001)))).status,
      400
    )
    assert.equal(calls, 0)
    for (let i = 0; i < 2; i++) {
      const written = await measurements.POST(request("POST", [row]))
      assert.equal(written.status, 200)
      assert.equal(written.headers.get("set-cookie"), null)
      assert.deepEqual(await written.json(), { processed: 1, verified: 1 })
    }
    const read = await measurements.GET(request("GET", undefined, null))
    assert.equal(read.status, 200)
    assert.equal(read.headers.get("set-cookie"), null)
    assert.deepEqual(await read.json(), { rows: [row], total: 1 })
    persisted = false
    const unverified = await measurements.POST(request("POST", [row]))
    assert.equal(unverified.status, 400)
    assert.match((await unverified.json()).error, /no se verificaron/)
    persisted = true
    const originalError = console.error
    let log = ""
    console.error = (...values) => {
      log = JSON.stringify(values)
    }
    fail = true
    try {
      const failure = await measurements.GET(request())
      assert.equal(failure.status, 502)
      assert.ok(!(await failure.text()).includes("sb_secret"))
      assert.match(log, /42501/)
      assert.ok(!log.includes("sb_secret_test-private"))
    } finally {
      console.error = originalError
    }
    fail = false
    Object.assign(process.env, { NODE_ENV: "development" })
    delete process.env.ETL_PERMITIR_EN_PRODUCCION
    process.env.APP_ORIGIN = origin
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      assert.equal(
        (
          await measurements.GET(
            new Request(`http://${host}:3000/api/measurements`)
          )
        ).status,
        200
      )
      const localWrite = await measurements.POST(
        new Request(`http://${host}:3000/api/measurements`, {
          method: "POST",
          body: JSON.stringify([row]),
        })
      )
      assert.equal(localWrite.status, 200)
    }
    assert.equal((await measurements.GET(request())).status, 403)
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key]
    Object.assign(process.env, originalEnv)
  }
})
