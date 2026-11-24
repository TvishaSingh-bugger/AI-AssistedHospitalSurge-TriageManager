import { useState } from 'react'
import { useStore } from '../store.jsx'
import { Layout, Card, Table, Donut, SevTag, TypeTag, StatTag, HealthTag, HospPicker, QueueTable, ReportPage } from '../ui.jsx'
import { queue, fmtTime, healthCounts } from '../data.js'

const NAV = [['dash', 'Doctor Dashboard'], ['rec', 'Patient Records'], ['appt', 'Appointments'], ['rx', 'Prescriptions'], ['rep', 'Reports']]

const useCur = () => {
  const { H, P, hid } = useStore()
  const h = H.find((x) => x.id === hid) || H[0]
  return { h, hid: h.id, P }
}

function Dash() {
  const { hid, P } = useCur()
  const { dispatch } = useStore()
  const q = queue(P, hid)
  const all = P.filter((p) => p.hid === hid).sort((a, b) => b.time - a.time)
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Doctor Dashboard</h2>
      <div className="grid">
        <Card label="Today's Appointments" value={q.length} cls="s-blue" />
        <Card label="Active Patients" value={q.filter((p) => p.status !== 'Waiting').length} cls="s-green" />
        <Card label="Critical Cases" value={q.filter((p) => p.severity === 'Critical').length} cls="s-red" />
      </div>
      <div className="two">
        <div>
          <h2 style={{ marginTop: 0 }}>Today's Appointments</h2>
          <Table
            heads={['Time', 'Patient', 'Reason', 'Priority', 'Status', '']}
            rows={q.slice(0, 6).map((p) => [fmtTime(p), p.name, p.reason, <SevTag s={p.severity} />, <StatTag s={p.status} />,
              p.status === 'In Progress'
                ? <button className="green" onClick={() => dispatch({ type: 'setStatus', id: p.id, status: 'Completed' })}>Done</button>
                : <button onClick={() => dispatch({ type: 'setStatus', id: p.id, status: 'In Progress' })}>Start</button>])}
          />
        </div>
        <div className="card">
          <b>Patient Health Overview</b>
          <div style={{ marginTop: 12 }}><Donut counts={healthCounts(q)} /></div>
        </div>
      </div>
      <h2>Recent Patient Records</h2>
      <Table heads={['ID', 'Name', 'Age', 'Department', 'Status']} rows={all.slice(0, 5).map((p) => [p.id, p.name, p.age, p.dept, <StatTag s={p.status} />])} />
    </>
  )
}

function Rec() {
  const { hid, P } = useCur()
  const l = P.filter((p) => p.hid === hid).sort((a, b) => b.time - a.time)
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Patient Records</h2>
      <Table
        heads={['ID', 'Name', 'Age', 'Department', 'Type', 'Priority', 'Health', 'Status']}
        rows={l.map((p) => [p.id, p.name, p.age, p.dept, <TypeTag t={p.type} />, <SevTag s={p.severity} />, <HealthTag p={p} />, <StatTag s={p.status} />])}
      />
    </>
  )
}

function Appt() {
  const { hid, P } = useCur()
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Appointments</h2>
      <QueueTable list={queue(P, hid)} mode="doctor" />
    </>
  )
}

function Rx() {
  const { hid, P } = useCur()
  const { user, RX, dispatch } = useStore()
  const patients = P.filter((p) => p.hid === hid)
  const [f, setF] = useState({ patient: '', drug: '', note: '' })
  const patient = f.patient || (patients[0] && patients[0].name) || ''
  const add = () => {
    if (!f.drug.trim() || !patient) return
    dispatch({ type: 'addRx', rx: { hid, patient, drug: f.drug, note: f.note, doctor: user.name, date: new Date().toLocaleDateString('en-GB') } })
    setF({ patient: '', drug: '', note: '' })
  }
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Prescriptions</h2>
      <div className="card form">
        <select value={patient} onChange={(e) => setF({ ...f, patient: e.target.value })}>
          {patients.map((p) => <option key={p.id}>{p.name}</option>)}
        </select>
        <input placeholder="Medicine" value={f.drug} onChange={(e) => setF({ ...f, drug: e.target.value })} />
        <input placeholder="Dosage / Notes" style={{ minWidth: 220 }} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <button onClick={add}>Add</button>
      </div>
      <br />
      <Table heads={['Date', 'Patient', 'Medicine', 'Notes', 'Doctor']} rows={RX.filter((r) => r.hid === hid).reverse().map((r) => [r.date, r.patient, r.drug, r.note, r.doctor])} />
    </>
  )
}

function Rep() {
  const { h } = useCur()
  return <ReportPage list={[h]} />
}

export const VIEWS = { dash: Dash, rec: Rec, appt: Appt, rx: Rx, rep: Rep }
export default function Doctor() {
  const [page, setPage] = useState('dash')
  const View = { dash: Dash, rec: Rec, appt: Appt, rx: Rx, rep: Rep }[page]
  return (
    <Layout nav={NAV} page={page} setPage={setPage}>
      <View />
    </Layout>
  )
}
