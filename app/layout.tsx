import type { Metadata } from "next"
import { Suspense } from "react"
import MeteoLabShell from "@/components/MeteoLabShell"
import "./globals.css"
export const metadata: Metadata = {
  title: "MeteoLab · Pipeline ETL",
  description:
    "Laboratorio de datos meteorológicos: Open-Meteo, transformación y Supabase.",
}
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <Suspense
          fallback={
            <div className="workspace dashboard-loading" role="status">
              Cargando MeteoLab…
            </div>
          }
        >
          <MeteoLabShell>{children}</MeteoLabShell>
        </Suspense>
      </body>
    </html>
  )
}
