
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
const TOKEN_KEY = 'mn_token'

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const setToken = (token) => {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

async function request(method, path, body) {
  const token = getToken()

  let response

  try {
    response = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error(
      'Unable to connect to the backend. Check that the server and database are running.'
    )
  }

  let data

  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (response.status === 401 && token && !path.startsWith('/auth/')) {
    setToken(null)
    window.dispatchEvent(new Event('mn-unauthorized'))
  }

  if (!response.ok || data?.success === false) {
    const error = new Error(
      data?.message || `Server error (${response.status})`
    )

    error.status = response.status
    error.data = data

    throw error
  }

  return data ?? {}
}

export const api = {
  get: (path) => request('GET', path),

  post: (path, body = {}) => request('POST', path, body),

  put: (path, body = {}) => request('PUT', path, body),

  patch: (path, body = {}) => request('PATCH', path, body),

  del: (path) => request('DELETE', path),
}
