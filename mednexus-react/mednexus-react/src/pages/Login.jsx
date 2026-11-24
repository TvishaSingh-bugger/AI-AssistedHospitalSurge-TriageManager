import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'

const ROLES = [['patient', 'Patient'], ['staff', 'Staff'], ['doctor', 'Doctor'], ['admin', 'Administrator']]

export default function Login() {
  const { dispatch } = useStore()
  const navigate = useNavigate()
  const [role, setRole] = useState('patient')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const n = email.split('@')[0]
    dispatch({ type: 'login', user: { role, name: n.charAt(0).toUpperCase() + n.slice(1) } })
    navigate('/' + role)
  }
  const emergency = () => {
    dispatch({ type: 'login', user: { role: 'patient', name: 'Emergency Patient' } })
    navigate('/patient?emergency=1')
  }

  return (
    <div className="login">
      <div className="left">MedNexus</div>
      <div className="right">
        <form onSubmit={submit}>
          <div className="roles">
            {ROLES.map(([r, label]) => (
              <button type="button" key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{label}</button>
            ))}
          </div>
          <input placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" required value={pass} onChange={(e) => setPass(e.target.value)} />
          <button type="submit">Login</button>
          <button type="button" className="red" onClick={emergency}>Emergency Login</button>
        </form>
      </div>
    </div>
  )
}
