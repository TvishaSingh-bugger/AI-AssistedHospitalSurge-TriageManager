import { createContext, useContext, useReducer, useEffect } from 'react'
import { SEED_H, SEED_P, SEED_U, needKeys, holds, newId } from './data.js'

const K = { H: 'mn_r_h', P: 'mn_r_p', RX: 'mn_r_rx', US: 'mn_r_us', S: 'mn_r_s', PR: 'mn_r_pr', hid: 'mn_r_hid', user: 'mn_r_user' }

const load = (k, d) => {
  try {
    const v = JSON.parse(localStorage.getItem(k))
    return v ?? d
  } catch {
    return d
  }
}

const init = () => {
  const H = load(K.H, SEED_H)
  return {
    H,
    P: load(K.P, SEED_P),
    RX: load(K.RX, []),
    US: load(K.US, SEED_U),
    S: load(K.S, { threshold: 30, range: 10 }),
    PR: load(K.PR, {}),
    hid: load(K.hid, H[0].id),
    user: load(K.user, null),
  }
}

const adjust = (H, p, delta) =>
  H.map((h) => {
    if (h.id !== p.hid) return h
    const n = { ...h }
    needKeys(p.need).forEach((k) => {
      n[k] = [Math.min(h[k][1], Math.max(0, h[k][0] + delta)), h[k][1]]
    })
    return n
  })

function reducer(s, a) {
  switch (a.type) {
    case 'login':
      return { ...s, user: a.user }
    case 'logout':
      return { ...s, user: null }
    case 'setHid':
      return { ...s, hid: a.hid }
    case 'addPatient': {
      const p = { age: '', dept: 'General Medicine', need: 'None', status: 'Waiting', time: Date.now(), ...a.p }
      p.id = newId(s.P, p.type)
      return { ...s, P: [...s.P, p] }
    }
    case 'setStatus': {
      const p = s.P.find((x) => x.id === a.id)
      if (!p) return s
      const np = { ...p, status: a.status }
      const before = holds(p)
      const after = holds(np)
      let H = s.H
      if (!before && after) H = adjust(H, p, -1)
      if (before && !after) H = adjust(H, p, 1)
      return { ...s, H, P: s.P.map((x) => (x.id === p.id ? np : x)) }
    }
    case 'removePatient': {
      const p = s.P.find((x) => x.id === a.id)
      if (!p) return s
      const H = holds(p) ? adjust(s.H, p, 1) : s.H
      return { ...s, H, P: s.P.filter((x) => x.id !== a.id) }
    }
    case 'saveRes': {
      const fix = (h) => {
        const n = { ...h }
        ;['icu', 'vent', 'oxy', 'beds', 'blood'].forEach((k) => {
          const t = Math.max(0, +n[k][1] || 0)
          n[k] = [Math.min(t, Math.max(0, +n[k][0] || 0)), t]
        })
        return n
      }
      return { ...s, H: s.H.map((h) => { const x = a.H.find((y) => y.id === h.id); return x ? fix(x) : h }) }
    }
    case 'addRx':
      return { ...s, RX: [...s.RX, a.rx] }
    case 'addHospital': {
      const id = Math.max(...s.H.map((h) => h.id)) + 1
      return { ...s, H: [...s.H, { id, name: a.name, dist: a.dist || 1, icu: [5, 10], vent: [3, 8], oxy: [10, 20], beds: [20, 50], blood: [8, 15] }] }
    }
    case 'delHospital': {
      if (s.H.length < 2) return s
      const H = s.H.filter((h) => h.id !== a.id)
      return { ...s, H, P: s.P.filter((p) => p.hid !== a.id), hid: s.hid === a.id ? H[0].id : s.hid }
    }
    case 'addUser':
      return { ...s, US: [...s.US, { id: Date.now(), ...a.u }] }
    case 'delUser':
      return { ...s, US: s.US.filter((u) => u.id !== a.id) }
    case 'saveSettings':
      return { ...s, S: a.S }
    case 'saveProfile':
      return { ...s, PR: { ...s.PR, [a.key]: a.data } }
    case 'reset':
      return { H: SEED_H, P: SEED_P, RX: [], US: SEED_U, S: { threshold: 30, range: 10 }, PR: {}, hid: SEED_H[0].id, user: s.user }
    default:
      return s
  }
}

const Ctx = createContext(null)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, init)

  useEffect(() => {
    Object.entries(K).forEach(([field, key]) => {
      if (field === 'user' && !state.user) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(state[field]))
    })
  }, [state])

  return <Ctx.Provider value={{ ...state, dispatch }}>{children}</Ctx.Provider>
}

export const useStore = () => useContext(Ctx)
