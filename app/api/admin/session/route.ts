import {
  authenticated,
  checkOrigin,
  passwordMatches,
  sessionCookie,
  ApiError,
  apiError,
} from "@/lib/etl/auth"

export async function GET(request: Request) {
  try {
    return Response.json(
      { authenticated: authenticated(request) },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return apiError(error)
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request)
    // Bound the streamed body as well as Content-Length.
    const reader = request.body?.getReader()
    if (!reader) throw new ApiError("Petición vacía.", 400)
    let body = "",
      size = 0
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) {
        await reader.cancel()
        throw new ApiError("Petición demasiado grande.", 413)
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    if (!passwordMatches(JSON.parse(body).password)) {
      await new Promise((resolve) => setTimeout(resolve, 750))
      throw new ApiError("Contraseña incorrecta.", 401)
    }
    return Response.json(
      { authenticated: true },
      {
        headers: { "Set-Cookie": sessionCookie(), "Cache-Control": "no-store" },
      }
    )
  } catch (error) {
    return apiError(error)
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request)
    return Response.json(
      { authenticated: false },
      {
        headers: {
          "Set-Cookie": sessionCookie(true),
          "Cache-Control": "no-store",
        },
      }
    )
  } catch (error) {
    return apiError(error)
  }
}
