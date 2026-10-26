import type { Metadata } from "next"
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
      <body>{children}</body>
    </html>
  )
}
