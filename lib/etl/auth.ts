import "server-only"
import {
  createHmac,
  createHash,
  timingSafeEqual,
  randomBytes,
} from "node:crypto"

const lifetime = 8 * 60 * 60
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
function config() {
  const password = process.env.ADMIN_PASSWORD
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!password || password.length < 16 || !secret || secret.length < 32)
    throw new ApiError(
      "Configura ADMIN_PASSWORD (mínimo 16 caracteres) y ADMIN_SESSION_SECRET (mínimo 32) en el servidor.",
      503
    )
  return { password, secret }
}
export function localAccess(request: Request) {
  return (
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
  )
}
function cookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-meteolab-admin"
    : "meteolab-admin"
}
function signature(value: string) {
  const { password, secret } = config()
  return createHmac("sha256", secret)
    .update(`${password}\0${value}`)
    .digest("base64url")
}
export function passwordMatches(value: unknown) {
  const { password } = config()
  return (
    typeof value === "string" &&
    timingSafeEqual(
      createHash("sha256").update(value).digest(),
      createHash("sha256").update(password).digest()
    )
  )
}
export function sessionCookie(clear = false) {
  const payload = `${Math.floor(Date.now() / 1000) + lifetime}.${randomBytes(16).toString("hex")}`
  const value = clear ? "" : `${payload}.${signature(payload)}`
  return `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : lifetime}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
}
export function authenticated(request: Request) {
  if (localAccess(request)) return true
  config()
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${cookieName()}=`))
    ?.slice(cookieName().length + 1)
  if (!value || value.length > 256) return false
  const [expiry, nonce, mac, extra] = value.split(".")
  if (
    extra ||
    !/^\d+$/.test(expiry) ||
    !/^[a-f0-9]{32}$/.test(nonce || "") ||
    !mac
  )
    return false
  const now = Math.floor(Date.now() / 1000)
  if (Number(expiry) <= now || Number(expiry) > now + lifetime) return false
  const expected = Buffer.from(signature(`${expiry}.${nonce}`))
  const actual = Buffer.from(mac)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin")
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin
  if (
    (origin !== expected && !(localAccess(request) && !origin)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError("Origen no permitido.", 403)
}
export function authorize(request: Request) {
  if (!authenticated(request))
    throw new ApiError("Inicia sesión como administrador.", 401)
  if (!["GET", "HEAD"].includes(request.method)) checkOrigin(request)
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
