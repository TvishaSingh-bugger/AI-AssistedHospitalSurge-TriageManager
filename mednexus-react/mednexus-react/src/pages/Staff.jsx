import { useState } from 'react'
import { useStore } from '../store.jsx'
import { Layout, Card, Table, Bar, SevTag, TypeTag, StatTag, HospPicker, StatusSelect, QueueTable, ResEditor, ReportPage } from '../ui.jsx'
import { DEPTS, NEEDS, queue } from '../data.js'

const NAV = [['dash', 'Staff Dashboard'], ['emer', 'Emergency Cases'], ['pm', 'Patient Management'], ['res', 'Resources'], ['sched', 'Scheduling'], ['rep', 'Reports']]

const useCur = () => {
  const { H, P, hid } = useStore()
  const h = H.find((x) => x.id === hid) || H[0]
  return { h, hid: h.id, P }
}

function Dash() {
  const { h, hid, P } = useCur()
  const em = queue(P, hid, 'Emergency')
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Staff Dashboard</h2>
      <div className="grid">
        <Card label="Total Emergency Cases" value={em.length} cls="s-red" />
        <Card label="Available ICU Beds" value={`${h.icu[0]} / ${h.icu[1]}`} cls="s-blue" />
        <Card label="Available Ventilators" value={`${h.vent[0]} / ${h.vent[1]}`} cls="s-green" />
        <Card label="Available Oxygen Cylinders" value={`${h.oxy[0]} / ${h.oxy[1]}`} cls="s-purple" />
        <Card label="Blood Units" value={`${h.blood[0]} / ${h.blood[1]}`} cls="s-orange" />
      </div>
      <div className="two">
        <div>
          <h2 style={{ marginTop: 0 }}>Recent Emergency Cases</h2>
          <Table heads={['ID', 'Patient', 'Priority', 'Required Resource', 'Status']} rows={em.slice(0, 5).map((p) => [p.id, p.name, <SevTag s={p.severity} />, p.need, <StatTag s={p.status} />])} />
        </div>
        <div className="card">
          <b>Resource Availability</b>
          <div style={{ marginTop: 10 }}>
            {[['ICU Beds', h.icu], ['Ventilators', h.vent], ['Oxygen Cylinders', h.oxy], ['Blood Units', h.blood]].map(([label, r]) => (
              <div key={label}>{label}<b style={{ float: 'right' }}>{r[0]} / {r[1]}</b><Bar a={r[0]} t={r[1]} /></div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function Emer() {
  const { hid, P } = useCur()
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Emergency Cases</h2>
      <QueueTable list={queue(P, hid, 'Emergency')} />
    </>
  )
}

function Pm() {
  const { hid, P } = useCur()
  const { dispatch } = useStore()
  const blank = { name: '', age: '', type: 'Regular', severity: 'Low', dept: DEPTS[0], need: 'None', reason: '' }
  const [f, setF] = useState(blank)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const add = () => {
    if (!f.name.trim()) return
    dispatch({ type: 'addPatient', p: { ...f, hid, reason: f.reason || '-' } })
    setF(blank)
  }
  const l = P.filter((p) => p.hid === hid).sort((a, b) => b.time - a.time)
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Patient Management</h2>
      <div className="card form">
        <input placeholder="Name" value={f.name} onChange={set('name')} />
        <input type="number" placeholder="Age" style={{ minWidth: 70, width: 80 }} value={f.age} onChange={set('age')} />
        <select value={f.type} onChange={set('type')}><option>Regular</option><option>Emergency</option></select>
        <select value={f.severity} onChange={set('severity')}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select>
        <select value={f.dept} onChange={set('dept')}>{DEPTS.concat(['Emergency']).map((d) => <option key={d}>{d}</option>)}</select>
        <select value={f.need} onChange={set('need')}>{NEEDS.map((n) => <option key={n}>{n}</option>)}</select>
        <input placeholder="Reason" value={f.reason} onChange={set('reason')} />
        <button onClick={add}>Add</button>
      </div>
      <br />
      <Table
        heads={['ID', 'Name', 'Age', 'Department', 'Type', 'Priority', 'Resource', 'Status', '']}
        rows={l.map((p) => [p.id, p.name, p.age, p.dept, <TypeTag t={p.type} />, <SevTag s={p.severity} />, p.need, <StatusSelect p={p} />,
          <button className="light" onClick={() => dispatch({ type: 'removePatient', id: p.id })}>Remove</button>])}
      />
    </>
  )
}

function Res() {
  const { h } = useCur()
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Resources</h2>
      <ResEditor key={JSON.stringify(h)} list={[h]} />
    </>
  )
}

function Sched() {
  const { h, hid, P } = useCur()
  const [flt, setFlt] = useState('All')
  const l = queue(P, hid).filter((p) => flt === 'All' || p.type === flt)
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Scheduling - {h.name}</h2>
      <div className="row">
        {['All', 'Emergency', 'Regular'].map((f) => <button key={f} className={f === flt ? '' : 'light'} onClick={() => setFlt(f)}>{f}</button>)}
      </div>
      <QueueTable list={l} />
    </>
  )
}

function Rep() {
  const { h } = useCur()
  return <ReportPage list={[h]} />
}

export const VIEWS = { dash: Dash, emer: Emer, pm: Pm, res: Res, sched: Sched, rep: Rep }
export default function Staff() {
  const [page, setPage] = useState('dash')
  const View = { dash: Dash, emer: Emer, pm: Pm, res: Res, sched: Sched, rep: Rep }[page]
  return (
    <Layout nav={NAV} page={page} setPage={setPage}>
      <View />
    </Layout>
  )
}
