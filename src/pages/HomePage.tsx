import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useToast } from '../components/ui'
import { UpdateButton, useSnapshotInfo } from '../components/SyncStatus'
import {
  IconCheck,
  IconClock,
  IconDashboard,
  IconInstall,
  IconList,
  IconLock,
  IconTakedown,
} from '../components/icons'
import { startOfToday, useActivity, type ActivityEntry } from '../lib/offline/activity'
import { useNetworkUsable } from '../lib/offline/network'
import { useSyncState } from '../lib/offline/queue'
import { clockSkewMs, onSnapshotChange } from '../lib/offline/snapshot'
import { relativeTime } from '../lib/format'
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

const KIND_LABEL: Record<ActivityEntry['kind'], string> = {
  install: 'Installed',
  replace: 'Replaced',
  takedown: 'Taken down',
}

/**
 * Four compact buttons, then what matters right now: today's work on this phone,
 * the last few jobs and whether they have reached the server, and the one Update
 * button. Take down (remove and replace) is first; Install is for new curtains.
 */
export default function HomePage() {
  const { profile, isGuest, guestName } = useAuth()
  const { hospitals } = useData()
  const toast = useToast()
  const usable = useNetworkUsable()
  const sync = useSyncState()
  const activity = useActivity()
  const info = useSnapshotInfo()
  const [counts, setCounts] = useState<ProductCounts | null>(null)
  const [skew, setSkew] = useState<number | null>(null)

  useEffect(() => {
    if (isGuest) return
    let cancelled = false
    void supabase.rpc('rpc_product_counts', { p_hospital_id: null }).then(({ data }) => {
      if (!cancelled && data) setCounts(data as ProductCounts)
    })
    return () => {
      cancelled = true
    }
  }, [isGuest, usable])

  useEffect(() => {
    let live = true
    const read = () => void clockSkewMs().then((v) => live && setSkew(v))
    read()
    const stop = onSnapshotChange(read)
    return () => {
      live = false
      stop()
    }
  }, [])

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
        ? 'Guest'
        : 'All sites'

  const tiles: Tile[] = [
    { to: '/takedown', title: 'Take down', sub: 'Remove and replace', tone: 'takedown', icon: <IconTakedown size={24} /> },
    { to: '/install', title: 'Install', sub: 'New curtains', tone: 'install', icon: <IconInstall size={24} /> },
    {
      to: '/dashboard',
      title: 'Dashboard',
      sub: 'Overview',
      tone: 'dashboard',
      icon: <IconDashboard size={24} />,
      staffOnly: true,
      badge:
        counts && counts.overdue > 0
          ? { text: `${counts.overdue} overdue`, alert: true }
          : counts && counts.due > 0
            ? { text: `${counts.due} due soon` }
            : null,
    },
    {
      to: '/inventory',
      title: 'Products',
      sub: 'Every curtain',
      tone: 'products',
      icon: <IconList size={24} />,
      staffOnly: true,
      badge: counts ? { text: `${counts.in_use} in use` } : null,
    },
  ]

  /* ------------------------------------------------------------ today */
  const since = startOfToday()
  const today = activity.filter((a) => new Date(a.at).getTime() >= since)
  const downToday = today.filter((a) => a.kind === 'takedown').length
  const upToday = today.filter((a) => a.kind !== 'takedown').length
  const pendingIds = new Set(sync.pendingOps.map((o) => o.opId))
  const failedIds = new Set(sync.failedOps.map((o) => o.opId))
  const statusOf = (a: ActivityEntry) => (failedIds.has(a.opId) ? 'failed' : pendingIds.has(a.opId) ? 'waiting' : 'sent')

  /* ------------------------------------------------------- warnings */
  const clockOff = skew !== null && Math.abs(skew) > 3 * 60_000
  const clockMin = skew === null ? 0 : Math.round(Math.abs(skew) / 60_000)
  const ageH = info.syncedAt ? (Date.now() - new Date(info.syncedAt).getTime()) / 3_600_000 : null
  const stale = ageH !== null && ageH > 24

  return (
    <div className="home">
      <section className="home-hero">
        <div className="hero-row">
          <div>
            <h1>
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="home-place">{place}</p>
          </div>
          <span className={`net-pill ${usable ? 'is-up' : 'is-down'}`}>
            <span className="net-dot" aria-hidden="true" />
            {usable ? 'Online' : 'Offline'}
          </span>
        </div>
      </section>

      <div className="home-grid">
        {tiles.map((t) => {
          const locked = isGuest && t.staffOnly
          const body = (
            <>
              <span className="tile-icon" aria-hidden="true">
                {locked ? <IconLock size={22} /> : t.icon}
              </span>
              {t.badge && !locked && (
                <span className={t.badge.alert ? 'tile-badge tile-badge-alert' : 'tile-badge'}>{t.badge.text}</span>
              )}
              <span className="tile-text">
                <span className="tile-title">{t.title}</span>
                <span className="tile-sub">
                  {locked ? 'Staff only' : t.staffOnly && !usable ? 'Needs signal' : t.sub}
                </span>
              </span>
            </>
          )

          return locked ? (
            <button
              key={t.to}
              type="button"
              className="home-tile tile-locked"
              aria-disabled="true"
              onClick={() => toast('info', `${t.title} is for staff accounts.`)}
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

      <div className="home-body">
        {(clockOff || stale) && (
          <div className="home-warn" role="status">
            <IconClock size={20} />
            <span>
              {clockOff
                ? `This phone's clock is ${clockMin} min ${skew! > 0 ? 'slow' : 'fast'}. Correct it in Settings so jobs are timed properly.`
                : `Product list is ${Math.floor(ageH! / 24)} day${Math.floor(ageH! / 24) === 1 ? '' : 's'} old. Tap Update.`}
            </span>
          </div>
        )}

        <section className="glass-card today-card" aria-label="Today">
          <div className="today-stat">
            <strong>{downToday}</strong>
            <span>Taken down</span>
          </div>
          <div className="today-stat">
            <strong>{upToday}</strong>
            <span>Installed</span>
          </div>
          <div className={`today-stat ${sync.pending > 0 ? 'is-waiting' : ''}`}>
            <strong>{sync.pending}</strong>
            <span>Waiting to send</span>
          </div>
        </section>

        <section className="glass-card recent-card" aria-label="Recent">
          <h2 className="mini-title">Recent</h2>
          {activity.length === 0 ? (
            <p className="recent-empty">Your jobs will appear here.</p>
          ) : (
            <ul className="recent-list" tabIndex={0} aria-label="Recent jobs, scrollable">
              {activity.slice(0, 40).map((a) => {
                const st = statusOf(a)
                return (
                  <li key={a.id} className="recent-row">
                    <span className={`recent-icon kind-${a.kind}`} aria-hidden="true">
                      {a.kind === 'takedown' ? <IconTakedown size={16} /> : <IconInstall size={16} />}
                    </span>
                    <span className="recent-main">
                      <span className="recent-code">{a.code}</span>
                      <span className="recent-meta">
                        {KIND_LABEL[a.kind]}
                        {a.place ? ` · ${a.place}` : ''} · {relativeTime(a.at)}
                      </span>
                    </span>
                    <span className={`recent-status st-${st}`}>
                      {st === 'sent' ? <IconCheck size={14} /> : null}
                      {st === 'sent' ? 'Sent' : st === 'waiting' ? 'Waiting' : 'Not saved'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="home-foot">
          <UpdateButton />
        </div>
      </div>
    </div>
  )
}
