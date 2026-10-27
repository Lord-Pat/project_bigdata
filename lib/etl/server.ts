import "server-only"
export { authorize as localGuard } from "./auth"
import { ApiError } from "./auth"
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
