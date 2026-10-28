"use client"

import dynamic from "next/dynamic"
import { usePathname, useSearchParams } from "next/navigation"
import { createContext, useContext, useState } from "react"
import { CITIES } from "@/lib/etl/core"

type Summary = Record<string, { extracted: number; valid: number }>
const SessionSummary = createContext<Summary>({})
export const useSessionSummary = () => useContext(SessionSummary)
const EtlDashboard = dynamic(() => import("./EtlDashboard"), {
  ssr: false,
  loading: () => (
    <p className="dashboard-loading" role="status">
      Preparando dashboard…
    </p>
  ),
})

export default function MeteoLabShell({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const search = useSearchParams()
  const dashboard = pathname === "/dashboard"
  const requestedCity = CITIES.find(
    (city) => city.name === search.get("city")
  )?.name
  const [visited, setVisited] = useState(dashboard)
  const [lastCity, setLastCity] = useState<string | undefined>(requestedCity)
  const [summary, setSummary] = useState<Summary>({})
  if (dashboard && !visited) setVisited(true)
  if (dashboard && requestedCity && requestedCity !== lastCity)
    setLastCity(requestedCity)
  return (
    <SessionSummary.Provider value={summary}>
      <div className="workspace">
        {!dashboard && children}
        {visited && (
          <div hidden={!dashboard} aria-hidden={!dashboard}>
            <EtlDashboard requestedCity={lastCity} onSummary={setSummary} />
          </div>
        )}
      </div>
    </SessionSummary.Provider>
  )
}
