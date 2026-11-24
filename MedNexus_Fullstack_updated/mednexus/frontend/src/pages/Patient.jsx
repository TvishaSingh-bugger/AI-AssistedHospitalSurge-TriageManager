import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Layout, Card, Table, SevTag, TypeTag, StatTag, AlertList } from '../ui.jsx'
import { SLOTS, fmtDate, fmtTime, fmtStamp, getAlerts, hospitalStatus, isDone, canPatientCancel, needForSeverity, statusLabel } from '../data.js'

const NAV = [['dash', 'Patient Dashboard'], ['book', 'Book Appointment'], ['find', 'Find Hospital'], ['profile', 'My Profile'], ['appts', 'Appointments'], ['hist', 'Medical History'], ['emer', 'Emergency Status'], ['notif', 'Notifications']]

function useMine() {
  const { me, H, S } = useStore()
  const name = (id) => (H.find((h) => h.id === id) || { name: '-' }).name
  const mine = [...me.records].sort((a, b) => b.time - a.time)
  const lastDistrict = (H.find((h) => mine[0] && h.id === mine[0].hid) || {}).district
  const district = S.district || lastDistrict || (H[0] && H[0].district) || ''
  const nearby = H.filter((h) => h.district === district)
  const h = me.health || {}
  const prof = {
    age: h.age ?? '', phone: h.phone || '', blood: h.blood_group || '-',
    allergies: h.allergies || 'None', chronic: h.chronic_conditions || 'None',
  }
  const emergency = mine.find((p) => p.type === 'Emergency' && !isDone(p))
  return { mine, nearby, district, prof, emergency, name }
}

