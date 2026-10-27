import assert from "node:assert/strict"
import { test } from "node:test"
import "./setup.mjs"
const measurements = await import("../app/api/measurements/route.ts")
const session = await import("../app/api/admin/session/route.ts")
const { sessionCookie } = await import("../lib/etl/auth.ts")

test("producción: autorización, origen, validación, upsert y verificación", async () => {
  const originalEnv = { ...process.env }
  const originalFetch = globalThis.fetch
  Object.assign(process.env, {
    NODE_ENV: "production",
    ADMIN_PASSWORD: "test-admin-password-very-long",
    ADMIN_SESSION_SECRET: "test-session-secret-independent-123456789",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test-private",
  })
  delete process.env.APP_ORIGIN
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
    return Response.json([row], { headers: { "content-range": "0-0/1" } })
  }
  function request(
    path: string,
    method = "GET",
    cookie = "",
    body?: unknown,
    source: string | null = origin
  ) {
    return new Request(`${origin}${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(source ? { origin: source } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  try {
    assert.equal(
      (await measurements.GET(request("/api/measurements"))).status,
      401
    )
    assert.equal(
      (await measurements.POST(request("/api/measurements", "POST", "", [row])))
        .status,
      401
    )
    assert.equal(calls, 0)
    assert.equal(
      (
        await session.POST(
          request(
            "/api/admin/session",
            "POST",
            "",
            { password: process.env.ADMIN_PASSWORD },
            "https://attacker.example"
          )
        )
      ).status,
      403
    )
    assert.equal(
      (
        await session.POST(
          request("/api/admin/session", "POST", "", { password: "wrong" })
        )
      ).status,
      401
    )
    const login = await session.POST(
      request("/api/admin/session", "POST", "", {
        password: process.env.ADMIN_PASSWORD,
      })
    )
    assert.equal(login.status, 200)
    const setCookie = login.headers.get("set-cookie")!
    for (const flag of [
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Max-Age=28800",
      "Path=/",
    ])
      assert.ok(setCookie.includes(flag))
    const cookie = setCookie.split(";")[0]
    assert.ok(cookie.startsWith("__Host-"))
    assert.equal(
      (
        await measurements.GET(
          request("/api/measurements", "GET", cookie + "tampered")
        )
      ).status,
      401
    )
    const realNow = Date.now
    Date.now = () => realNow() - 9 * 60 * 60 * 1000
    let expired: string
    try {
      expired = sessionCookie().split(";")[0]
    } finally {
      Date.now = realNow
    }
    assert.equal(
      (await measurements.GET(request("/api/measurements", "GET", expired)))
        .status,
      401
    )
    assert.equal(
      (
        await measurements.POST(
          request("/api/measurements", "POST", cookie, [row], null)
        )
      ).status,
      403
    )
    assert.equal(
      (
        await measurements.POST(
          request(
            "/api/measurements",
            "POST",
            cookie,
            [row],
            "https://attacker.example"
          )
        )
      ).status,
      403
    )
    assert.equal(
      (
        await measurements.POST(
          request("/api/measurements", "POST", cookie, [{ ciudad: "X" }])
        )
      ).status,
      400
    )
    assert.equal(
      (
        await measurements.POST(
          request("/api/measurements", "POST", cookie, Array(501).fill(row))
        )
      ).status,
      400
    )
    assert.equal(
      (
        await measurements.POST(
          request("/api/measurements", "POST", cookie, "x".repeat(180001))
        )
      ).status,
      400
    )
    assert.equal(calls, 0)
    const written = await measurements.POST(
      request("/api/measurements", "POST", cookie, [row])
    )
    assert.equal(written.status, 200)
    assert.deepEqual(await written.json(), { processed: 1, verified: 1 })
    const read = await measurements.GET(
      request("/api/measurements", "GET", cookie)
    )
    assert.deepEqual(await read.json(), { rows: [row], total: 1 })
    const logout = await session.DELETE(
      request("/api/admin/session", "DELETE", cookie)
    )
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/)
    const originalError = console.error
    let log = ""
    console.error = (...values) => {
      log = JSON.stringify(values)
    }
    fail = true
    try {
      const failure = await measurements.GET(
        request("/api/measurements", "GET", cookie)
      )
      assert.equal(failure.status, 502)
      assert.ok(!(await failure.text()).includes("sb_secret"))
      assert.match(log, /42501/)
      assert.ok(!log.includes("sb_secret_test-private"))
    } finally {
      console.error = originalError
    }
    delete process.env.ADMIN_SESSION_SECRET
    assert.equal(
      (await measurements.GET(request("/api/measurements", "GET", cookie)))
        .status,
      503
    )
    Object.assign(process.env, { NODE_ENV: "development" })
    fail = false
    assert.equal(
      (
        await measurements.GET(
          new Request("http://localhost:3000/api/measurements")
        )
      ).status,
      200
    )
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key]
    Object.assign(process.env, originalEnv)
  }
})
