// Constants and pure helper functions shared by the pages.
// A "record" is what the backend returns from /api/portal/...: either an emergency case
// (kind 'case', status = process_state) or an appointment (kind 'appt', status = appointment_status).

export const RANK = { Critical: 1, High: 2, Medium: 3, Low: 4 }
export const HEALTH = { Critical: 'Critical', High: 'High Risk', Medium: 'Observation', Low: 'Stable' }
export const NEEDS = ['None', 'ICU', 'ICU + Ventilator', 'Oxygen', 'Observation']

const LABEL = { NEW: 'Queued', Ready: 'Ready', Waiting: 'Awaiting Resources', Running: 'In Treatment' }
export const statusLabel = (s) => LABEL[s] || s

export const CASE_STATUSES = ['Ready', 'Running', 'Waiting', 'Completed', 'Cancelled']
export const APPT_STATUSES = ['Booked', 'Confirmed', 'In Progress', 'Completed', 'Cancelled']

export const isDone = (p) => p.status === 'Completed' || p.status === 'Cancelled'
export const canPatientCancel = (p) =>
  p.kind === 'case' ? ['NEW', 'Ready', 'Waiting'].includes(p.status) : ['Booked', 'Confirmed'].includes(p.status)

// 09:00 ... 17:30 in half-hour steps
export const SLOTS = Array.from({ length: 18 }, (_, i) => {
  const mins = 9 * 60 + i * 30
  const hh = String(Math.floor(mins / 60)).padStart(2, '0')
  const mm = String(mins % 60).padStart(2, '0')
  const h12 = ((Math.floor(mins / 60) + 11) % 12) + 1
  return { value: `${hh}:${mm}`, label: `${String(h12).padStart(2, '0')}:${mm} ${mins < 12 * 60 ? 'AM' : 'PM'}` }
})

// emergency patients come first, then by severity, then by arrival time
export const score = (p) => (p.type === 'Emergency' ? 0 : 10) + RANK[p.severity]

export const queue = (records, type) =>
  records
    .filter((p) => !isDone(p) && (!type || p.type === type))
    .sort((a, b) => score(a) - score(b) || a.time - b.time)

export const fmtDate = (p) => new Date(p.time).toLocaleDateString('en-GB')
export const fmtTime = (p) => new Date(p.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export const fmtStamp = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })

export function healthCounts(list) {
  const c = {}
  list.forEach((p) => {
    const h = HEALTH[p.severity]
    c[h] = (c[h] || 0) + 1
  })
  return c
}

// Low-resource alerts (threshold is the admin "low resource alert" setting, % free).
export function getAlerts(hospitals, S, max = 8) {
  const out = []
  const t = S.threshold / 100
  for (const h of hospitals) {
    for (const [k, n] of [['icu', 'ICU'], ['vent', 'Ventilator'], ['oxy', 'Oxygen']]) {
      const [a, tot] = h[k]
      if (tot && a / tot <= t) out.push({ lvl: a === 0 ? 'red' : 'orange', text: `${n} low in ${h.name} (${a}/${tot})`, a })
    }
  }
  return out.sort((x, y) => x.a - y.a).slice(0, max)
}

export const hospitalStatus = (h) => {
  if (h.icu[0] + h.beds[0] === 0) return ['Full', 'red-t', 2]
  if (h.icu[0] <= 1 || h.beds[0] <= 5) return ['Limited', 'orange-t', 1]
  return ['Available', 'green-t', 0]
}

export const needForSeverity = (sev) => (sev === 'Critical' ? 'ICU + Ventilator' : sev === 'High' ? 'ICU' : 'Observation')
