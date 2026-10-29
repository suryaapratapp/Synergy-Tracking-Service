import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { networkUsable } from '../lib/offline/network'
import { cachedLocations, snapshotInfo, syncSnapshot } from '../lib/offline/snapshot'
import BrandMark from './BrandMark'
import { Spinner } from './ui'

const STALE_MS = 12 * 60 * 60 * 1000

/** The sign-in this run has already updated for. Survives the screen re-mounting. */
let doneFor = ''

/**
 * After every sign-in - staff or guest - the app updates itself before anything
 * else can be done, so a fitter is never caught in a signal outage with an old
 * copy of the sites and products.
 *
 * It also updates when an already-signed-in app is opened with data more than
 * half a day old. Where there is no signal the last copy on the phone is used
 * if there is one; a phone that has never been updated has to be connected once.
 */
export default function UpdateGate({ children }: { children: ReactNode }) {
  const { profile, signInStamp, offlineSession } = useAuth()
  const { reload } = useData()
  const key = `${profile?.id ?? ''}:${signInStamp}`

  const [state, setState] = useState<'checking' | 'updating' | 'failed' | 'ready'>(
    doneFor === key ? 'ready' : 'checking',
  )
  const [count, setCount] = useState(0)
  const [offline, setOffline] = useState(false)
  const [haveCopy, setHaveCopy] = useState(false)
  const started = useRef('')

  const finish = useCallback(() => {
    doneFor = key
    setState('ready')
  }, [key])

  const run = useCallback(async () => {
    setState('updating')
    setCount(0)
    const info = await snapshotInfo()
    const copy = info.count > 0 && (await cachedLocations()).length > 0
    setHaveCopy(copy)

    if (offlineSession || !networkUsable()) {
      if (copy) finish()
      else {
        setOffline(true)
        setState('failed')
      }
      return
    }

    setOffline(false)
    await reload()
    const ok = await syncSnapshot(setCount)
    if (ok) finish()
    else setState('failed')
  }, [offlineSession, reload, finish])

  useEffect(() => {
    if (!profile || doneFor === key || started.current === key) return
    started.current = key
    void (async () => {
      const info = await snapshotInfo()
      const stale = !info.syncedAt || Date.now() - new Date(info.syncedAt).getTime() > STALE_MS
      // A fresh sign-in always updates; reopening the app only does if the data is old.
      if (signInStamp > 0 || stale) await run()
      else finish()
    })()
  }, [profile, key, signInStamp, run, finish])

  if (state === 'ready' || !profile) return <>{children}</>

  return (
    <div className="gate">
      <div className="gate-card">
        <BrandMark size={48} />
        {state === 'failed' ? (
          <>
            <h2>Could not update</h2>
            <p>{offline ? 'No signal. Connect once, then try again.' : 'Check your signal and try again.'}</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void run()}>
              Try again
            </button>
            {haveCopy && (
              <button type="button" className="btn btn-ghost btn-block" onClick={finish}>
                Continue with saved data
              </button>
            )}
          </>
        ) : (
          <>
            <Spinner label="Updating" />
            <h2>Updating…</h2>
            <p>{count > 0 ? `${count.toLocaleString('en-GB')} products` : 'Getting ready for no signal'}</p>
          </>
        )}
      </div>
    </div>
  )
}
