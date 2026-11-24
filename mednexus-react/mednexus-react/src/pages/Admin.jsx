import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store.jsx'
import { Layout, Card, Table, AlertList, ResEditor, ReportPage } from '../ui.jsx'
import { getAlerts } from '../data.js'

const NAV = [['dash', 'Admin Dashboard'], ['hosp', 'Hospitals'], ['users', 'Users'], ['res', 'Resources'], ['set', 'System Settings'], ['rep', 'Reports']]

function Chart() {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    const x = c.getContext('2d')
    const W = c.width
    const Ht = c.height
    x.clearRect(0, 0, W, Ht)
    x.strokeStyle = '#e2e8f0'
    for (let i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(0, (i * Ht) / 4); x.lineTo(W, (i * Ht) / 4); x.stroke()
    }
    ;[['#2563eb', 0], ['#16a34a', 2]].forEach(([col, ph]) => {
      x.strokeStyle = col
      x.lineWidth = 2
      x.beginPath()
      for (let i = 0; i <= 24; i++) {
        const val = 0.5 + 0.25 * Math.sin(i / 3 + ph) + 0.08 * Math.sin(i * 1.7 + ph)
        const px = (i * W) / 24
        const py = Ht - val * Ht
        i ? x.lineTo(px, py) : x.moveTo(px, py)
      }
      x.stroke()
    })
  }, [])
  return <canvas ref={ref} width="900" height="200" style={{ width: '100%', height: 200 }} />
}

function Dash() {
  const { H, P, US, S } = useStore()
  const total = H.reduce((s, h) => s + ['icu', 'vent', 'oxy', 'beds', 'blood'].reduce((a, k) => a + h[k][1], 0), 0)
  const news = [...P].sort((a, b) => b.time - a.time).slice(0, 2).map((p) => ({ lvl: 'blue', text: `New patient registered - ${p.id}` }))
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Administrator Dashboard</h2>
      <div className="grid">
        <Card label="Total Hospitals" value={H.length} cls="s-blue" />
        <Card label="Total Users" value={US.length} cls="s-green" />
        <Card label="Total Resources" value={total} cls="s-purple" />
        <Card label="System Uptime" value="99.9%" cls="s-orange" />
      </div>
      <div className="two">
        <div>
          <h2 style={{ marginTop: 0 }}>Hospital-wise Resource Availability</h2>
          <Table heads={['Hospital', 'ICU Beds', 'Ventilators', 'Oxygen Cylinders', 'Blood Units']} rows={H.map((h) => [h.name, h.icu.join(' / '), h.vent.join(' / '), h.oxy.join(' / '), h.blood.join(' / ')])} />
        </div>
        <div className="card">
          <b>Recent System Alerts</b>
          <AlertList items={getAlerts(H, P, S).concat(news)} />
        </div>
      </div>
      <div className="card">
        <b>System Performance</b> <span style={{ color: '#2563eb' }}>&nbsp; CPU</span> <span style={{ color: '#16a34a' }}>&nbsp; Memory</span>
        <br />
        <Chart />
      </div>
    </>
  )
}

function Hosp() {
  const { H, P, dispatch } = useStore()
  const [f, setF] = useState({ name: '', dist: '' })
  const add = () => {
    if (!f.name.trim()) return
    dispatch({ type: 'addHospital', name: f.name, dist: +f.dist })
    setF({ name: '', dist: '' })
  }
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Hospitals</h2>
      <div className="card form">
        <input placeholder="Hospital name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input type="number" step="0.1" placeholder="Distance (km)" value={f.dist} onChange={(e) => setF({ ...f, dist: e.target.value })} />
        <button onClick={add}>Add</button>
      </div>
      <br />
      <Table
        heads={['Hospital', 'Distance (km)', 'Patients', '']}
        rows={H.map((h) => [h.name, h.dist, P.filter((p) => p.hid === h.id && p.status !== 'Completed').length,
          <button className="light" onClick={() => dispatch({ type: 'delHospital', id: h.id })}>Remove</button>])}
      />
    </>
  )
}

function Users() {
  const { H, US, dispatch } = useStore()
  const blank = { name: '', email: '', role: 'patient', hid: 0 }
  const [f, setF] = useState(blank)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const add = () => {
    if (!f.name.trim()) return
    dispatch({ type: 'addUser', u: { ...f, hid: +f.hid } })
    setF(blank)
  }
  const hn = (id) => (H.find((h) => h.id === id) || {}).name || '-'
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Users</h2>
      <div className="card form">
        <input placeholder="Name" value={f.name} onChange={set('name')} />
        <input placeholder="Email" value={f.email} onChange={set('email')} />
        <select value={f.role} onChange={set('role')}><option>patient</option><option>staff</option><option>doctor</option><option>admin</option></select>
        <select value={f.hid} onChange={set('hid')}>
          <option value="0">-</option>
          {H.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <button onClick={add}>Add</button>
      </div>
      <br />
      <Table
        heads={['Name', 'Email', 'Role', 'Hospital', '']}
        rows={US.map((u) => [u.name, u.email, u.role, u.hid ? hn(u.hid) : '-', <button className="light" onClick={() => dispatch({ type: 'delUser', id: u.id })}>Remove</button>])}
      />
    </>
  )
}

function Res() {
  const { H } = useStore()
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Resources</h2>
      <ResEditor key={JSON.stringify(H)} list={H} />
    </>
  )
}

function Settings() {
  const { S, dispatch } = useStore()
  const [f, setF] = useState(S)
  return (
    <>
      <h2 style={{ marginTop: 0 }}>System Settings</h2>
      <div className="card form" style={{ maxWidth: 480, flexDirection: 'column', alignItems: 'stretch' }}>
        <label>Low resource alert (% free)
          <input type="number" min="0" max="100" value={f.threshold} onChange={(e) => setF({ ...f, threshold: +e.target.value })} />
        </label>
        <label>Default hospital range (km)
          <select value={f.range} onChange={(e) => setF({ ...f, range: +e.target.value })}>{[5, 10, 20].map((r) => <option key={r}>{r}</option>)}</select>
        </label>
        <button onClick={() => dispatch({ type: 'saveSettings', S: f })}>Save</button>
        <button className="light" onClick={() => window.confirm('Reset all data?') && dispatch({ type: 'reset' })}>Reset Data</button>
      </div>
    </>
  )
}

function Rep() {
  const { H } = useStore()
  return <ReportPage list={H} />
}

export const VIEWS = { dash: Dash, hosp: Hosp, users: Users, res: Res, set: Settings, rep: Rep }
export default function Admin() {
  const [page, setPage] = useState('dash')
  const View = { dash: Dash, hosp: Hosp, users: Users, res: Res, set: Settings, rep: Rep }[page]
  return (
    <Layout nav={NAV} page={page} setPage={setPage}>
      <View />
    </Layout>
  )
}
