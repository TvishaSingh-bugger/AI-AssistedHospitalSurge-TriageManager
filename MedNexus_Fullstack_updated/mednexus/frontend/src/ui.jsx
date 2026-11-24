import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from './store.jsx'
import { api } from './api.js'
import { CASE_STATUSES, APPT_STATUSES, HEALTH, statusLabel, fmtDate, fmtTime } from './data.js'

export const SevTag = ({ s }) => (
  <span className={`tag ${s === 'Critical' || s === 'High' ? 'red-t' : s === 'Medium' ? 'orange-t' : 'green-t'}`}>{s}</span>
)
export const TypeTag = ({ t }) => <span className={`tag ${t === 'Emergency' ? 'red-t' : 'blue-t'}`}>{t}</span>
export const StatTag = ({ s }) => (
  <span className={`tag ${s === 'Waiting' ? 'orange-t' : s === 'Completed' ? 'green-t' : s === 'Cancelled' ? 'gray-t' : 'blue-t'}`}>{statusLabel(s)}</span>
)
export const HealthTag = ({ p }) => {
  const h = HEALTH[p.severity]
  return <span className={`tag ${h === 'Stable' ? 'green-t' : h === 'Observation' ? 'blue-t' : 'red-t'}`}>{h}</span>
}

export const Card = ({ label, value, cls = '' }) => (
  <div className={`card ${cls}`}>
    {label}
    <div className="stat">{value}</div>
  </div>
)

const barColor = (a, t) => {
  const r = t ? a / t : 0
  return r > 0.5 ? '#16a34a' : r > 0.2 ? '#f59e0b' : '#dc2626'
}
export const Bar = ({ a, t }) => (
  <div className="bar">
    <i style={{ width: `${t ? (a / t) * 100 : 0}%`, background: barColor(a, t) }} />
  </div>
)

export const Table = ({ heads, rows, empty = 'Nothing to show' }) => (
  <div className="wrap">
    <table>
      <thead>
        <tr>{heads.map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={heads.length} style={{ color: '#64748b' }}>{empty}</td></tr>}
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  </div>
)

export function Donut({ counts }) {
  const cols = ['#16a34a', '#dc2626', '#f59e0b', '#7c3aed']
  const names = ['Stable', 'Critical', 'High Risk', 'Observation']
  const tot = names.reduce((s, n) => s + (counts[n] || 0), 0)
  let acc = 0
  const parts = names.map((n, i) => {
    const d = tot ? ((counts[n] || 0) / tot) * 100 : 0
    const part = `${cols[i]} ${acc}% ${acc + d}%`
    acc += d
    return part
  })
  return (
    <div className="row" style={{ gap: 24 }}>
      <div className="donut" style={{ background: tot ? `conic-gradient(${parts.join(',')})` : '#e2e8f0' }}>
        <div>{tot}</div>
      </div>
      <div className="legend">
        {names.map((n, i) => (
          <div key={n}>
            <span style={{ background: cols[i] }} />
            {n}: {counts[n] || 0}
          </div>
        ))}
      </div>
    </div>
  )
}

export function AlertList({ items }) {
  if (!items.length) return <div className="alert">No active alerts</div>
  return items.map((x, i) => (
    <div className="alert" key={i}>
      <span className={`tag ${x.lvl}-t`}>!</span> {x.text}
    </div>
  ))
}

