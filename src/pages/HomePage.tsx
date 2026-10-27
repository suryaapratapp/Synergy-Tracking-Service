import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useToast } from '../components/ui'
import { IconArrow, IconDashboard, IconInstall, IconList, IconLock, IconTakedown } from '../components/icons'
import { DEVELOPER } from '../lib/branding'
import type { ProductCounts } from '../lib/types'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

interface Tile {
  to: string
  title: string
  sub: string
  tone: 'dashboard' | 'install' | 'takedown' | 'products'
  icon: ReactNode
  /** Staff only - shown locked to guests so they know it exists. */
  staffOnly?: boolean
  badge?: { text: string; alert?: boolean } | null
}

/**
 * Four big buttons and nothing else: the whole app, one tap away. A fitter
 * working a ward should never have to hunt for where to go.
 */
export default function HomePage() {
  const { profile, isGuest, guestName } = useAuth()
  const { hospitals } = useData()
  const toast = useToast()
  const [counts, setCounts] = useState<ProductCounts | null>(null)

  useEffect(() => {
    if (isGuest) return
    let cancelled = false
    void supabase.rpc('rpc_product_counts', { p_hospital_id: null }).then(({ data }) => {
      if (!cancelled && data) setCounts(data as ProductCounts)
    })
    return () => {
      cancelled = true
    }
  }, [isGuest])

  // A hospital login is a place, not a person - greet the site instead.
  const firstName = isGuest
    ? guestName.split(' ')[0]
    : profile?.role === 'hospital'
      ? ''
      : (profile?.full_name ?? profile?.username ?? '').split(' ')[0]

  const place =
    profile?.role === 'hospital'
      ? (hospitals.find((h) => h.id === profile.hospital_id)?.name ?? 'Your site')
      : isGuest
        ? 'Guest · install and take down'
        : 'All sites'

  const tiles: Tile[] = [
    {
      to: '/dashboard',
      title: 'Dashboard',
      sub: 'In use, overdue, due soon, in stock',
      tone: 'dashboard',
      icon: <IconDashboard size={30} />,
      staffOnly: true,
      badge:
        counts && counts.overdue > 0
          ? { text: `${counts.overdue} overdue`, alert: true }
          : counts && counts.due > 0
            ? { text: `${counts.due} due soon` }
            : null,
    },
    {
      to: '/install',
      title: 'Install',
      sub: 'Scan a label and hang it',
      tone: 'install',
      icon: <IconInstall size={30} />,
    },
    {
      to: '/takedown',
      title: 'Take down',
      sub: 'Remove, and swap in one go',
      tone: 'takedown',
      icon: <IconTakedown size={30} />,
    },
    {
      to: '/inventory',
      title: 'Products',
      sub: 'Every curtain and where it is',
      tone: 'products',
      icon: <IconList size={30} />,
      staffOnly: true,
      badge: counts ? { text: `${counts.in_use} in use` } : null,
    },
  ]

  return (
    <div className="home">
      <section className="home-hero">
        <p className="home-eyebrow">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1>
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="home-place">{place}</p>
      </section>

      <div className="home-grid">
        {tiles.map((t) => {
          const locked = isGuest && t.staffOnly
          const body = (
            <>
              <span className="tile-icon" aria-hidden="true">
                {locked ? <IconLock size={26} /> : t.icon}
              </span>
              {t.badge && !locked && (
                <span className={t.badge.alert ? 'tile-badge tile-badge-alert' : 'tile-badge'}>{t.badge.text}</span>
              )}
              <span className="tile-text">
                <span className="tile-title">{t.title}</span>
                <span className="tile-sub">{locked ? 'Staff only' : t.sub}</span>
              </span>
              {!locked && (
                <span className="tile-go" aria-hidden="true">
                  <IconArrow />
                </span>
              )}
            </>
          )

          return locked ? (
            <button
              key={t.to}
              type="button"
              className="home-tile tile-locked"
              aria-disabled="true"
              onClick={() => toast('info', `${t.title} is for staff accounts. Guests can install and take down.`)}
            >
              {body}
            </button>
          ) : (
            <Link key={t.to} to={t.to} className={`home-tile tile-${t.tone}`}>
              {body}
            </Link>
          )
        })}
      </div>

      <p className="credit">{DEVELOPER}</p>
    </div>
  )
}
