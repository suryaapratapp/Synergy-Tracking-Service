import { useState } from 'react'

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  placeholder?: string
  required?: boolean
  minLength?: number
  disabled?: boolean
  autoFocus?: boolean
  /** A PIN: digits only, number pad on phones. */
  numeric?: boolean
  maxLength?: number
  large?: boolean
  label?: string
}

/**
 * Password field with a show/hide toggle. Typing a long password blind on a
 * phone keyboard is the main cause of "wrong password" complaints, so every
 * password field in the app offers to reveal what has been typed.
 */
export default function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder = '••••••••',
  required = false,
  minLength,
  disabled = false,
  autoFocus = false,
  numeric = false,
  maxLength,
  large = false,
  label = 'password',
}: Props) {
  const [show, setShow] = useState(false)

  return (
    <div className="password-field">
      <input
        id={id}
        className={large ? 'input input-lg' : 'input'}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
        inputMode={numeric ? 'numeric' : undefined}
        pattern={numeric ? '[0-9]*' : undefined}
        maxLength={maxLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        disabled={disabled}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="password-reveal"
        onClick={() => setShow((v) => !v)}
        disabled={disabled}
        aria-pressed={show}
        aria-label={show ? `Hide ${label}` : `Show ${label}`}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
