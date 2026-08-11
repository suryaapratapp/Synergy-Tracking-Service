import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '../lib/supabase'
import type { LocationRow } from '../lib/types'
import { useAuth } from './AuthContext'

/**
 * The location list changes rarely but is needed on almost every screen, so
 * it is fetched once per session and kept in memory. RLS already trims it to
 * the sites the signed-in user may see.
 */

interface DataValue {
  locations: LocationRow[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  hospitals: { id: string; name: string }[]
  floorsFor: (hospitalId: string) => string[]
  wardsFor: (hospitalId: string, floor: string) => { id: string; name: string }[]
  baysFor: (wardId: string) => { id: string; name: string; active_products: number }[]
  bay: (bayId: string) => LocationRow | undefined
}

const DataContext = createContext<DataValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!session) {
      setLocations([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('v_locations')
      .select('*')
      .order('hospital_name')
      .order('floor')
      .order('ward_name')
      .order('bay_name')
    if (err) setError(err.message)
    else {
      setLocations((data ?? []) as LocationRow[])
      setError(null)
    }
    setLoading(false)
  }, [session])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<DataValue>(() => {
    const hospitals = Array.from(
      new Map(locations.map((l) => [l.hospital_id, { id: l.hospital_id, name: l.hospital_name }])).values(),
    ).sort((a, b) => a.name.localeCompare(b.name))

    return {
      locations,
      loading,
      error,
      reload,
      hospitals,
      floorsFor: (hospitalId) =>
        Array.from(new Set(locations.filter((l) => l.hospital_id === hospitalId).map((l) => l.floor))).sort(
          floorOrder,
        ),
      wardsFor: (hospitalId, floor) =>
        Array.from(
          new Map(
            locations
              .filter((l) => l.hospital_id === hospitalId && l.floor === floor)
              .map((l) => [l.ward_id, { id: l.ward_id, name: l.ward_name }]),
          ).values(),
        ).sort((a, b) => a.name.localeCompare(b.name)),
      baysFor: (wardId) =>
        locations
          .filter((l) => l.ward_id === wardId)
          .map((l) => ({ id: l.bay_id, name: l.bay_name, active_products: l.active_products }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      bay: (bayId) => locations.find((l) => l.bay_id === bayId),
    }
  }, [locations, loading, error, reload])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

/** "Ground" first, then numbered levels, then anything else alphabetically. */
function floorOrder(a: string, b: string): number {
  const rank = (s: string) => {
    const t = s.toLowerCase()
    if (t.includes('basement') || t.includes('lower')) return -1
    if (t.includes('ground')) return 0
    const m = t.match(/\d+/)
    return m ? Number(m[0]) : 999
  }
  const ra = rank(a)
  const rb = rank(b)
  return ra === rb ? a.localeCompare(b) : ra - rb
}

export function useData(): DataValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside DataProvider')
  return ctx
}
