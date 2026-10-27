import "server-only"
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
export function localGuard(request: Request) {
  const url = new URL(request.url)
  const local =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  const production =
    process.env.NODE_ENV === "production" &&
    process.env.ETL_PERMITIR_EN_PRODUCCION === "true"
  if (!local && !production)
    throw new ApiError(
      "Flujo deshabilitado: configura ETL_PERMITIR_EN_PRODUCCION=true para habilitarlo en producción.",
      403
    )
  const origin = request.headers.get("origin")
  const expected = local ? url.origin : process.env.APP_ORIGIN || url.origin
  const modifying = !["GET", "HEAD"].includes(request.method)
  if (
    (origin && origin !== expected) ||
    (modifying && !local && !origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError("Origen no permitido.", 403)
}
export function apiError(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo completar la operación.",
    },
    {
      status: error instanceof ApiError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
export async function database(query: URLSearchParams, init: RequestInit = {}) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret)
    throw new Error(
      "Configura SUPABASE_URL y SUPABASE_SECRET_KEY en el servidor."
    )
  const response = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/mediciones_meteorologicas?${query}`,
    {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
      headers: {
        apikey: secret,
        ...(secret.startsWith("eyJ")
          ? { Authorization: `Bearer ${secret}` }
          : {}),
        "Content-Type": "application/json",
        ...init.headers,
      },
    }
  ).catch(() => {
    console.error("Supabase REST: conexión fallida o tiempo de espera agotado.")
    throw new ApiError(
      "No se pudo conectar con Supabase. Reintenta la operación.",
      502
    )
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) ?? {}
    const redact = (value: unknown) =>
      String(value ?? "")
        .split(secret)
        .join("[REDACTED]")
        .slice(0, 1500)
    console.error("Supabase REST", {
      status: response.status,
      code: redact(detail.code),
      message: redact(detail.message),
      details: redact(detail.details),
      hint: redact(detail.hint),
    })
    throw new ApiError(
      `Supabase (${response.status}): ${detail.code === "PGRST205" || detail.code === "42P01" ? "La tabla no existe. Ejecuta la migración SQL." : "No se pudo completar la operación. Comprueba la migración y los permisos."}`,
      502
    )
  }
  return response
}
