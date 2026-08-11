import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Creates a login. Creating auth users needs the service role key, which must
 * never reach the browser - so it lives here, and the function only acts after
 * confirming the caller's own JWT belongs to an active admin.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Echo whatever headers the browser asks for: the web client attaches its own
// tracing header, and a fixed allow-list silently fails the preflight.
function cors(req: Request) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      req.headers.get('Access-Control-Request-Headers') ??
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Access-Control-Request-Headers',
  }
}

const ROLES = new Set(['admin', 'synergy', 'hospital'])

Deno.serve(async (req: Request) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not signed in' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Who is calling?
  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller?.user) return json({ error: 'Not signed in' }, 401)

  // 2. Are they actually an admin?
  const { data: profile } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', caller.user.id)
    .maybeSingle()

  if (!profile || profile.role !== 'admin' || !profile.active) {
    return json({ error: 'Only administrators can create accounts' }, 403)
  }

  // 3. Validate the request.
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const fullName = String(body.full_name ?? '').trim()
  const role = String(body.role ?? 'hospital')
  const hospitalId = body.hospital_id ? String(body.hospital_id) : null

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400)
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)
  if (!ROLES.has(role)) return json({ error: 'Unknown role' }, 400)
  if (role === 'hospital' && !hospitalId) return json({ error: 'Hospital users need a hospital' }, 400)

  if (hospitalId) {
    const { data: hospital } = await admin
      .from('hospitals')
      .select('id')
      .eq('id', hospitalId)
      .maybeSingle()
    if (!hospital) return json({ error: 'That hospital does not exist' }, 400)
  }

  // 4. Create the user. The on_auth_user_created trigger builds the profile
  //    from this metadata.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName || email.split('@')[0],
      role,
      hospital_id: hospitalId ?? '',
    },
  })

  if (createError) {
    const msg = /already been registered|already exists/i.test(createError.message)
      ? 'That email address already has an account'
      : createError.message
    return json({ error: msg }, 400)
  }

  // 5. Belt and braces - make sure the profile matches what was asked for.
  await admin
    .from('profiles')
    .update({ role, hospital_id: hospitalId, full_name: fullName || null })
    .eq('id', created.user!.id)

  return json({ id: created.user!.id, email, role })
})
