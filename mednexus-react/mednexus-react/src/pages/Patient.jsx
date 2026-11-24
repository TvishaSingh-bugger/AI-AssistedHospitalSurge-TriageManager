import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { Layout, Card, Table, SevTag, TypeTag, StatTag, AlertList } from '../ui.jsx'
import { DEPTS, SLOTS, fmtDate, fmtTime, getAlerts, hospitalStatus } from '../data.js'

const NAV = [['dash', 'Patient Dashboard'], ['find', 'Find Hospital'], ['profile', 'My Profile'], ['appts', 'Appointments'], ['hist', 'Medical History'], ['emer', 'Emergency Status'], ['notif', 'Notifications']]

function useMine() {
  const { user, P, H, S, PR } = useStore()
  const name = (id) => (H.find((h) => h.id === id) || { name: '-' }).name
  const mine = P.filter((p) => p.owner === user.name).sort((a, b) => b.time - a.time)
  const inRange = H.filter((h) => h.dist <= S.range).sort((a, b) => a.dist - b.dist)
  const prof = { name: user.name, age: '', phone: '', blood: '-', allergies: 'None', chronic: 'None', ...(PR[user.name] || {}) }
  const emergency = mine.find((p) => p.type === 'Emergency' && p.status !== 'Completed')
  return { mine, inRange, prof, emergency, name }
}

