import SpainMapHero from "@/components/SpainMapHero"

import { preconnect } from "react-dom"

export default function HomePage() {
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_MAPTILER_URL || "").origin
    preconnect(origin, { crossOrigin: "anonymous" })
  } catch {
    /* The map renders configuration errors with city fallback. */
  }
  return (
    <main className="map-home">
      <SpainMapHero />
    </main>
  )
}
