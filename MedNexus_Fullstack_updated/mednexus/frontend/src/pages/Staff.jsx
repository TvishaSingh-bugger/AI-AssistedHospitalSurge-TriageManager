import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Layout, Card, Table, Bar, SevTag, TypeTag, StatTag, HospPicker, StatusSelect, QueueTable, ResEditor, ReportPage, ForecastCard } from '../ui.jsx'
import { NEEDS, queue, fmtDate, fmtTime, isDone } from '../data.js'

const NAV = [['dash', 'Staff Dashboard'], ['emer', 'Emergency Cases'], ['pm', 'Patient Management'], ['res', 'Resources'], ['sched', 'Scheduling'], ['rep', 'Reports']]

const useCur = () => {
  const { hospital, hid, records } = useStore()
  return { h: hospital, hid, records }
}

const Loading = () => <div className="spin">Loading hospital data...</div>

function Dash() {
  const { h, hid, records } = useCur()
  if (!h) return <Loading />
  const em = queue(records, 'Emergency')
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Staff Dashboard</h2>
      <div className="grid">
        <Card label="Active Emergency Cases" value={em.length} cls="s-red" />
        <Card label="Available ICU Beds" value={`${h.icu[0]} / ${h.icu[1]}`} cls="s-blue" />
        <Card label="Available Ventilators" value={`${h.vent[0]} / ${h.vent[1]}`} cls="s-green" />
        <Card label="Available Oxygen Cylinders" value={`${h.oxy[0]} / ${h.oxy[1]}`} cls="s-purple" />
        <Card label="Blood Units" value={`${h.blood[0]} / ${h.blood[1]}`} cls="s-orange" />
      </div>
      <div className="two">
        <div>
          <h2 style={{ marginTop: 0 }}>Recent Emergency Cases</h2>
          <Table heads={['ID', 'Patient', 'Priority', 'Required Resource', 'Status']} rows={em.slice(0, 5).map((p) => [p.code, p.name, <SevTag s={p.severity} />, p.need, <StatTag s={p.status} />])} empty="No active emergency cases" />
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <b>Resource Availability</b>
            <div style={{ marginTop: 10 }}>
              {[['ICU Beds', h.icu], ['Ventilators', h.vent], ['Oxygen Cylinders', h.oxy], ['General Beds', h.beds], ['Blood Units', h.blood]].map(([label, r]) => (
                <div key={label}>{label}<b style={{ float: 'right' }}>{r[0]} / {r[1]}</b><Bar a={r[0]} t={r[1]} /></div>
              ))}
            </div>
          </div>
          <ForecastCard hid={hid} />
        </div>
      </div>
    </>
  )
}

function Emer() {
  const { records } = useCur()
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Emergency Cases</h2>
      <QueueTable list={queue(records, 'Emergency')} />
    </>
  )
}

function Pm() {
  const { hid, records } = useCur()
  const { act } = useStore()
  const blank = { name: '', age: '', type: 'Regular', severity: 'Low', need: 'None', reason: '', doctor_id: '' }
  const [f, setF] = useState(blank)
  const [doctors, setDoctors] = useState([])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  useEffect(() => {
    if (hid) api.get(`/portal/hospitals/${hid}/doctors`).then((r) => setDoctors(r.data))
  }, [hid])

  const add = async () => {
    if (!f.name.trim()) return
    const ok = await act(() => api.post(`/portal/hospitals/${hid}/walk-in`, f), 'Patient registered')
    if (ok) setF(blank)
  }
  const cancel = (p) => act(() => api.put(`/portal/records/${p.kind}/${p.id}/status`, { status: 'Cancelled' }), 'Removed from the queue')

  const l = [...records].sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || b.time - a.time)
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Patient Management</h2>
      <div className="card form">
        <input placeholder="Name" value={f.name} onChange={set('name')} />
        <input type="number" placeholder="Age" style={{ minWidth: 70, width: 80 }} value={f.age} onChange={set('age')} />
        <select value={f.type} onChange={set('type')}><option>Regular</option><option>Emergency</option></select>
        {f.type === 'Emergency' ? (
          <>
            <select value={f.severity} onChange={set('severity')}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select>
            <select value={f.need} onChange={set('need')}>{NEEDS.map((n) => <option key={n}>{n}</option>)}</select>
          </>
        ) : (
          <select value={f.doctor_id} onChange={set('doctor_id')}>
            <option value="">Next available doctor</option>
            {doctors.map((d) => <option key={d.staff_id} value={d.staff_id}>{d.staff_name}</option>)}
          </select>
        )}
        <input placeholder="Reason" value={f.reason} onChange={set('reason')} />
        <button onClick={add}>Add</button>
      </div>
      <br />
      <Table
        heads={['ID', 'Name', 'Age', 'Doctor / Dept', 'Type', 'Priority', 'Resource', 'Status', '']}
        rows={l.map((p) => [p.code, p.name, p.age ?? '-', p.dept, <TypeTag t={p.type} />, <SevTag s={p.severity} />, p.need, <StatusSelect p={p} />,
          isDone(p) ? '' : <button className="light small" onClick={() => cancel(p)}>Remove</button>])}
        empty="No patients yet"
      />
    </>
  )
}

