import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { api, getToken, setToken } from './api.js'

const Ctx = createContext(null)

const loadSettings = () => {
  try {
    return { threshold: 30, district: '', ...(JSON.parse(localStorage.getItem('mn_settings')) || {}) }
  } catch {
    return { threshold: 30, district: '' }
  }
}

const POLL_MS = 8000

export function StoreProvider({ children }) {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(() => !!getToken())
  const [H, setH] = useState([])
  const [hid, setHidState] = useState(null)
  const [records, setRecords] = useState([])
  const [me, setMe] = useState({ records: [], prescriptions: [], health: {} })
  const [S, setS] = useState(loadSettings)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const notify = useCallback((text, bad = false) => {
    setToast({ text, bad })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }, [])

  // ---- session -------------------------------------------------------------
  const startSession = useCallback((token, u) => {
    setToken(token)
    setUser(u)
    setHidState(u.hospital_id || null)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setRecords([])
    setMe({ records: [], prescriptions: [], health: {} })
    setHidState(null)
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    api.get('/auth/me')
      .then((r) => { setUser(r.user); setHidState(r.user.hospital_id || null) })
      .catch(() => setToken(null))
      .finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    const onUnauthorized = () => { logout(); notify('Session expired - please log in again', true) }
    window.addEventListener('mn-unauthorized', onUnauthorized)
    return () => window.removeEventListener('mn-unauthorized', onUnauthorized)
  }, [logout, notify])

  const login = async (email, password, role) => {
    const r = await api.post('/auth/login', { email, password, role })
    startSession(r.token, r.user)
    return r.user
  }
  const register = async (form) => {
    const r = await api.post('/auth/register', form)
    startSession(r.token, r.user)
    return r.user
  }
  const guest = async () => {
    const r = await api.post('/auth/guest')
    startSession(r.token, r.user)
    return r.user
  }

  // ---- data loading --------------------------------------------------------
  const loadHospitals = useCallback(async () => {
    const r = await api.get('/portal/hospitals')
    setH(r.data)
    setHidState((cur) => cur || (r.data[0] && r.data[0].id) || null)
  }, [])

  const loadRecords = useCallback(async () => {
    if (!user || !['staff', 'doctor'].includes(user.role) || !hid) return
    const r = await api.get(`/portal/hospitals/${hid}/records`)
    setRecords(r.data)
  }, [user, hid])

  const loadMe = useCallback(async () => {
    if (!user || user.role !== 'patient') return
    const r = await api.get('/portal/me')
    setMe(r)
  }, [user])

  const refresh = useCallback(async () => {
    try {
      await Promise.all([loadHospitals(), loadRecords(), loadMe()])
    } catch (e) {
      if (e.status !== 401) notify(e.message, true)
    }
  }, [loadHospitals, loadRecords, loadMe, notify])

  useEffect(() => {
    if (!user) return undefined
    setRecords([])
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [user, hid, refresh])

  // Runs a mutation, shows its result, reloads the data. Returns the response or null on error.
  const act = useCallback(async (fn, okText) => {
    try {
      const r = await fn()
      const warn = r && (r.outcome === 'WAITING')
      notify(okText || (r && r.message) || 'Done', warn)
      await refresh()
      return r || true
    } catch (e) {
      notify(e.message, true)
      return null
    }
  }, [notify, refresh])

  const setHid = (id) => setHidState(id)
  const saveSettings = (next) => {
    setS(next)
    try { localStorage.setItem('mn_settings', JSON.stringify(next)) } catch { /* private mode */ }
  }

  const hospital = H.find((h) => h.id === hid) || null

  return (
    <Ctx.Provider value={{
      user, booting, H, hid, hospital, setHid, records, me, S, saveSettings,
      toast, notify, act, refresh, login, register, guest, logout,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useStore = () => useContext(Ctx)
