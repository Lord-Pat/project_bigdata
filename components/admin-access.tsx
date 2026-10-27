"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

export function AdminAccess() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    fetch("/api/admin/session", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json()
        if (active) {
          setAuthenticated(data.authenticated === true)
          if (!response.ok) setError(data.error)
        }
      })
      .catch(() => {
        if (active) setError("No se pudo consultar la sesión.")
      })
    return () => {
      active = false
    }
  }, [])
  async function session(method: "POST" | "DELETE") {
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/admin/session", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ password }) } : {}),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setAuthenticated(data.authenticated)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Error de sesión.")
    } finally {
      setPassword("")
      setBusy(false)
    }
  }
  return (
    <section className="callout" aria-label="Acceso administrativo">
      {authenticated ? (
        <div className="toolbar">
          <span>Acceso administrativo activo (sesión de hasta 8 horas).</span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => session("DELETE")}
          >
            Cerrar sesión
          </Button>
        </div>
      ) : (
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault()
            void session("POST")
          }}
        >
          <label>
            Contraseña administrativa
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            Iniciar sesión
          </Button>
          <span>Inicia sesión para cargar y consultar datos en Supabase.</span>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