function Res() {
  const { h } = useCur()
  if (!h) return <Loading />
  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Resources</h2>
      <ResEditor key={JSON.stringify([h.id, h.icu, h.vent, h.oxy, h.beds, h.blood])} hospital={h} />
    </>
  )
}

const ALGORITHMS = [['FCFS', 'First Come First Served'], ['SJF', 'Shortest Job First'], ['PRIORITY', 'Priority (with aging)'], ['ROUND_ROBIN', 'Round Robin']]

function Sched() {
  const { h, hid, records } = useCur()
  const { act } = useStore()
  const [flt, setFlt] = useState('All')
  const [algo, setAlgo] = useState('PRIORITY')
  const [quantum, setQuantum] = useState(3)
  const [run, setRun] = useState(null)
  if (!h) return <Loading />

  const l = queue(records, null).filter((p) => flt === 'All' || p.type === flt)
  const codeOf = (id) => (records.find((r) => r.kind === 'case' && r.id === id) || {}).code || `case ${id}`
  const avg = (key) => (run && run.results.length ? (run.results.reduce((s, r) => s + r[key], 0) / run.results.length).toFixed(1) : '-')

  const runSched = async () => {
    const r = await act(() => api.post('/scheduling/run', { hospitalId: hid, algorithm: algo, timeQuantum: algo === 'ROUND_ROBIN' ? Number(quantum) : undefined }))
    if (r && r.data) setRun(r.data)
  }
  const dispatch = () => act(async () => {
    const r = await api.post('/scheduling/next', { hospitalId: hid })
    const d = r.data
    return {
      outcome: d.status,
      message: d.status === 'EMPTY' ? 'No cases waiting' : d.status === 'RUNNING'
        ? `${codeOf(d.caseId)} started (priority ${d.originalPriority} -> ${d.priority} after aging)`
        : `${codeOf(d.caseId)} is waiting for resources: ${d.reason}`,
    }
  })

  return (
    <>
      <HospPicker />
      <h2 style={{ marginTop: 0 }}>Scheduling - {h.name}</h2>
      <div className="row">
        {['All', 'Emergency', 'Regular'].map((f) => <button key={f} className={f === flt ? '' : 'light'} onClick={() => setFlt(f)}>{f}</button>)}
      </div>
      <QueueTable list={l} />

      <div className="card" style={{ marginTop: 16 }}>
        <b>Scheduler</b>
        <div className="note">Works on the emergency cases that are queued (Queued / Ready). "Dispatch next" really starts the top case and allocates its ICU / ventilator / oxygen resources.</div>
        <div className="form" style={{ marginTop: 10 }}>
          <select value={algo} onChange={(e) => setAlgo(e.target.value)}>{ALGORITHMS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
          {algo === 'ROUND_ROBIN' && <input type="number" min="1" style={{ width: 90 }} value={quantum} onChange={(e) => setQuantum(e.target.value)} title="Time quantum (minutes)" />}
          <button onClick={runSched}>Run simulation</button>
          <button className="green" onClick={dispatch}>Dispatch next case</button>
        </div>
      </div>

      {run && (
        <>
          <h2>Result - {run.algorithm.replace('_', ' ')} (run #{run.runId || '-'})</h2>
          {run.results.length === 0 ? <div className="card">No queued emergency cases to schedule.</div> : (
            <>
              <div className="grid">
                <Card label="Cases scheduled" value={run.results.length} cls="s-blue" />
                <Card label="Avg waiting time (min)" value={avg('waitingTime')} cls="s-orange" />
                <Card label="Avg turnaround (min)" value={avg('turnaroundTime')} cls="s-purple" />
                <Card label="Avg response (min)" value={avg('responseTime')} cls="s-green" />
              </div>
              <Table
                heads={['Order', 'Case', 'Priority', 'Burst', 'Start', 'Finish', 'Waiting', 'Turnaround']}
                rows={run.results.slice(0, 60).map((r, i) => [i + 1, codeOf(r.id), r.priority, r.burstTime, r.startTime, r.completionTime, r.waitingTime, r.turnaroundTime])}
              />
              {run.results.length > 60 && <div className="note">Showing the first 60 of {run.results.length}.</div>}
            </>
          )}
        </>
      )}
    </>
  )
}

function Rep() {
  const { h } = useCur()
  if (!h) return <Loading />
  return <ReportPage hospitals={[h]} />
}

export default function Staff() {
  const [page, setPage] = useState('dash')
  const View = { dash: Dash, emer: Emer, pm: Pm, res: Res, sched: Sched, rep: Rep }[page]
  return (
    <Layout nav={NAV} page={page} setPage={setPage}>
      <View />
    </Layout>
  )
}
