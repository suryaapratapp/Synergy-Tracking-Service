import { useState, type FormEvent } from 'react'
import { MAX_GUEST_NAME } from '../lib/guest'
import { isValidPin, PIN_MAX, PIN_MIN } from '../lib/offline/identity'
import PasswordInput from './PasswordInput'
import { IconArrow } from './icons'

/** One name, one PIN, one big button - everything a fitter needs to get going. */
export default function GuestNameForm({
  initial = '',
  busy = false,
  error,
  cta = 'Start working',
  askPin = true,
  onSubmit,
}: {
  initial?: string
  busy?: boolean
  error?: string | null
  cta?: string
  /** Off when the session already exists and only the name was lost. */
  askPin?: boolean
  onSubmit: (name: string, pin: string) => void
}) {
  const [name, setName] = useState(initial)
  const [pin, setPin] = useState('')

  const ready = !!name.trim() && (!askPin || isValidPin(pin))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready && !busy) onSubmit(name, pin)
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

      {askPin && (
        <div className="field">
          <label className="field-label" htmlFor="guest-pin">
            PIN
          </label>
          <PasswordInput
            id="guest-pin"
            value={pin}
            onChange={setPin}
            numeric
            large
            maxLength={PIN_MAX}
            label="PIN"
            autoComplete="off"
            placeholder={`${PIN_MIN}–${PIN_MAX} digits`}
            required
          />
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !ready}>
        {busy ? 'Starting…' : cta}
        {!busy && <IconArrow />}
      </button>

      <p className="login-help">
        {askPin
          ? 'Ask your supervisor for the PIN. Your name is saved with every product you install or take down.'
          : 'Your name is saved with every product you install or take down.'}
      </p>
    </form>
  )
}
