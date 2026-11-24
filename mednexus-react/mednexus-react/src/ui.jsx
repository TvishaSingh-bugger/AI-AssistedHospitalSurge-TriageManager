import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from './store.jsx'
import { STATUSES, HEALTH, fmtDate, fmtTime } from './data.js'

export const SevTag = ({ s }) => (
  <span className={`tag ${s === 'Critical' || s === 'High' ? 'red-t' : s === 'Medium' ? 'orange-t' : 'green-t'}`}>{s}</span>
)
export const TypeTag = ({ t }) => <span className={`tag ${t === 'Emergency' ? 'red-t' : 'blue-t'}`}>{t}</span>
export const StatTag = ({ s }) => (
  <span className={`tag ${s === 'Waiting' ? 'orange-t' : s === 'Completed' ? 'green-t' : 'blue-t'}`}>{s}</span>
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

export const Table = ({ heads, rows }) => (
  <div className="wrap">
    <table>
      <thead>
        <tr>{heads.map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
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

export function HospPicker() {
  const { H, hid, dispatch } = useStore()
  return (
    <div className="row">
      <b>Hospital</b>
      <select style={{ width: 220 }} value={hid} onChange={(e) => dispatch({ type: 'setHid', hid: +e.target.value })}>
        {H.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
    </div>
  )
}

export function StatusSelect({ p }) {
  const { dispatch } = useStore()
  return (
    <select style={{ width: 'auto' }} value={p.status} onChange={(e) => dispatch({ type: 'setStatus', id: p.id, status: e.target.value })}>
      {STATUSES.map((s) => <option key={s}>{s}</option>)}
    </select>
  )
}

// mode 'doctor' shows Start / Done buttons, otherwise a status dropdown
export function QueueTable({ list, mode }) {
  const { dispatch } = useStore()
  const set = (id, status) => dispatch({ type: 'setStatus', id, status })
  return (
    <Table
      heads={['#', 'ID', 'Name', 'Type', 'Priority', 'Resource', 'Reason', 'Date / Time', 'Status']}
      rows={list.map((p, i) => [
        i + 1, p.id, p.name, <TypeTag t={p.type} />, <SevTag s={p.severity} />, p.need, p.reason,
        `${fmtDate(p)} ${fmtTime(p)}`,
        mode === 'doctor'
          ? p.status === 'In Progress'
            ? <button className="green" onClick={() => set(p.id, 'Completed')}>Done</button>
            : <button onClick={() => set(p.id, 'In Progress')}>Start</button>
          : <StatusSelect p={p} />,
      ])}
    />
  )
}

const FIELDS = [['icu', 'ICU Beds'], ['vent', 'Ventilators'], ['oxy', 'Oxygen'], ['beds', 'Beds'], ['blood', 'Blood']]

// give it key={JSON.stringify(list)} so it resets when data changes outside
export function ResEditor({ list }) {
  const { dispatch } = useStore()
  const [d, setD] = useState(() => list.map((h) => ({ ...h })))
  const change = (id, k, i, val) =>
    setD((prev) => prev.map((h) => (h.id === id ? { ...h, [k]: h[k].map((x, j) => (j === i ? val : x)) } : h)))
  return (
    <>
      <Table
        heads={['Hospital', ...FIELDS.map((f) => `${f[1]} (free / total)`)]}
        rows={d.map((h) => [
          h.name,
          ...FIELDS.map(([k]) => (
            <>
              <input type="number" min="0" style={{ width: 65, display: 'inline' }} value={h[k][0]} onChange={(e) => change(h.id, k, 0, e.target.value)} />
              {' / '}
              <input type="number" min="0" style={{ width: 65, display: 'inline' }} value={h[k][1]} onChange={(e) => change(h.id, k, 1, e.target.value)} />
            </>
          )),
        ])}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => dispatch({ type: 'saveRes', H: d })}>Save</button>
      </div>
    </>
  )
}

export function ReportPage({ list }) {
  const { P, H } = useStore()
  const all = list.length === H.length
  const summary = (h) => {
    const l = P.filter((p) => p.hid === h.id)
    return [h.name, l.length, l.filter((p) => p.type === 'Emergency').length, l.filter((p) => p.type === 'Regular').length, l.filter((p) => p.status === 'Completed').length, l.filter((p) => p.status !== 'Completed').length]
  }
  const download = () => {
    const l = P.filter((p) => all || p.hid === list[0].id)
    const name = (id) => (H.find((h) => h.id === id) || {}).name
    const rows = [['ID', 'Name', 'Age', 'Hospital', 'Type', 'Priority', 'Department', 'Reason', 'Status']].concat(
      l.map((p) => [p.id, p.name, p.age, name(p.hid), p.type, p.severity, p.dept, p.reason, p.status])
    )
    const text = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
    a.download = 'report.csv'
    a.click()
  }
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Reports</h2>
      <Table heads={['Hospital', 'Total Patients', 'Emergency', 'Regular', 'Completed', 'Active']} rows={list.map(summary)} />
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={download}>Download CSV</button>
      </div>
    </>
  )
}

export function Layout({ nav, page, setPage, children }) {
  const { user, dispatch } = useStore()
  const navigate = useNavigate()
  const logout = () => {
    dispatch({ type: 'logout' })
    navigate('/')
  }
  return (
    <div className="layout">
      <nav>
        <div className="brand">MedNexus</div>
        {nav.map(([id, label]) => (
          <a key={id} className={id === page ? 'on' : ''} onClick={() => { setPage(id); window.scrollTo(0, 0) }}>{label}</a>
        ))}
        <a className="lo" onClick={logout}>Logout</a>
      </nav>
      <div className="main">
        <div className="top"><span>{user && user.name}</span></div>
        <div className="pad">{children}</div>
      </div>
    </div>
  )
}
