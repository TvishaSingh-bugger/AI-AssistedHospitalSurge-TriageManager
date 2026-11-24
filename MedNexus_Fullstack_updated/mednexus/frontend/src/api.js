// Small fetch wrapper for the MedNexus backend.
// Requests go to /api/... (proxied to Express by Vite in development).
// Set VITE_API_URL (see .env.example) only if the backend is hosted somewhere else.
const BASE = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'mn_token'

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

async function request(method, path, body) {
  const token = getToken()
  let res
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Cannot reach the server. Is the backend running on port 5000?')
  }
  let json = {}
  try { json = await res.json() } catch { /* empty body */ }
  if (res.status === 401 && token && !path.startsWith('/auth/')) {
    setToken(null)
    window.dispatchEvent(new Event('mn-unauthorized'))
  }
  if (!res.ok || json.success === false) {
    const err = new Error(json.message || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return json
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
}
