import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { Card, EmptyState, Field, SectionTitle, Sheet, Spinner, useToast } from '../components/ui'
import PasswordInput from '../components/PasswordInput'
import { GUEST_PEPPER } from '../lib/config'
import { formatDate } from '../lib/format'
import { isValidPin, PIN_MAX, PIN_MIN } from '../lib/offline/identity'
import { ROLE_HELP, ROLE_LABELS, type Profile, type UserRole } from '../lib/types'

const ASSIGNABLE_ROLES: UserRole[] = ['hospital', 'synergy_field', 'synergy', 'admin']

export default function AdminPage() {
  const { profile: me } = useAuth()
  const { hospitals, reload } = useData()
  const toast = useToast()

  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [dueDays, setDueDays] = useState<number>(14)
  const [savingSetting, setSavingSetting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [newPin, setNewPin] = useState('')
  const [pinBusy, setPinBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: profiles, error }, { data: setting }] = await Promise.all([
      supabase.from('profiles').select('*').order('role').order('email'),
      supabase.from('app_settings').select('value').eq('key', 'default_change_due_days').maybeSingle(),
    ])
    if (error) toast('error', friendlyError(error))
    else setUsers((profiles ?? []) as Profile[])
    if (setting?.value != null) setDueDays(Number(setting.value))
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const saveSetting = async () => {
    setSavingSetting(true)
    const { error } = await supabase
      .from('app_settings')
      .update({ value: dueDays, updated_at: new Date().toISOString() })
      .eq('key', 'default_change_due_days')
    if (error) toast('error', friendlyError(error))
    else toast('success', `Default change-due window is now ${dueDays} days`)
    setSavingSetting(false)
  }

  const updateUser = async (id: string, patch: Partial<Profile>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) toast('error', friendlyError(error))
    else {
      toast('success', 'User updated')
      setEditing(null)
      await load()
      await reload()
    }
  }

  const setGuestPin = async () => {
    if (!isValidPin(newPin) || pinBusy) return
    setPinBusy(true)
    const { error } = await supabase.rpc('admin_set_guest_pin', { p_password: GUEST_PEPPER + newPin })
    setPinBusy(false)
    if (error) {
      toast('error', friendlyError(error))
      return
    }
    setNewPin('')
    toast('success', 'Guest PIN changed. Phones using the old PIN will be signed out shortly.')
  }

  const hospitalName = (id: string | null) => hospitals.find((h) => h.id === id)?.name ?? '—'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Users &amp; settings</h1>
          <p className="page-sub">Administrator access</p>
        </div>
      </div>

      <Card>
        <SectionTitle>Change-due window</SectionTitle>
        <p className="card-sub">
          How long a product stays in service before it is flagged for change. Applied to new installations.
        </p>
        <div className="inline-form">
          <input
            className="input"
            type="number"
            min={1}
            max={365}
            inputMode="numeric"
            value={dueDays}
            onChange={(e) => setDueDays(Number(e.target.value))}
            aria-label="Default days until change due"
          />
          <button type="button" className="btn btn-primary" onClick={() => void saveSetting()} disabled={savingSetting}>
            {savingSetting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Card>

      <Card>
        <SectionTitle
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
              Add user
            </button>
          }
        >
          Accounts ({users.length})
        </SectionTitle>

        {loading ? (
          <Spinner />
        ) : users.length === 0 ? (
          <EmptyState title="No accounts yet" />
        ) : (
          <ul className="user-list">
            {users.map((u) => (
              <li key={u.id}>
                <button type="button" className="user-row" onClick={() => setEditing(u)}>
                  <span className="user-main">
                    <span className="user-name">
                      {u.role === 'guest' ? 'Guest login (shared)' : (u.full_name ?? u.username)}
                      {u.id === me?.id && <em> (you)</em>}
                    </span>
                    <span className="user-email">@{u.username}</span>
                  </span>
                  <span className="user-side">
                    <span className={`role-chip role-${u.role}`}>{ROLE_LABELS[u.role]}</span>
                    {u.role === 'hospital' && <span className="user-hosp">{hospitalName(u.hospital_id)}</span>}
                    {!u.active && <span className="badge badge-retired">Disabled</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AddUserSheet
        open={addOpen}
        hospitals={hospitals}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false)
          void load()
        }}
      />

      <Sheet open={!!editing} title="Edit user" onClose={() => setEditing(null)}>
        {editing && editing.role === 'guest' && (
          <>
            <p className="sheet-lead">
              <strong>Guest access</strong> is the shared login behind &ldquo;Continue as guest&rdquo;. Anyone who types
              a name can install and take down products with it &mdash; nothing else.
            </p>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <span>Guest access is switched on</span>
            </label>
            <p className="muted">Switching it off stops guests working straight away, including anyone already signed in.</p>

            <div className="pin-set">
              <h3>Guest PIN</h3>
              <p className="muted">
                Fitters type this with their name to sign in. The PIN cannot be read back, only replaced. A new PIN
                signs out phones using the old one within about an hour; a phone with no signal keeps accepting the
                old PIN until it next connects. Jobs still unsent on those phones are kept and go through once the
                fitter signs in again with the new PIN.
              </p>
              <PasswordInput
                id="new-pin"
                value={newPin}
                onChange={setNewPin}
                numeric
                maxLength={PIN_MAX}
                label="PIN"
                autoComplete="off"
                placeholder={`New PIN (${PIN_MIN}–${PIN_MAX} digits)`}
              />
              <button
                type="button"
                className="btn btn-ghost btn-block"
                disabled={!isValidPin(newPin) || pinBusy}
                onClick={() => void setGuestPin()}
              >
                {pinBusy ? 'Saving…' : 'Set new PIN'}
              </button>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => void updateUser(editing.id, { active: editing.active })}
            >
              Save
            </button>
          </>
        )}
        {editing && editing.role !== 'guest' && (
          <>
            <p className="sheet-lead">
              <span className="muted">Added {formatDate(editing.created_at)}</span>
            </p>

            <Field
              label="Username"
              htmlFor="edit-username"
              hint="What they type to sign in. Changing it takes effect immediately."
            >
              <input
                id="edit-username"
                className="input"
                value={editing.username ?? ''}
                onChange={(e) => setEditing({ ...editing, username: e.target.value.toLowerCase() })}
                minLength={3}
                maxLength={32}
                pattern="[a-z0-9][a-z0-9._\-]{2,31}"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>

            <Field label="Display name" htmlFor="edit-fullname">
              <input
                id="edit-fullname"
                className="input"
                value={editing.full_name ?? ''}
                onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                autoComplete="off"
              />
            </Field>

            <Field label="Role" htmlFor="edit-role" hint={ROLE_HELP[editing.role]}>
              <select
                id="edit-role"
                className="input"
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value as UserRole })}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>

            {editing.role === 'hospital' && (
              <Field label="Hospital" htmlFor="edit-hosp">
                <select
                  id="edit-hosp"
                  className="input"
                  value={editing.hospital_id ?? ''}
                  onChange={(e) => setEditing({ ...editing, hospital_id: e.target.value || null })}
                >
                  <option value="">Select hospital</option>
                  {hospitals.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <label className="switch-row">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <span>Account is active</span>
            </label>

            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={
                (editing.role === 'hospital' && !editing.hospital_id) ||
                !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(editing.username ?? '')
              }
              onClick={() =>
                void updateUser(editing.id, {
                  username: editing.username,
                  full_name: editing.full_name?.trim() || editing.username,
                  role: editing.role,
                  hospital_id: editing.role === 'hospital' ? editing.hospital_id : null,
                  active: editing.active,
                })
              }
            >
              Save changes
            </button>
          </>
        )}
      </Sheet>
    </div>
  )
}

