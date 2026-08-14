import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { usernameToEmail } from '../lib/branding'
import { Card, Field, SectionTitle, useToast } from '../components/ui'
import PasswordInput from '../components/PasswordInput'
import { ROLE_HELP, ROLE_LABELS } from '../lib/types'
import { formatDate } from '../lib/format'

const MIN_LENGTH = 8

export default function AccountPage() {
  const { profile, refreshProfile } = useAuth()
  const { hospitals } = useData()
  const toast = useToast()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!profile) return null

  const hospitalName = hospitals.find((h) => h.id === profile.hospital_id)?.name

  const problem = (): string | null => {
    if (!current) return 'Enter your current password.'
    if (next.length < MIN_LENGTH) return `The new password must be at least ${MIN_LENGTH} characters.`
    if (next !== repeat) return 'The new passwords do not match.'
    if (next === current) return 'The new password must be different from the current one.'
    return null
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return

    const invalid = problem()
    if (invalid) {
      setError(invalid)
      return
    }

    setBusy(true)
    setError(null)

    // Supabase will change a password without asking for the old one, so check
    // it here first - otherwise an unattended phone is enough to take over an
    // account.
    const { error: wrongCurrent } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(profile.username ?? ''),
      password: current,
    })

    if (wrongCurrent) {
      const msg = 'Your current password is not correct.'
      setError(msg)
      toast('error', msg)
      setBusy(false)
      return
    }

    const { error: updateFailed } = await supabase.auth.updateUser({ password: next })

    if (updateFailed) {
      const msg = friendlyError(updateFailed)
      setError(msg)
      toast('error', msg)
    } else {
      toast('success', 'Password changed')
      setCurrent('')
      setNext('')
      setRepeat('')
      await refreshProfile()
    }
    setBusy(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My account</h1>
          <p className="page-sub">Your sign-in details</p>
        </div>
      </div>

      <Card>
        <SectionTitle>Signed in as</SectionTitle>
        <ul className="kv-list">
          <li>
            <span>Username</span>
            <strong>{profile.username}</strong>
          </li>
          <li>
            <span>Display name</span>
            <strong>{profile.full_name ?? '—'}</strong>
          </li>
          <li>
            <span>Access level</span>
            <strong>{ROLE_LABELS[profile.role]}</strong>
          </li>
          {hospitalName && (
            <li>
              <span>Hospital</span>
              <strong>{hospitalName}</strong>
            </li>
          )}
          <li>
            <span>Account created</span>
            <strong>{formatDate(profile.created_at)}</strong>
          </li>
        </ul>
        <p className="field-hint">{ROLE_HELP[profile.role]}</p>
      </Card>

      <Card>
        <SectionTitle>Change password</SectionTitle>
        <p className="card-sub">
          Use at least {MIN_LENGTH} characters. You stay signed in on this device after changing it.
        </p>

        <form onSubmit={submit} className="password-form">
          {/* Helps password managers attach the saved entry to the right account. */}
          <input
            type="text"
            name="username"
            value={profile.username ?? ''}
            autoComplete="username"
            readOnly
            hidden
          />

          <Field label="Current password" htmlFor="pw-current">
            <PasswordInput
              id="pw-current"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              disabled={busy}
              required
            />
          </Field>

          <Field label="New password" htmlFor="pw-new">
            <PasswordInput
              id="pw-new"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              disabled={busy}
              required
            />
          </Field>

          <Field label="Repeat new password" htmlFor="pw-repeat">
            <PasswordInput
              id="pw-repeat"
              value={repeat}
              onChange={setRepeat}
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              disabled={busy}
              required
            />
          </Field>

          {repeat.length > 0 && next !== repeat && (
            <p className="field-hint mismatch">The new passwords do not match yet.</p>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={busy || !current || !next || !repeat}
          >
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </Card>
    </div>
  )
}
