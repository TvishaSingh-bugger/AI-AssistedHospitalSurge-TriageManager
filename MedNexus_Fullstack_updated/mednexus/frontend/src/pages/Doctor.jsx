import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Layout, Card, Table, Donut, SevTag, TypeTag, StatTag, HealthTag, HospPicker, QueueTable, ReportPage, ForecastCard, useSetStatus } from '../ui.jsx'
import { queue, fmtTime, fmtStamp, healthCounts } from '../data.js'

const NAV = [['dash', 'Doctor Dashboard'], ['rec', 'Patient Records'], ['appt', 'Appointments'], ['rx', 'Prescriptions'], ['rep', 'Reports']]

const useCur = () => {
  const { hospital, hid, records } = useStore()
  return { h: hospital, hid, records }
}

function Dash() {
  const { hid, records } = useCur()
  const setStatus = useSetStatus()
  const q = queue(records)
  const all = [...records].sort((a, b) => b.time - a.time)
  const running = (p) => p.status === 'Running' || p.status === 'In Progress'
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Doctor Dashboard</h2>
      <div className="grid">
        <Card label="Patients in Queue" value={q.length} cls="s-blue" />
        <Card label="In Treatment" value={q.filter(running).length} cls="s-green" />
        <Card label="Critical Cases" value={q.filter((p) => p.severity === 'Critical').length} cls="s-red" />
      </div>
      <div className="two">
        <div>
          <h2 style={{ marginTop: 0 }}>Next Patients</h2>
          <Table
            heads={['Time', 'Patient', 'Reason', 'Priority', 'Status', '']}
            rows={q.slice(0, 6).map((p) => [fmtTime(p), p.name, p.reason, <SevTag s={p.severity} />, <StatTag s={p.status} />,
              running(p)
                ? <button className="green" onClick={() => setStatus(p, 'Completed')}>Done</button>
                : <button onClick={() => setStatus(p, p.kind === 'case' ? 'Running' : 'In Progress')}>Start</button>])}
            empty="No patients waiting"
          />
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <b>Patient Health Overview</b>
            <div style={{ marginTop: 12 }}><Donut counts={healthCounts(q)} /></div>
          </div>
          <ForecastCard hid={hid} />
        </div>
      </div>
      <h2>Recent Patient Records</h2>
      <Table heads={['ID', 'Name', 'Age', 'Doctor / Dept', 'Status']} rows={all.slice(0, 5).map((p) => [p.code, p.name, p.age ?? '-', p.dept, <StatTag s={p.status} />])} />
    </>
  )
}

function Rec() {
  const { records } = useCur()
  const l = [...records].sort((a, b) => b.time - a.time)
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Patient Records</h2>
      <Table
        heads={['ID', 'Name', 'Age', 'Doctor / Dept', 'Type', 'Priority', 'Health', 'Status']}
        rows={l.map((p) => [p.code, p.name, p.age ?? '-', p.dept, <TypeTag t={p.type} />, <SevTag s={p.severity} />, <HealthTag p={p} />, <StatTag s={p.status} />])}
      />
    </>
  )
}

function Appt() {
  const { records } = useCur()
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>My Appointments &amp; Emergency Queue</h2>
      <p className="note" style={{ marginBottom: 8 }}>Appointments patients booked with you appear here, together with the hospital's emergency cases. Start allocates the ICU / ventilator / oxygen the case needs. Done releases them.</p>
      <QueueTable list={queue(records)} mode="doctor" />
    </>
  )
}

function Rx() {
  const { hid, records } = useCur()
  const { act } = useStore()
  const patients = [...new Map(records.map((p) => [p.patient_id, p])).values()]
  const [f, setF] = useState({ patient_id: '', medicine: '', notes: '' })
  const [list, setList] = useState([])
  const patient = f.patient_id || (patients[0] && patients[0].patient_id) || ''

  const load = () => api.get(`/portal/hospitals/${hid}/prescriptions`).then((r) => setList(r.data)).catch(() => setList([]))
  useEffect(() => { if (hid) load() }, [hid]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!f.medicine.trim() || !patient) return
    const ok = await act(() => api.post('/portal/prescriptions', { patient_id: +patient, medicine: f.medicine, notes: f.notes }), 'Prescription saved')
    if (ok) { setF({ patient_id: '', medicine: '', notes: '' }); load() }
  }
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Prescriptions</h2>
      <div className="card form">
        <select value={patient} onChange={(e) => setF({ ...f, patient_id: e.target.value })}>
          {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.code})</option>)}
        </select>
        <input placeholder="Medicine" value={f.medicine} onChange={(e) => setF({ ...f, medicine: e.target.value })} />
        <input placeholder="Dosage / Notes" style={{ minWidth: 220 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <button onClick={add}>Add</button>
      </div>
      <br />
      <Table heads={['Date', 'Patient', 'Medicine', 'Notes', 'Doctor']} rows={list.map((r) => [fmtStamp(r.created_at), r.patient_name, r.medicine, r.notes || '', r.doctor_name])} empty="No prescriptions written yet" />
    </>
  )
}

function Rep() {
  const { h } = useCur()
  if (!h) return <div className="spin">Loading...</div>
  return <ReportPage hospitals={[h]} />
}

export default function Doctor() {
  const [page, setPage] = useState('dash')
  const View = { dash: Dash, rec: Rec, appt: Appt, rx: Rx, rep: Rep }[page]
  return (
    <Layout nav={NAV} page={page} setPage={setPage}>
      <View />
    </Layout>
  )
}
