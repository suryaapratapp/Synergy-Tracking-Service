import { useAuth } from '../context/AuthContext'
import { APP_NAME, DEVELOPER } from '../lib/branding'
import BrandMark from '../components/BrandMark'
import GuestNameForm from '../components/GuestNameForm'

/** Shown when a guest session is still signed in but the name was lost. */
export default function GuestNamePrompt() {
  const { setGuestName, signOut } = useAuth()

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <BrandMark size={60} />
          <h1>{APP_NAME}</h1>
        </div>
        <div className="login-lead">
          <h2>Who&rsquo;s working today?</h2>
          <p>Type your name to carry on.</p>
        </div>
        <GuestNameForm cta="Continue" askPin={false} onSubmit={(name) => setGuestName(name)} />
        <button type="button" className="link-button login-alt" onClick={() => void signOut()}>
          Use a staff login instead
        </button>
      </div>
      <p className="credit">{DEVELOPER}</p>
    </div>
  )
}