// Admins can switch hospital; staff and doctors are tied to their own hospital.
export function HospPicker() {
  const { user, H, hid, hospital, setHid } = useStore()
  if (user.role !== 'admin') {
    return <div className="row"><b>Hospital</b> {hospital ? hospital.name : '...'}</div>
  }
  const districts = [...new Set(H.map((h) => h.district))].sort()
  return (
    <div className="row">
      <b>Hospital</b>
      <select style={{ width: 340 }} value={hid || ''} onChange={(e) => setHid(+e.target.value)}>
        {districts.map((d) => (
          <optgroup key={d} label={d}>
            {H.filter((h) => h.district === d).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

// Changes the status of a case or appointment through the backend.
export function useSetStatus() {
  const { act } = useStore()
  return (p, status) => act(() => api.put(`/portal/records/${p.kind}/${p.id}/status`, { status }))
}

export function StatusSelect({ p }) {
  const setStatus = useSetStatus()
  const options = p.kind === 'case' ? CASE_STATUSES : APPT_STATUSES
  const done = p.status === 'Completed' || p.status === 'Cancelled'
  return (
    <select style={{ width: 'auto' }} value={p.status} disabled={done} onChange={(e) => setStatus(p, e.target.value)}>
      {!options.includes(p.status) && <option value={p.status} disabled>{statusLabel(p.status)}</option>}
      {options.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
    </select>
  )
}

// mode 'doctor' shows Start / Done buttons, otherwise a status dropdown
export function QueueTable({ list, mode }) {
  const setStatus = useSetStatus()
  const running = (p) => p.status === 'Running' || p.status === 'In Progress'
  const start = (p) => setStatus(p, p.kind === 'case' ? 'Running' : 'In Progress')
  return (
    <Table
      heads={['#', 'ID', 'Name', 'Type', 'Priority', 'Resource', 'Reason / Doctor', 'Date / Time', 'Status']}
      rows={list.map((p, i) => [
        i + 1, p.code, p.name, <TypeTag t={p.type} />, <SevTag s={p.severity} />, p.need,
        p.kind === 'appt' ? `${p.reason} (${p.dept})` : p.reason,
        `${fmtDate(p)} ${fmtTime(p)}`,
        mode === 'doctor'
          ? running(p)
            ? <button className="green" onClick={() => setStatus(p, 'Completed')}>Done</button>
            : <button onClick={() => start(p)}>Start</button>
          : <StatusSelect p={p} />,
      ])}
      empty="The queue is empty"
    />
  )
}

const FIELDS = [['icu', 'ICU Beds'], ['vent', 'Ventilators'], ['oxy', 'Oxygen'], ['beds', 'Beds'], ['blood', 'Blood']]

// Edits free / total counts of one hospital. Give it key={JSON.stringify(h)} so it resets when data changes.
export function ResEditor({ hospital }) {
  const { act } = useStore()
  const [d, setD] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, [...hospital[k]]])))
  const change = (k, i, val) => setD((prev) => ({ ...prev, [k]: prev[k].map((x, j) => (j === i ? val : x)) }))

  const save = async () => {
    const jobs = []
    for (const [k, label] of FIELDS) {
      const id = hospital.resource_ids[k]
      const [a, t] = [Number(d[k][0]), Number(d[k][1])]
      if (!id || (a === hospital[k][0] && t === hospital[k][1])) continue
      if (!Number.isInteger(a) || !Number.isInteger(t) || a < 0 || t < 0 || a > t) {
        return act(async () => { throw new Error(`${label}: free must be a whole number between 0 and total`) })
      }
      jobs.push(() => api.put(`/portal/resources/${id}`, { total_quantity: t, available_quantity: a }))
    }
    if (!jobs.length) return act(async () => ({ message: 'No changes to save' }))
    return act(async () => { for (const j of jobs) await j(); return { message: 'Resources saved' } })
  }

  return (
    <>
      <Table
        heads={['Hospital', ...FIELDS.map((f) => `${f[1]} (free / total)`)]}
        rows={[[
          hospital.name,
          ...FIELDS.map(([k]) => (
            hospital.resource_ids[k] ? (
              <>
                <input type="number" min="0" style={{ width: 65, display: 'inline' }} value={d[k][0]} onChange={(e) => change(k, 0, e.target.value)} />
                {' / '}
                <input type="number" min="0" style={{ width: 65, display: 'inline' }} value={d[k][1]} onChange={(e) => change(k, 1, e.target.value)} />
              </>
            ) : '-'
          )),
        ]]}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={save}>Save</button>
        <span className="note">Resources in use by running cases are returned automatically when a case is completed or cancelled.</span>
      </div>
    </>
  )
}

export function ReportPage({ hospitals }) {
  const { user, H, notify } = useStore()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    api.get('/portal/reports/summary').then((r) => setRows(r.data)).catch((e) => notify(e.message, true))
  }, [notify])

  const list = hospitals || H
  const byId = new Map((rows || []).map((r) => [r.hospital_id, r]))
  const shown = list
    .map((h) => ({ h, r: byId.get(h.id) || { emergency: 0, emergency_completed: 0, emergency_active: 0, regular: 0, regular_completed: 0, regular_active: 0 } }))
    .filter(({ r }) => (hospitals ? true : r.emergency + r.regular > 0))
    .sort((a, b) => b.r.emergency + b.r.regular - (a.r.emergency + a.r.regular))
    .slice(0, hospitals ? 50 : 40)

  const download = async () => {
    try {
      const q = hospitals && hospitals.length === 1 ? `?hospital_id=${hospitals[0].id}` : ''
      const r = await api.get(`/portal/reports/export${q}`)
      const hname = (id) => (H.find((h) => h.id === id) || {}).name || id
      const out = [['ID', 'Name', 'Age', 'Hospital', 'Type', 'Priority', 'Doctor/Dept', 'Reason', 'Status', 'Date']].concat(
        r.data.map((p) => [p.code, p.name, p.age ?? '', hname(p.hid), p.type, p.severity, p.dept, p.reason, statusLabel(p.status), new Date(p.time).toISOString()])
      )
      const text = out.map((row) => row.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
      a.download = 'mednexus-report.csv'
      a.click()
    } catch (e) {
      notify(e.message, true)
    }
  }

  if (!rows) return <div className="spin">Loading report...</div>
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Reports</h2>
      <Table
        heads={['Hospital', 'Total Patients', 'Emergency', 'Regular', 'Completed', 'Active']}
        rows={shown.map(({ h, r }) => [h.name, r.emergency + r.regular, r.emergency, r.regular, r.emergency_completed + r.regular_completed, r.emergency_active + r.regular_active])}
      />
      {user.role === 'admin' && !hospitals && <div className="note">Showing the 40 hospitals with the most records.</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={download}>Download CSV</button>
        <span className="note">CSV contains current and last-30-day records ({hospitals && hospitals.length === 1 ? 'this hospital' : 'all hospitals, active only'}).</span>
      </div>
    </>
  )
}

export function ForecastCard({ hid }) {
  const [f, setF] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setF(null)
    setError('')
    api.get(`/forecast/hospitals/${hid}?hours=6`).then((r) => live && setF(r.data)).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [hid])

  return (
    <div className="card">
      <b>Next 6 Hours - Expected Arrivals</b>
      {error && <div className="err" style={{ marginTop: 8 }}>{error}</div>}
      {!f && !error && <div className="spin">Calculating...</div>}
      {f && !f.available && <div className="alert">{f.message}</div>}
      {f && f.available && (
        <>
          <div className="res">
            <span>Expected cases<br /><b>{f.expected_cases}</b></span>
            <span>Expected critical<br /><b>{f.expected_critical_cases}</b></span>
            <span>ICU free now<br /><b>{f.icu_available}</b></span>
          </div>
          <div>
            Surge risk: <span className={`tag ${f.risk === 'HIGH' ? 'red-t' : f.risk === 'MEDIUM' ? 'orange-t' : 'green-t'}`}>{f.risk}</span>
          </div>
          <div className="note" style={{ marginTop: 6 }}>
            Based on the average of the last {f.history_days_used} days of history, by time of day. A planning aid, not a clinical prediction.
          </div>
        </>
      )}
    </div>
  )
}

export function Layout({ nav, page, setPage, children }) {
  const { user, logout, toast } = useStore()
  const navigate = useNavigate()
  const out = () => {
    logout()
    navigate('/')
  }
  return (
    <div className="layout">
      <nav>
        <div className="brand">MedNexus</div>
        {nav.map(([id, label]) => (
          <a key={id} className={id === page ? 'on' : ''} onClick={() => { setPage(id); window.scrollTo(0, 0) }}>{label}</a>
        ))}
        <a className="lo" onClick={out}>Logout</a>
      </nav>
      <div className="main">
        <div className="top"><span>{user && user.name} ({user && user.role})</span></div>
        <div className="pad">{children}</div>
      </div>
      {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`}>{toast.text}</div>}
    </div>
  )
}