function Dash() {
  const { user, S, P } = useStore()
  const { mine, inRange, prof, emergency, name } = useMine()
  const next = mine.filter((p) => p.type === 'Regular' && p.status !== 'Completed').pop()
  const last = mine[0]
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Welcome, {user.name}</h2>
      <div className="grid">
        <Card label="Emergency Status" value={emergency ? `${emergency.status} - ${name(emergency.hid)}` : 'Stable'} cls={emergency ? 's-red' : 's-green'} />
        <Card label="Next Appointment" cls="s-blue" value={next ? <span style={{ fontSize: 16 }}>{fmtDate(next)} {fmtTime(next)}<br />{next.dept}</span> : 'None'} />
        <Card label="Hospital" cls="s-purple" value={<span style={{ fontSize: 16 }}>{last ? name(last.hid) : inRange[0] ? inRange[0].name : '-'}</span>} />
      </div>
      <div className="two">
        <div>
          <h2 style={{ marginTop: 0 }}>My Recent Visits</h2>
          <Table heads={['Date', 'Department', 'Reason', 'Status']} rows={mine.slice(0, 5).map((p) => [fmtDate(p), p.dept, p.reason, <StatTag s={p.status} />])} />
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <b>Emergency Alerts</b>
            <AlertList items={getAlerts(inRange, P, S)} />
          </div>
          <div className="card">
            <b>Health Summary</b>
            <div className="res">
              <span>Blood Group<br /><b>{prof.blood}</b></span>
              <span>Allergies<br /><b>{prof.allergies}</b></span>
              <span>Chronic<br /><b>{prof.chronic}</b></span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Find({ emg, setEmg }) {
  const { H, S, dispatch } = useStore()
  const { prof, inRange, name } = useMine()
  const user = useStore().user
  const today = new Date().toISOString().slice(0, 10)
  const [sel, setSel] = useState(null)
  const [msg, setMsg] = useState(null)
  const [sev, setSev] = useState('High')
  const [bk, setBk] = useState({ dept: DEPTS[0], reason: '', date: today, slot: SLOTS[0] })
  const eta = (h) => Math.round(h.dist * 3)

  const list = [...inRange]
    .sort((a, b) => (emg ? (hospitalStatus(a)[2] === 2) - (hospitalStatus(b)[2] === 2) || a.dist - b.dist : a.dist - b.dist))
    .slice(0, 5)

  const switchMode = (e) => { setEmg(e); setSel(null); setMsg(null) }

  const book = () => {
    dispatch({ type: 'addPatient', p: { name: prof.name, owner: user.name, age: prof.age, hid: sel, type: 'Regular', severity: 'Low', dept: bk.dept, reason: bk.reason || 'Checkup', date: new Date(bk.date).toLocaleDateString('en-GB'), slot: bk.slot } })
    setMsg(<div className="banner">{name(sel)} - booked</div>)
    setSel(null)
  }
  const goNow = (h) => {
    dispatch({ type: 'addPatient', p: { name: prof.name, owner: user.name, age: prof.age, hid: h.id, type: 'Emergency', severity: sev, dept: 'Emergency', reason: 'Emergency', need: sev === 'Critical' ? 'ICU + Ventilator' : sev === 'High' ? 'ICU' : 'Observation' } })
    setMsg(
      <div className="banner">
        <b>{h.name}</b> - {eta(h)} min -{' '}
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name)}`} target="_blank" rel="noreferrer">Directions</a>
      </div>
    )
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Hospitals Nearby</h2>
      {msg}
      <div className="row">
        <button className={emg ? 'light' : ''} onClick={() => switchMode(false)}>Normal</button>
        <button className={emg ? 'red' : 'red light'} onClick={() => switchMode(true)}>Emergency</button>
        <select style={{ width: 'auto' }} value={S.range} onChange={(e) => dispatch({ type: 'saveSettings', S: { ...S, range: +e.target.value } })}>
          {[5, 10, 20].map((r) => <option key={r} value={r}>{r} km</option>)}
        </select>
        {emg && (
          <select style={{ width: 'auto' }} value={sev} onChange={(e) => setSev(e.target.value)}>
            <option>Critical</option><option>High</option><option>Medium</option>
          </select>
        )}
      </div>
      <div className="hosp">
        {list.map((h, i) => {
          const s = hospitalStatus(h)
          return (
            <div key={h.id} className={`card ${emg && i === 0 && s[2] < 2 ? 'best' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <b>{h.name}</b><span className={`tag ${s[1]}`}>{s[0]}</span>
              </div>
              <div>{h.dist} km &nbsp; {eta(h)} min</div>
              <div className="res">
                <span>ICU {h.icu[0]}/{h.icu[1]}</span><span>Vent {h.vent[0]}/{h.vent[1]}</span><span>O2 {h.oxy[0]}/{h.oxy[1]}</span>
                <span>Beds {h.beds[0]}/{h.beds[1]}</span><span>Blood {h.blood[0]}/{h.blood[1]}</span>
              </div>
              {emg
                ? <button className="red" disabled={s[2] === 2} onClick={() => goNow(h)}>Go Now</button>
                : <button onClick={() => setSel(h.id)}>Select</button>}
            </div>
          )
        })}
      </div>
      {sel && !emg && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>{name(sel)}</b>
          <div className="form" style={{ marginTop: 10 }}>
            <select value={bk.dept} onChange={(e) => setBk({ ...bk, dept: e.target.value })}>{DEPTS.map((d) => <option key={d}>{d}</option>)}</select>
            <input placeholder="Reason" value={bk.reason} onChange={(e) => setBk({ ...bk, reason: e.target.value })} />
            <input type="date" min={today} value={bk.date} onChange={(e) => setBk({ ...bk, date: e.target.value })} />
            <select value={bk.slot} onChange={(e) => setBk({ ...bk, slot: e.target.value })}>{SLOTS.map((s) => <option key={s}>{s}</option>)}</select>
            <button onClick={book}>Book</button>
            <button className="light" onClick={() => setSel(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}

function Profile() {
  const { user, dispatch } = useStore()
  const { prof } = useMine()
  const [f, setF] = useState(prof)
  const [saved, setSaved] = useState(false)
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setSaved(false) }
  const save = () => {
    dispatch({ type: 'saveProfile', key: user.name, data: { ...f, allergies: f.allergies || 'None', chronic: f.chronic || 'None' } })
    setSaved(true)
  }
  return (
    <>
      <h2 style={{ marginTop: 0 }}>My Profile</h2>
      <div className="card form" style={{ maxWidth: 520, flexDirection: 'column', alignItems: 'stretch' }}>
        <label>Name<input value={f.name} onChange={set('name')} /></label>
        <label>Age<input type="number" value={f.age} onChange={set('age')} /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
        <label>Blood Group
          <select value={f.blood} onChange={set('blood')}>{['-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b}>{b}</option>)}</select>
        </label>
        <label>Allergies<input value={f.allergies} onChange={set('allergies')} /></label>
        <label>Chronic Conditions<input value={f.chronic} onChange={set('chronic')} /></label>
        <button onClick={save}>Save</button>
        {saved && <div className="banner">Saved</div>}
      </div>
    </>
  )
}

function Appts() {
  const { dispatch } = useStore()
  const { mine, name } = useMine()
  const l = mine.filter((p) => p.status !== 'Completed')
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Appointments</h2>
      <Table
        heads={['ID', 'Hospital', 'Type', 'Department', 'Date / Time', 'Status', '']}
        rows={l.map((p) => [p.id, name(p.hid), <TypeTag t={p.type} />, p.dept, `${fmtDate(p)} ${fmtTime(p)}`, <StatTag s={p.status} />,
          p.status === 'Waiting' ? <button className="light" onClick={() => dispatch({ type: 'removePatient', id: p.id })}>Cancel</button> : ''])}
      />
    </>
  )
}

function Hist() {
  const { RX } = useStore()
  const { mine, prof, name } = useMine()
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Medical History</h2>
      <Table heads={['Date', 'Hospital', 'Department', 'Reason']} rows={mine.filter((p) => p.status === 'Completed').map((p) => [fmtDate(p), name(p.hid), p.dept, p.reason])} />
      <h2>Prescriptions</h2>
      <Table heads={['Date', 'Doctor', 'Medicine', 'Notes']} rows={RX.filter((r) => r.patient === prof.name).map((r) => [r.date, r.doctor, r.drug, r.note])} />
    </>
  )
}

function Emer({ setEmg, setPage }) {
  const { emergency, name } = useMine()
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Emergency Status</h2>
      {emergency ? (
        <div className="card s-red">
          <b>{name(emergency.hid)}</b>
          <div className="row" style={{ marginTop: 8 }}>
            <SevTag s={emergency.severity} /> <StatTag s={emergency.status} /> <span>Resource: {emergency.need}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="card s-green"><b>Stable</b></div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="red" onClick={() => { setEmg(true); setPage('find') }}>Find Emergency Hospital</button>
          </div>
        </>
      )}
    </>
  )
}

function Notif() {
  const { P, S } = useStore()
  const { mine, inRange, name } = useMine()
  const items = mine.map((p) => ({ lvl: 'blue', text: `${name(p.hid)}: ${p.reason} - ${p.status}` })).concat(getAlerts(inRange, P, S))
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Notifications</h2>
      <div className="card"><AlertList items={items} /></div>
    </>
  )
}

export const VIEWS = { dash: Dash, profile: Profile, appts: Appts, hist: Hist, notif: Notif }
export default function Patient() {
  const [sp] = useSearchParams()
  const [page, setPage] = useState(sp.has('emergency') ? 'find' : 'dash')
  const [emg, setEmg] = useState(sp.has('emergency'))
  return (
    <Layout nav={NAV} page={page} setPage={setPage}>
      {page === 'dash' && <Dash />}
      {page === 'find' && <Find emg={emg} setEmg={setEmg} />}
      {page === 'profile' && <Profile />}
      {page === 'appts' && <Appts />}
      {page === 'hist' && <Hist />}
      {page === 'emer' && <Emer setEmg={setEmg} setPage={setPage} />}
      {page === 'notif' && <Notif />}
    </Layout>
  )
}