/* ------------------------------------------------------------- add user */

function AddUserSheet({
  open,
  hospitals,
  onClose,
  onCreated,
}: {
  open: boolean
  hospitals: { id: string; name: string }[]
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('hospital')
  const [hospitalId, setHospitalId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const { data, error: fnError } = await supabase.functions.invoke('admin-create-user', {
      body: {
        username: username.trim().toLowerCase(),
        password,
        full_name: fullName.trim(),
        role,
        hospital_id: role === 'hospital' ? hospitalId : null,
      },
    })

    // On a non-2xx the client hands back the raw Response rather than the
    // parsed body, so dig the real message out of it.
    let failure: string | null = (data as { error?: string } | null)?.error ?? null
    if (fnError) {
      failure = fnError.message
      const res = (fnError as { context?: Response }).context
      if (res && typeof res.json === 'function') {
        try {
          const body = (await res.json()) as { error?: string }
          if (body?.error) failure = body.error
        } catch {
          /* keep the generic message */
        }
      }
    }

    if (failure) {
      setError(failure)
      toast('error', failure)
    } else {
      toast('success', `${username} created`)
      setUsername('')
      setPassword('')
      setFullName('')
      setRole('hospital')
      setHospitalId('')
      onCreated()
    }
    setBusy(false)
  }

  return (
    <Sheet open={open} title="Add user" onClose={onClose}>
      <form onSubmit={submit}>
        <Field
          label="Username"
          htmlFor="new-username"
          hint="What they type to sign in. Lowercase letters, numbers, dots, dashes or underscores."
        >
          <input
            id="new-username"
            className="input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="e.g. queenmary"
            required
            minLength={3}
            maxLength={32}
            pattern="[a-z0-9][a-z0-9._\-]{2,31}"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>

        <Field label="Display name" htmlFor="new-name">
          <input
            id="new-name"
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Queen Mary Hospital"
            autoComplete="off"
          />
        </Field>

        <Field
          label="Temporary password"
          htmlFor="new-password"
          hint="Minimum 8 characters. Share it with the user securely and ask them to change it."
        >
          <input
            id="new-password"
            className="input"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="off"
          />
        </Field>

        <Field label="Role" htmlFor="new-role" hint={ROLE_HELP[role]}>
          <select
            id="new-role"
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>

        {role === 'hospital' && (
          <Field label="Hospital" htmlFor="new-hosp">
            <select
              id="new-hosp"
              className="input"
              value={hospitalId}
              onChange={(e) => setHospitalId(e.target.value)}
              required
            >
              <option value="">Select hospital</option>
              {hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={busy || (role === 'hospital' && !hospitalId)}
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </Sheet>
  )
}
