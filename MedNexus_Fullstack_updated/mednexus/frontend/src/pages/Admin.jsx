import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Layout, Card, Table, AlertList, HospPicker, ResEditor, ReportPage, StatTag } from '../ui.jsx'
import { getAlerts } from '../data.js'

const NAV = [['dash', 'Admin Dashboard'], ['hosp', 'Hospitals'], ['appts', 'Appointments'], ['users', 'Users'], ['res', 'Resources'], ['set', 'System Settings'], ['rep', 'Reports']]

// Real data: emergency arrivals per day (and critical ones) for the last 14 days.
function Chart({ trend }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    const x = c.getContext('2d')
    const W = c.width
    const Ht = c.height
    x.clearRect(0, 0, W, Ht)
    x.strokeStyle = '#e2e8f0'
    for (let i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(0, (i * (Ht - 20)) / 4); x.lineTo(W, (i * (Ht - 20)) / 4); x.stroke()
    }
    if (!trend.length) return
    const max = Math.max(1, ...trend.map((t) => t.cases))
    const plot = (key, col) => {
      x.strokeStyle = col
      x.lineWidth = 2
      x.beginPath()
      trend.forEach((t, i) => {
        const px = trend.length === 1 ? W / 2 : (i * (W - 20)) / (trend.length - 1) + 10
        const py = Ht - 20 - (t[key] / max) * (Ht - 30)
        i ? x.lineTo(px, py) : x.moveTo(px, py)
      })
      x.stroke()
    }
    plot('cases', '#2563eb')
    plot('critical', '#dc2626')
    x.fillStyle = '#64748b'
    x.font = '11px Arial'
    trend.forEach((t, i) => {
      if (i % 2 === 0) x.fillText(t.day.slice(5), trend.length === 1 ? W / 2 : (i * (W - 20)) / (trend.length - 1) + 2, Ht - 4)
    })
  }, [trend])
  return <canvas ref={ref} width="900" height="220" style={{ width: '100%', height: 220 }} />
}

function Dash() {
  const { H, S } = useStore()
  const [ov, setOv] = useState(null)
  useEffect(() => { api.get('/admin/overview').then((r) => setOv(r.data)).catch(() => setOv({ trend: [] })) }, [])
  const units = H.reduce((s, h) => s + ['icu', 'vent', 'oxy', 'beds', 'blood'].reduce((a, k) => a + h[k][1], 0), 0)
  const busiest = [...H].sort((a, b) => b.active - a.active).slice(0, 8)
  const uptime = ov && ov.uptime_seconds != null ? (ov.uptime_seconds > 3600 ? `${(ov.uptime_seconds / 3600).toFixed(1)} h` : `${Math.round(ov.uptime_seconds / 60)} min`) : '-'
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Administrator Dashboard</h2>
      <div className="grid">
        <Card label="Total Hospitals" value={H.length} cls="s-blue" />
        <Card label="Registered Users" value={ov && ov.users != null ? ov.users : '-'} cls="s-green" />
        <Card label="Total Resource Units" value={units} cls="s-purple" />
        <Card label="Active Cases Now" value={ov && ov.active_cases != null ? ov.active_cases : '-'} cls="s-red" />
        <Card label="API Uptime" value={uptime} cls="s-orange" />
      </div>
      <div className="two">
        <div>
          <h2 style={{ marginTop: 0 }}>Busiest Hospitals Right Now</h2>
          <Table
            heads={['Hospital', 'Active', 'ICU', 'Ventilators', 'Oxygen']}
            rows={busiest.map((h) => [h.name, h.active, h.icu.join(' / '), h.vent.join(' / '), h.oxy.join(' / ')])}
          />
        </div>
        <div className="card">
          <b>Lowest Resource Alerts</b>
          <AlertList items={getAlerts(H, S, 8)} />
        </div>
      </div>
      <div className="card">
        <b>Emergency arrivals per day</b> <span style={{ color: '#2563eb' }}>&nbsp; All cases</span> <span style={{ color: '#dc2626' }}>&nbsp; Critical</span>
        <br />
        {ov ? <Chart trend={ov.trend || []} /> : <div className="spin">Loading...</div>}
        {ov && ov.latest_case_time && <div className="note">Latest recorded case: {new Date(ov.latest_case_time).toLocaleString('en-GB')}</div>}
      </div>
    </>
  )
}

function Hosp() {
  const { H, act } = useStore()
  const [f, setF] = useState({ name: '', district: '', type: 'Government', total_beds: '' })
  const [q, setQ] = useState('')
  const add = async () => {
    if (!f.name.trim()) return
    const ok = await act(() => api.post('/admin/hospitals', f), 'Hospital added')
    if (ok) setF({ name: '', district: '', type: 'Government', total_beds: '' })
  }
  const remove = (h) => act(() => api.del(`/admin/hospitals/${h.id}`), 'Hospital removed')
  const rows = H.filter((h) => (h.name + h.district).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Hospitals</h2>
      <div className="card form">
        <input placeholder="Hospital name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input placeholder="District" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} />
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['Government', 'Private', 'Trust', 'Other'].map((t) => <option key={t}>{t}</option>)}</select>
        <input type="number" min="1" placeholder="Total beds" style={{ width: 120 }} value={f.total_beds} onChange={(e) => setF({ ...f, total_beds: e.target.value })} />
        <button onClick={add}>Add</button>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input style={{ width: 280 }} placeholder="Search hospitals or district" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="note">{rows.length} of {H.length} hospitals{rows.length > 60 ? ' (showing first 60)' : ''}. Only hospitals added here can be removed; dataset hospitals keep their history.</span>
      </div>
      <Table
        heads={['Hospital', 'District', 'Type', 'Beds', 'Active patients', '']}
        rows={rows.slice(0, 60).map((h) => [h.name, h.district, h.type, h.total_beds ?? '-', h.active,
          h.code.startsWith('ADM-') ? <button className="light small" onClick={() => remove(h)}>Remove</button> : ''])}
      />
    </>
  )
}

