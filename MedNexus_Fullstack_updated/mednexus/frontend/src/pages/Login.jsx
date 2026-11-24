import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'

const ROLES = [['patient', 'Patient'], ['staff', 'Staff'], ['doctor', 'Doctor'], ['admin', 'Administrator']]
const DEMO = {
  patient: 'simran@mail.com',
  staff: 'rashi@mednexus.com',
  doctor: 'arjun@mednexus.com',
  admin: 'admin@mednexus.com',
}

export default function Login() {
  const { user, login, register, guest } = useStore()
  const navigate = useNavigate()
  const [role, setRole] = useState('patient')
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // already logged in (e.g. page refresh) -> go straight to the dashboard
  useEffect(() => {
    if (user) navigate('/' + user.role, { replace: true })
  }, [user, navigate])

  const run = async (fn, goto) => {
    setError('')
    setBusy(true)
    try {
      const u = await fn()
      navigate(goto || '/' + u.role)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    if (mode === 'register') run(() => register({ full_name: name, email, password: pass }))
    else run(() => login(email, pass, role))
  }

  return (
    <div className="login">
      <div className="left">MedNexus</div>
      <div className="right">
        <form onSubmit={submit}>
          <div className="roles">
            {ROLES.map(([r, label]) => (
              <button type="button" key={r} className={role === r ? 'on' : ''} onClick={() => { setRole(r); setMode('login'); setError('') }}>{label}</button>
            ))}
          </div>
          {mode === 'register' && <input placeholder="Full name" required value={name} onChange={(e) => setName(e.target.value)} />}
          <input type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" required minLength={mode === 'register' ? 6 : undefined} value={pass} onChange={(e) => setPass(e.target.value)} />
          {error && <div className="err">{error}</div>}
          <button type="submit" disabled={busy}>{mode === 'register' ? 'Create patient account' : 'Login'}</button>
          {role === 'patient' && (
            <button type="button" className="light" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
              {mode === 'login' ? 'New patient? Register' : 'Back to login'}
            </button>
          )}
          <button type="button" className="red" disabled={busy} onClick={() => run(guest, '/patient?emergency=1')}>Emergency Login</button>
          <div className="note">
            Demo {role}: <button type="button" className="link" onClick={() => { setEmail(DEMO[role]); setPass('Demo@123'); setMode('login') }}>{DEMO[role]}</button> / Demo@123
          </div>
        </form>
      </div>
    </div>
  )
}
