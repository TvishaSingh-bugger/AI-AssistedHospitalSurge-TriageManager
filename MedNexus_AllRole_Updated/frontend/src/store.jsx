import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react'
import { api, getToken, setToken } from './api.js'

const Ctx = createContext(null)

const loadSettings = () => {
  try {
    return {
      threshold: 30,
      district: '',
      ...(JSON.parse(localStorage.getItem('mn_settings')) || {}),
    }
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
  const [me, setMe] = useState({
    records: [],
    prescriptions: [],
    health: {},
  })
  const [S, setS] = useState(loadSettings)
  const [toast, setToast] = useState(null)

  const toastTimer = useRef(null)

  const notify = useCallback((text, bad = false) => {
    setToast({ text, bad })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }, [])

  // Session
  const startSession = useCallback((token, u) => {
    setToken(token)
    setUser(u)
    setHidState(u?.hospital_id || null)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setH([])
    setRecords([])
    setMe({ records: [], prescriptions: [], health: {} })
    setHidState(null)
  }, [])

  // Restore session
  useEffect(() => {
    const token = getToken()

    if (!token) {
      setBooting(false)
      return
    }

    api.get('/auth/me')
      .then((r) => {
        if (r.user) {
          setUser(r.user)
          setHidState(r.user.hospital_id || null)
        } else {
          setToken(null)
        }
      })
      .catch(() => {
        setToken(null)
        setUser(null)
      })
      .finally(() => setBooting(false))
  }, [])

  // Handle unauthorized requests
  useEffect(() => {
    const onUnauthorized = () => {
      logout()
      notify('Session expired. Please log in again.', true)
    }

    window.addEventListener('mn-unauthorized', onUnauthorized)

    return () => {
      window.removeEventListener('mn-unauthorized', onUnauthorized)
    }
  }, [logout, notify])

  // Authentication
  const login = async (email, password, role) => {
    const r = await api.post('/auth/login', {
      email,
      password,
      role,
    })

    startSession(r.token, r.user)
    return r.user
  }

  // Patient registration
  // Registration does NOT start a login session.
  const register = async (form) => {
    return await api.post('/auth/register', form)
  }

  // Staff and Doctor registration
  // Registration does NOT start a login session.
  const registerRole = async (form) => {
    return await api.post('/auth/register-role', form)
  }

  // Administrator registration
  // Registration does NOT start a login session.
  const bootstrapAdmin = async (form) => {
    return await api.post('/auth/bootstrap-admin', form)
  }

  // Emergency Login
  // Guest login intentionally starts a session.
  const guest = async () => {
    const r = await api.post('/auth/guest')
    startSession(r.token, r.user)
    return r.user
  }

  // Load actual hospitals from backend
  const loadHospitals = useCallback(async () => {
    const r = await api.get('/portal/hospitals')
    const hospitals = Array.isArray(r.data) ? r.data : []

    setH(hospitals)

    setHidState((current) => {
      if (current && hospitals.some((h) => h.id === current)) {
        return current
      }

      if (user?.hospital_id && hospitals.some((h) => h.id === user.hospital_id)) {
        return user.hospital_id
      }

      return hospitals.length ? hospitals[0].id : null
    })

    return hospitals
  }, [user])

  // Load staff/doctor hospital records
  const loadRecords = useCallback(async () => {
    if (!user || !['staff', 'doctor'].includes(user.role) || !hid) {
      setRecords([])
      return []
    }

    const r = await api.get(`/portal/hospitals/${hid}/records`)
    const data = Array.isArray(r.data) ? r.data : []

    setRecords(data)
    return data
  }, [user, hid])

  // Load patient information
  const loadMe = useCallback(async () => {
    if (!user || user.role !== 'patient') {
      setMe({ records: [], prescriptions: [], health: {} })
      return
    }

    const r = await api.get('/portal/me')

    setMe({
      records: Array.isArray(r.records) ? r.records : [],
      prescriptions: Array.isArray(r.prescriptions) ? r.prescriptions : [],
      health: r.health || {},
    })

    return r
  }, [user])

  // Refresh application data
  const refresh = useCallback(async () => {
    try {
      await Promise.all([
        loadHospitals(),
        loadRecords(),
        loadMe(),
      ])
    } catch (e) {
      if (e.status !== 401) {
        notify(e.message || 'Failed to refresh data', true)
      }
    }
  }, [loadHospitals, loadRecords, loadMe, notify])

  // Refresh data for logged-in users
  useEffect(() => {
    if (!user) {
      setRecords([])
      setMe({ records: [], prescriptions: [], health: {} })
      return
    }

    refresh()

    const interval = setInterval(refresh, POLL_MS)

    return () => clearInterval(interval)
  }, [user, hid, refresh])

  // Run an action and refresh data
  const act = useCallback(async (fn, okText) => {
    try {
      const r = await fn()

      const waiting = r?.outcome === 'WAITING'

      notify(
        okText || r?.message || 'Operation completed successfully',
        waiting
      )

      await refresh()
      return r || true
    } catch (e) {
      notify(e.message || 'Operation failed', true)
      return null
    }
  }, [notify, refresh])

  // Hospital selection
  const setHid = useCallback((id) => {
    setHidState(id)
  }, [])

  // Save user preferences
  const saveSettings = useCallback((next) => {
    setS(next)

    try {
      localStorage.setItem('mn_settings', JSON.stringify(next))
    } catch {
      // Storage unavailable
    }
  }, [])

  const hospital = H.find((h) => h.id === hid) || null

  return (
    <Ctx.Provider
      value={{
        user,
        booting,
        H,
        hid,
        hospital,
        setHid,
        records,
        me,
        S,
        saveSettings,
        toast,
        notify,
        act,
        refresh,
        login,
        register,
        registerRole,
        bootstrapAdmin,
        guest,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export const useStore = () => useContext(Ctx)