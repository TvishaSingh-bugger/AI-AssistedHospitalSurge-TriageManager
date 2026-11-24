import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store.jsx'
import Login from './pages/Login.jsx'
import Patient from './pages/Patient.jsx'
import Staff from './pages/Staff.jsx'
import Doctor from './pages/Doctor.jsx'
import Admin from './pages/Admin.jsx'

function Protected({ role, children }) {
  const { user, booting } = useStore()
  if (booting) return <div className="spin">Loading...</div>
  if (!user || user.role !== role) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/patient" element={<Protected role="patient"><Patient /></Protected>} />
      <Route path="/staff" element={<Protected role="staff"><Staff /></Protected>} />
      <Route path="/doctor" element={<Protected role="doctor"><Doctor /></Protected>} />
      <Route path="/admin" element={<Protected role="admin"><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
