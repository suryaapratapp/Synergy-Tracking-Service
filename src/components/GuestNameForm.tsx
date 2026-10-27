import { useState, type FormEvent } from 'react'
import { MAX_GUEST_NAME } from '../lib/guest'
import { IconArrow } from './icons'

/** One big field and one big button - everything a fitter needs to get going. */
export default function GuestNameForm({
  initial = '',
  busy = false,
  error,
  cta = 'Start working',
  onSubmit,
}: {
  initial?: string
  busy?: boolean
  error?: string | null
  cta?: string
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initial)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim() && !busy) onSubmit(name)
  }

  return (
    <form onSubmit={submit} className="login-form">
      <div className="field">
        <label className="field-label" htmlFor="guest-name">
          Your name
        </label>
        <input
          id="guest-name"
          className="input input-lg"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          autoCapitalize="words"
          maxLength={MAX_GUEST_NAME}
          placeholder="e.g. Sam Patel"
          required
        />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !name.trim()}>
        {busy ? 'Starting…' : cta}
        {!busy && <IconArrow />}
      </button>

      <p className="login-help">
        No password needed. Your name is saved with every product you install or take down.
      </p>
    </form>
  )
}