function Appts() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const load = () => api.get('/portal/admin/appointments').then((r) => setRows(r.data)).catch(() => setRows([]))
  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])
  if (!rows) return <div className="spin">Loading...</div>
  const shown = rows.filter((r) =>
    (!st || r.appointment_status === st) &&
    `${r.patient_name} ${r.doctor_name} ${r.hospital_name}`.toLowerCase().includes(q.toLowerCase()))
  const when = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  return (
    <>
      <h2 style={{ marginTop: 0 }}>All Appointments</h2>
      <div className="row">
        <input style={{ width: 280 }} placeholder="Search patient, doctor or hospital" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: 'auto' }} value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">All statuses</option>
          {['Booked', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="note">{shown.length} of {rows.length} appointments</span>
      </div>
      <Table
        heads={['ID', 'Patient', 'Doctor', 'Hospital', 'Date / Time', 'Reason', 'Status', 'Booked on']}
        rows={shown.map((r) => [`APT-${r.appointment_id}`, r.patient_name, r.doctor_name, r.hospital_name, when(r.appointment_date), r.reason || '-', <StatTag s={r.appointment_status} />, when(r.created_at)])}
        empty="No appointments yet"
      />
    </>
  )
}

function Users() {
  const { H, act } = useStore()
  const blank = { full_name: '', email: '', password: '', role: 'patient', hospital_id: '' }
  const [f, setF] = useState(blank)
  const [users, setUsers] = useState([])
  const [guests, setGuests] = useState(0)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const load = () => api.get('/admin/users').then((r) => { setUsers(r.data); setGuests(r.guest_accounts) })
  useEffect(() => { load() }, [])
  const needsHospital = f.role === 'staff' || f.role === 'doctor'

  const add = async () => {
    if (!f.full_name.trim() || !f.email.trim()) return
    const ok = await act(() => api.post('/admin/users', f), 'User created')
    if (ok) { setF(blank); load() }
  }
  const remove = async (u) => { if (await act(() => api.del(`/admin/users/${u.user_id}`), 'User removed')) load() }
  const sorted = [...H].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Users</h2>
      <div className="card form">
        <input placeholder="Name" value={f.full_name} onChange={set('full_name')} />
        <input placeholder="Email" value={f.email} onChange={set('email')} />
        <input type="password" placeholder="Password (min 6)" value={f.password} onChange={set('password')} />
        <select value={f.role} onChange={set('role')}><option>patient</option><option>staff</option><option>doctor</option><option>admin</option></select>
        {needsHospital && (
          <select value={f.hospital_id} onChange={set('hospital_id')} style={{ maxWidth: 260 }}>
            <option value="">Choose hospital</option>
            {sorted.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
        <button onClick={add}>Add</button>
      </div>
      <div className="note" style={{ margin: '8px 0' }}>{guests} temporary emergency-login guest account(s) are not listed.</div>
      <Table
        heads={['Name', 'Email', 'Role', 'Hospital', '']}
        rows={users.map((u) => [u.full_name, u.email, u.role, u.hospital_name || '-', <button className="light small" onClick={() => remove(u)}>Remove</button>])}
      />
    </>
  )
}

function Res() {
  const { hospital } = useStore()
  if (!hospital) return <div className="spin">Loading...</div>
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Resources</h2>
      <ResEditor key={JSON.stringify([hospital.id, hospital.icu, hospital.vent, hospital.oxy, hospital.beds, hospital.blood])} hospital={hospital} />
    </>
  )
}

function Settings() {
  const { S, saveSettings, notify } = useStore()
  const [f, setF] = useState(S)
  return (
    <>
      <h2 style={{ marginTop: 0 }}>System Settings</h2>
      <div className="card form" style={{ maxWidth: 480, flexDirection: 'column', alignItems: 'stretch' }}>
        <label>Low resource alert (% free)
          <input type="number" min="0" max="100" value={f.threshold} onChange={(e) => setF({ ...f, threshold: +e.target.value })} />
        </label>
        <button onClick={() => { saveSettings(f); notify('Settings saved') }}>Save</button>
        <div className="note">This threshold is stored in this browser and controls which resource alerts are shown.</div>
      </div>
    </>
  )
}

function Rep() {
  return <ReportPage />
}

export default function Admin() {
  const [page, setPage] = useState('dash')
  const View = { dash: Dash, hosp: Hosp, appts: Appts, users: Users, res: Res, set: Settings, rep: Rep }[page]
  return (
    <Layout nav={NAV} page={page} setPage={setPage}>
      <View />
    </Layout>
  )
}
