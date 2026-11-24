import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { api } from '../api.js'

const ROLES = [
  ['patient', 'Patient'],
  ['staff', 'Staff'],
  ['doctor', 'Doctor'],
  ['admin', 'Administrator'],
]

export default function Login() {
  const {
    user,
    login,
    register,
    registerRole,
    bootstrapAdmin,
  } = useStore()

  const navigate = useNavigate()

  const [role, setRole] = useState('patient')
  const [mode, setMode] = useState('login')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [hospitalId, setHospitalId] = useState('')
  const [designation, setDesignation] = useState('Nurse')
  const [bootstrapKey, setBootstrapKey] = useState('')

  const [hospitals, setHospitals] = useState([])
  const [loadingHospitals, setLoadingHospitals] = useState(false)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  // Redirect only when the user has a valid login session.
  useEffect(() => {
    if (user) {
      navigate('/' + user.role, { replace: true })
    }
  }, [user, navigate])

  // Load hospitals when registration mode is selected.
  useEffect(() => {
    if (mode !== 'register') return

    let cancelled = false

    const fetchHospitals = async () => {
      setLoadingHospitals(true)
      setError('')

      try {
        const r = await api.get('/hospitals')
        const list = Array.isArray(r.data) ? r.data : []

        if (!cancelled) {
          setHospitals(list)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Unable to load hospitals')
        }
      } finally {
        if (!cancelled) {
          setLoadingHospitals(false)
        }
      }
    }

    if (['patient', 'staff', 'doctor'].includes(role)) {
      fetchHospitals()
    }

    return () => {
      cancelled = true
    }
  }, [mode, role])

  // LOGIN
  const handleLogin = async () => {
    setError('')
    setSuccess('')
    setBusy(true)

    try {
      const loggedInUser = await login(
        email.trim(),
        pass,
        role
      )

      navigate('/' + loggedInUser.role, { replace: true })
    } catch (e) {
      setError(e.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  // REGISTRATION
  const handleRegistration = async () => {
    setError('')
    setSuccess('')

    if (!name.trim()) {
      setError('Please enter your full name')
      return
    }

    if (role !== 'admin' && !hospitalId) {
      setError('Please select a hospital')
      return
    }

    if (pass.length < (role === 'admin' ? 12 : 8)) {
      setError(
        role === 'admin'
          ? 'Administrator password must be at least 12 characters'
          : 'Password must be at least 8 characters'
      )
      return
    }

    const form = {
      full_name: name.trim(),
      email: email.trim(),
      password: pass,
      hospital_id: Number(hospitalId),
    }

    setBusy(true)

    try {
      if (role === 'patient') {
        await register(form)
      } else if (role === 'staff' || role === 'doctor') {
        await registerRole({
          ...form,
          role,
          designation: role === 'doctor' ? 'Doctor' : designation,
        })
      } else if (role === 'admin') {
        await bootstrapAdmin({
          ...form,
          bootstrap_key: bootstrapKey,
        })
      }

      // Registration is successful, but no session is created.
      setSuccess(
        'Account created successfully! Please login using your email and password.'
      )

      // Switch back to login mode.
      setMode('login')

      // Keep email so the user can log in immediately.
      setPass('')
      setName('')
      setHospitalId('')
      setBootstrapKey('')
      setDesignation('Nurse')

    } catch (e) {
      setError(e.message || 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  // FORM SUBMISSION
  const submit = (e) => {
    e.preventDefault()

    if (mode === 'register') {
      handleRegistration()
    } else {
      handleLogin()
    }
  }

  const canRegister = [
    'patient',
    'staff',
    'doctor',
    'admin',
  ].includes(role)

  return (
    <div className="login">
      <div className="left">
        MedNexus
      </div>

      <div className="right">
        <form onSubmit={submit}>
          {/* ROLE SELECTION */}
          <div className="roles">
            {ROLES.map(([r, label]) => (
              <button
                type="button"
                key={r}
                className={role === r ? 'on' : ''}
                disabled={busy}
                onClick={() => {
                  setRole(r)
                  setMode('login')
                  setError('')
                  setSuccess('')
                  setName('')
                  setEmail('')
                  setPass('')
                  setHospitalId('')
                  setBootstrapKey('')
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* REGISTRATION FIELDS */}
          {mode === 'register' && (
            <>
              <input
                type="text"
                placeholder="Full name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              {/* HOSPITAL */}
              {role !== 'admin' && (
                <select
                  required
                  value={hospitalId}
                  onChange={(e) => setHospitalId(e.target.value)}
                  disabled={loadingHospitals || busy}
                >
                  <option value="">
                    {loadingHospitals
                      ? 'Loading hospitals...'
                      : 'Choose hospital'}
                  </option>

                  {hospitals.map((h) => (
                    <option
                      key={h.hospital_id}
                      value={h.hospital_id}
                    >
                      {h.hospital_name}
                      {h.district
                        ? ` — ${h.district}`
                        : ''}
                    </option>
                  ))}
                </select>
              )}

              {/* STAFF DESIGNATION */}
              {role === 'staff' && (
                <select
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                >
                  <option>Nurse</option>
                  <option>Technician</option>
                  <option>Paramedic</option>
                  <option>Other</option>
                </select>
              )}

              {/* ADMIN BOOTSTRAP KEY */}
              {role === 'admin' && (
                <input
                  type="password"
                  placeholder="Administrator bootstrap key"
                  required
                  value={bootstrapKey}
                  onChange={(e) => setBootstrapKey(e.target.value)}
                />
              )}
            </>
          )}

          {/* EMAIL */}
          <input
            type="email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {/* PASSWORD */}
          <input
            type="password"
            placeholder="Password"
            required
            minLength={
              mode === 'register'
                ? role === 'admin'
                  ? 12
                  : 8
                : undefined
            }
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />

          {/* ERROR */}
          {error && (
            <div className="err">
              {error}
            </div>
          )}

          {/* SUCCESS */}
          {success && (
            <div
              className="success"
              style={{
                padding: '10px',
                marginBottom: '12px',
                borderRadius: '8px',
                background: '#e8f5e9',
                color: '#246b36',
              }}
            >
              {success}
            </div>
          )}

          {/* MAIN BUTTON */}
          <button
            type="submit"
            disabled={busy || loadingHospitals}
          >
            {busy
              ? 'Please wait...'
              : mode === 'register'
                ? `Create ${
                    role === 'admin'
                      ? 'administrator'
                      : role
                  } account`
                : 'Login'}
          </button>

          {/* REGISTER / BACK BUTTON */}
          {canRegister && (
            <button
              type="button"
              className="light"
              disabled={busy}
              onClick={() => {
                setMode(
                  mode === 'login'
                    ? 'register'
                    : 'login'
                )
                setError('')
                setSuccess('')
                setHospitalId('')
              }}
            >
              {mode === 'login'
                ? role === 'admin'
                  ? 'First administrator setup'
                  : `New ${role}? Register`
                : 'Back to login'}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}