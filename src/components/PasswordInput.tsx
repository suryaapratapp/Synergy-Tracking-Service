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
}: Props) {
  const [show, setShow] = useState(false)

  return (
    <div className="password-field">
      <input
        id={id}
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