function Dash({ setPage }) {
  const { user, S } = useStore()
  const { mine, nearby, prof, emergency, name } = useMine()
  const next = mine.filter((p) => p.type === 'Regular' && !isDone(p)).sort((a, b) => a.time - b.time)[0]
  const last = mine[0]
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 12px' }}>
        <h2 style={{ margin: 0 }}>Welcome, {user.name}</h2>
        <button onClick={() => setPage('book')}>+ Book Appointment</button>
      </div>
      <div className="grid">
        <Card label="Emergency Status" value={emergency ? `${statusLabel(emergency.status)} - ${emergency.hospital_name}` : 'Stable'} cls={emergency ? 's-red' : 's-green'} />
        <Card label="Next Appointment" cls="s-blue" value={next ? <span style={{ fontSize: 16 }}>{fmtDate(next)} {fmtTime(next)}<br />{next.dept}</span> : 'None'} />
        <Card label="Last Hospital" cls="s-purple" value={<span style={{ fontSize: 16 }}>{last ? name(last.hid) : '-'}</span>} />
      </div>
      <div className="two">
        <div>
          <h2 style={{ marginTop: 0 }}>My Recent Visits</h2>
          <Table heads={['Date', 'Doctor / Dept', 'Reason', 'Status']} rows={mine.slice(0, 5).map((p) => [fmtDate(p), p.dept, p.reason, <StatTag s={p.status} />])} empty="No visits yet - book your first appointment above" />
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <b>Resource Alerts Nearby</b>
            <AlertList items={getAlerts(nearby, S, 5)} />
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

const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

// Dedicated "Book Appointment" page: hospital -> doctor -> date -> free slot.
function Book({ setPage }) {
  const { H, act } = useStore()
  const { district: startDistrict } = useMine()
  const today = localToday()
  const [district, setDistrict] = useState(startDistrict)
  const [hosp, setHosp] = useState('')
  const [doctors, setDoctors] = useState([])
  const [taken, setTaken] = useState([])
  const [done, setDone] = useState(null)
  const [bk, setBk] = useState({ doctor_id: '', reason: '', date: today, time: '' })

  const districts = [...new Set(H.map((h) => h.district))].sort()
  const hospitals = H.filter((h) => h.district === district).sort((a, b) => a.name.localeCompare(b.name))

  // keep a valid hospital selected for the chosen district
  useEffect(() => {
    if (!district && districts[0]) setDistrict(districts[0])
    if (!hospitals.find((h) => h.id === +hosp)) setHosp(hospitals[0] ? String(hospitals[0].id) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district, H])

  useEffect(() => {
    if (!hosp) { setDoctors([]); return }
    let live = true
    api.get(`/portal/hospitals/${hosp}/doctors`).then((r) => {
      if (!live) return
      setDoctors(r.data)
      setBk((b) => ({ ...b, doctor_id: r.data[0] ? String(r.data[0].staff_id) : '' }))
    }).catch(() => live && setDoctors([]))
    return () => { live = false }
  }, [hosp])

  const loadTaken = () => {
    if (!bk.doctor_id || !bk.date) return Promise.resolve()
    return api.get(`/portal/doctors/${bk.doctor_id}/booked?date=${bk.date}`).then((r) => setTaken(r.data)).catch(() => setTaken([]))
  }
  useEffect(() => { loadTaken() }, [bk.doctor_id, bk.date]) // eslint-disable-line react-hooks/exhaustive-deps

  const nowHM = new Date().toTimeString().slice(0, 5)
  const isFree = (v) => !taken.includes(v) && !(bk.date === today && v <= nowHM)
  const freeSlots = SLOTS.filter((s) => isFree(s.value))

  // pick the first free slot whenever the options change
  useEffect(() => {
    if (!freeSlots.find((s) => s.value === bk.time)) setBk((b) => ({ ...b, time: freeSlots[0] ? freeSlots[0].value : '' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taken, bk.date, bk.doctor_id])

  const doctor = doctors.find((d) => String(d.staff_id) === String(bk.doctor_id))
  const hospital = H.find((h) => String(h.id) === String(hosp))

  const submit = async () => {
    const ok = await act(() => api.post('/portal/appointments', {
      hospital_id: +hosp, doctor_id: +bk.doctor_id, reason: bk.reason, date: bk.date, time: bk.time,
    }), 'Appointment booked')
    if (ok) {
      setDone({ hospital: hospital.name, doctor: doctor ? doctor.staff_name : '', date: bk.date, time: (SLOTS.find((s) => s.value === bk.time) || {}).label })
      setBk((b) => ({ ...b, reason: '' }))
      loadTaken()
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Book Appointment</h2>
      {done && (
        <div className="banner">
          Booked with <b>{done.doctor}</b> at {done.hospital} on {done.date}, {done.time}.{' '}
          <a style={{ cursor: 'pointer' }} onClick={() => setPage('appts')}>View my appointments</a>
        </div>
      )}
      <div className="card form" style={{ maxWidth: 560, flexDirection: 'column', alignItems: 'stretch' }}>
        <label>District
          <select value={district} onChange={(e) => setDistrict(e.target.value)}>{districts.map((d) => <option key={d}>{d}</option>)}</select>
        </label>
        <label>Hospital
          <select value={hosp} onChange={(e) => setHosp(e.target.value)}>{hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </label>
        <label>Doctor
          <select value={bk.doctor_id} onChange={(e) => setBk({ ...bk, doctor_id: e.target.value })} disabled={!doctors.length}>
            {doctors.length === 0 && <option value="">No doctors available at this hospital</option>}
            {doctors.map((d) => <option key={d.staff_id} value={d.staff_id}>{d.staff_name}</option>)}
          </select>
        </label>
        <label>Date
          <input type="date" min={today} value={bk.date} onChange={(e) => setBk({ ...bk, date: e.target.value || today })} />
        </label>
        <label>Time slot
          <select value={bk.time} onChange={(e) => setBk({ ...bk, time: e.target.value })}>
            {freeSlots.length === 0 && <option value="">No free slots on this day</option>}
            {SLOTS.map((s) => <option key={s.value} value={s.value} disabled={!isFree(s.value)}>{s.label}{taken.includes(s.value) ? ' (booked)' : ''}</option>)}
          </select>
        </label>
        <label>Reason for visit
          <input placeholder="e.g. fever, check-up" value={bk.reason} onChange={(e) => setBk({ ...bk, reason: e.target.value })} />
        </label>
        <button onClick={submit} disabled={!hosp || !bk.doctor_id || !bk.time}>Confirm Appointment</button>
        <div className="note">Your appointment will appear on the selected doctor's dashboard and in the administrator's appointment list.</div>
      </div>
    </>
  )
}

function Find({ emg, setEmg }) {
  const { H, user, act, saveSettings, S } = useStore()
  const { district, nearby } = useMine()
  const today = new Date().toISOString().slice(0, 10)
  const [sel, setSel] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [msg, setMsg] = useState(null)
  const [sev, setSev] = useState('High')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [bk, setBk] = useState({ doctor_id: '', reason: '', date: today, time: SLOTS[0].value })

  const districts = [...new Set(H.map((h) => h.district))].sort()
  const switchMode = (e) => { setEmg(e); setSel(null); setMsg(null) }

  const list = nearby
    .filter((h) => h.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (emg
      ? (hospitalStatus(a)[2] === 2) - (hospitalStatus(b)[2] === 2) || b.icu[0] - a.icu[0]
      : a.name.localeCompare(b.name)))
    .slice(0, 12)

  useEffect(() => {
    if (!sel) return
    api.get(`/portal/hospitals/${sel}/doctors`).then((r) => {
      setDoctors(r.data)
      setBk((b) => ({ ...b, doctor_id: r.data[0] ? r.data[0].staff_id : '' }))
    })
  }, [sel])

  const book = async () => {
    const ok = await act(() => api.post('/portal/appointments', { hospital_id: sel, doctor_id: +bk.doctor_id, reason: bk.reason, date: bk.date, time: bk.time }), 'Appointment booked')
    if (ok) {
      const h = H.find((x) => x.id === sel)
      setMsg(<div className="banner">{h.name} - appointment booked for {bk.date} at {bk.time}</div>)
      setSel(null)
    }
  }
  const goNow = async (h) => {
    const ok = await act(() => api.post('/portal/emergency', { hospital_id: h.id, severity: sev, need: needForSeverity(sev), reason: reason || 'Emergency' }), 'Emergency registered - you are in the hospital queue')
    if (ok) {
      setMsg(
        <div className="banner">
          <b>{h.name}</b> is expecting you. Your case is queued ({sev}).{' '}
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name + ' ' + h.district)}`} target="_blank" rel="noreferrer">Directions</a>
        </div>
      )
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Hospitals in {district}</h2>
      {msg}
      <div className="row">
        <button className={emg ? 'light' : ''} onClick={() => switchMode(false)}>Normal</button>
        <button className={emg ? 'red' : 'red light'} onClick={() => switchMode(true)}>Emergency</button>
        <select style={{ width: 'auto' }} value={district} onChange={(e) => saveSettings({ ...S, district: e.target.value })}>
          {districts.map((d) => <option key={d}>{d}</option>)}
        </select>
        <input style={{ width: 200 }} placeholder="Search hospital name" value={search} onChange={(e) => setSearch(e.target.value)} />
        {emg && (
          <>
            <select style={{ width: 'auto' }} value={sev} onChange={(e) => setSev(e.target.value)}>
              <option>Critical</option><option>High</option><option>Medium</option>
            </select>
            <input style={{ width: 200 }} placeholder="What happened? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </>
        )}
      </div>
      {user.is_guest && <div className="note" style={{ marginBottom: 8 }}>You are using an emergency guest session. Register a patient account to keep your history.</div>}
      <div className="hosp">
        {list.map((h, i) => {
          const s = hospitalStatus(h)
          return (
            <div key={h.id} className={`card ${emg && i === 0 && s[2] < 2 ? 'best' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <b>{h.name}</b><span className={`tag ${s[1]}`}>{s[0]}</span>
              </div>
              <div className="note">{h.district} - {h.type}</div>
              <div className="res">
                <span>ICU {h.icu[0]}/{h.icu[1]}</span><span>Vent {h.vent[0]}/{h.vent[1]}</span><span>O2 {h.oxy[0]}/{h.oxy[1]}</span>
                <span>Beds {h.beds[0]}/{h.beds[1]}</span><span>Blood {h.blood[0]}/{h.blood[1]}</span>
              </div>
              {emg
                ? <button className="red" disabled={s[2] === 2} onClick={() => goNow(h)}>Go Now</button>
                : <button onClick={() => { setSel(h.id); setMsg(null) }}>Select</button>}
            </div>
          )
        })}
        {list.length === 0 && <div className="card">No hospitals match.</div>}
      </div>
      {sel && !emg && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>{(H.find((h) => h.id === sel) || {}).name}</b>
          <div className="form" style={{ marginTop: 10 }}>
            <select value={bk.doctor_id} onChange={(e) => setBk({ ...bk, doctor_id: e.target.value })}>
              {doctors.map((d) => <option key={d.staff_id} value={d.staff_id}>{d.staff_name}</option>)}
            </select>
            <input placeholder="Reason" value={bk.reason} onChange={(e) => setBk({ ...bk, reason: e.target.value })} />
            <input type="date" min={today} value={bk.date} onChange={(e) => setBk({ ...bk, date: e.target.value })} />
            <select value={bk.time} onChange={(e) => setBk({ ...bk, time: e.target.value })}>{SLOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            <button onClick={book} disabled={!bk.doctor_id}>Book</button>
            <button className="light" onClick={() => setSel(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}

function Profile() {
  const { user, me, act } = useStore()
  const toForm = (h = {}) => ({
    name: user.name, age: h.age ?? '', phone: h.phone || '', blood: h.blood_group || '-',
    allergies: h.allergies || '', chronic: h.chronic_conditions || '',
  })
  const [f, setF] = useState(() => toForm(me.health))
  // Once the person starts typing we stop copying server data into the form.
  // (The app re-downloads the profile every few seconds; that used to wipe what was being typed.)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setF(toForm(me.health))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.health])
  const set = (k) => (e) => { dirty.current = true; const v = e.target.value; setF((cur) => ({ ...cur, [k]: v })) }
  const save = async () => {
    const ok = await act(() => api.put('/portal/me/profile', {
      full_name: f.name, age: f.age, phone: f.phone, blood_group: f.blood, allergies: f.allergies, chronic_conditions: f.chronic,
    }), 'Profile saved')
    if (ok) dirty.current = false
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
      </div>
    </>
  )
}

function Appts({ setPage }) {
  const { act, refresh } = useStore()
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const { mine } = useMine()
  const l = mine.filter((p) => !isDone(p))
  const cancel = (p) => act(() => api.post(`/portal/records/${p.kind}/${p.id}/cancel`), 'Cancelled')
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 12px' }}>
        <h2 style={{ margin: 0 }}>Appointments</h2>
        <button onClick={() => setPage('book')}>+ Book Appointment</button>
      </div>
      <Table
        heads={['ID', 'Hospital', 'Type', 'Doctor / Dept', 'Date / Time', 'Status', '']}
        rows={l.map((p) => [p.code, p.hospital_name, <TypeTag t={p.type} />, p.dept, `${fmtDate(p)} ${fmtTime(p)}`, <StatTag s={p.status} />,
          canPatientCancel(p) ? <button className="light small" onClick={() => cancel(p)}>Cancel</button> : ''])}
        empty="No upcoming appointments"
      />
    </>
  )
}

function Hist() {
  const { me, refresh } = useStore()
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const { mine } = useMine()
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Medical History</h2>
      <Table heads={['Date', 'Hospital', 'Doctor / Dept', 'Reason']} rows={mine.filter((p) => p.status === 'Completed').map((p) => [fmtDate(p), p.hospital_name, p.dept, p.reason])} empty="No completed visits yet" />
      <h2>Prescriptions</h2>
      <Table heads={['Date', 'Hospital', 'Doctor', 'Medicine', 'Notes']} rows={me.prescriptions.map((r) => [fmtStamp(r.created_at), r.hospital_name, r.doctor_name, r.medicine, r.notes || ''])} empty="No prescriptions yet" />
    </>
  )
}

function Emer({ setEmg, setPage }) {
  const { act } = useStore()
  const { emergency } = useMine()
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Emergency Status</h2>
      {emergency ? (
        <div className="card s-red">
          <b>{emergency.hospital_name}</b>
          <div className="row" style={{ marginTop: 8 }}>
            <SevTag s={emergency.severity} /> <StatTag s={emergency.status} /> <span>Resource: {emergency.need}</span>
          </div>
          {canPatientCancel(emergency) && (
            <button className="light" onClick={() => act(() => api.post(`/portal/records/case/${emergency.id}/cancel`), 'Emergency cancelled')}>Cancel emergency</button>
          )}
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
  const { S } = useStore()
  const { mine, nearby } = useMine()
  const items = mine.slice(0, 8).map((p) => ({ lvl: 'blue', text: `${p.hospital_name}: ${p.reason} - ${statusLabel(p.status)}` })).concat(getAlerts(nearby, S, 5))
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Notifications</h2>
      <div className="card"><AlertList items={items} /></div>
    </>
  )
}

export default function Patient() {
  const [sp] = useSearchParams()
  const [page, setPage] = useState(sp.has('emergency') ? 'find' : 'dash')
  const [emg, setEmg] = useState(sp.has('emergency'))
  return (
    <Layout nav={NAV} page={page} setPage={setPage}>
      {page === 'dash' && <Dash setPage={setPage} />}
      {page === 'book' && <Book setPage={setPage} />}
      {page === 'find' && <Find emg={emg} setEmg={setEmg} />}
      {page === 'profile' && <Profile />}
      {page === 'appts' && <Appts setPage={setPage} />}
      {page === 'hist' && <Hist />}
      {page === 'emer' && <Emer setEmg={setEmg} setPage={setPage} />}
      {page === 'notif' && <Notif />}
    </Layout>
  )
}
