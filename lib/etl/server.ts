import "server-only"
export function localGuard(request: Request) {
  const url = new URL(request.url)
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Flujo deshabilitado en producción: incorpora autenticación y autorización antes de publicar."
    )
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Este flujo solo está habilitado en localhost.")
  const origin = request.headers.get("origin")
  if (origin && origin !== url.origin) throw new Error("Origen no permitido.")
}
export async function database(query: URLSearchParams, init: RequestInit = {}) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret)
    throw new Error(
      "Configura SUPABASE_URL y SUPABASE_SECRET_KEY en .env.local."
    )
  const response = await fetch(
    `${url}/rest/v1/mediciones_meteorologicas?${query}`,
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
  )
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(
      `Supabase (${response.status}): ${detail.code === "PGRST205" || detail.code === "42P01" ? "La tabla no existe. Ejecuta la migración SQL." : "No se pudo completar la operación. Comprueba la migración y los permisos."}`
    )
  }
  return response
}
