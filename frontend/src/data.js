
export const RANK = {
  Critical: 1,
  High: 2,
  Medium: 3,
  Low: 4,
}

export const HEALTH = {
  Critical: 'Critical',
  High: 'High Risk',
  Medium: 'Observation',
  Low: 'Stable',
}

export const NEEDS = [
  'None',
  'ICU',
  'ICU + Ventilator',
  'Oxygen',
  'Observation',
]

const LABEL = {
  NEW: 'Queued',
  Ready: 'Ready',
  Waiting: 'Awaiting Resources',
  Running: 'In Treatment',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Booked: 'Booked',
  Confirmed: 'Confirmed',
  'In Progress': 'In Progress',
}

export const statusLabel = (s) => LABEL[s] || s || 'Unknown'

export const CASE_STATUSES = [
  'Ready',
  'Running',
  'Waiting',
  'Completed',
  'Cancelled',
]

export const APPT_STATUSES = [
  'Booked',
  'Confirmed',
  'In Progress',
  'Completed',
  'Cancelled',
]

export const isDone = (p) =>
  ['Completed', 'Cancelled'].includes(p?.status)

export const canPatientCancel = (p) => {
  if (!p) return false

  return p.kind === 'case'
    ? ['NEW', 'Ready', 'Waiting'].includes(p.status)
    : ['Booked', 'Confirmed'].includes(p.status)
}

// Appointment slots: 09:00 to 17:30
export const SLOTS = Array.from({ length: 18 }, (_, i) => {
  const mins = 9 * 60 + i * 30
  const hh = String(Math.floor(mins / 60)).padStart(2, '0')
  const mm = String(mins % 60).padStart(2, '0')

  const h12 = ((Math.floor(mins / 60) + 11) % 12) + 1

  return {
    value: `${hh}:${mm}`,
    label: `${String(h12).padStart(2, '0')}:${mm} ${
      mins < 12 * 60 ? 'AM' : 'PM'
    }`,
  }
})

// Emergency cases are ranked ahead of non-emergency cases.
// Severity is used as a secondary ranking.
export const score = (p) =>
  (p?.type === 'Emergency' ? 0 : 10) +
  (RANK[p?.severity] || 99)

export const queue = (records = [], type) =>
  [...records]
    .filter(
      (p) =>
        !isDone(p) &&
        (!type || p.type === type)
    )
    .sort(
      (a, b) =>
        score(a) - score(b) ||
        (Number(a.time) || 0) - (Number(b.time) || 0)
    )

export const fmtDate = (p) =>
  p?.time ? new Date(p.time).toLocaleDateString('en-GB') : '—'

export const fmtTime = (p) =>
  p?.time
    ? new Date(p.time).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

export const fmtStamp = (t) =>
  t
    ? new Date(t).toLocaleString('en-GB', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—'

export function healthCounts(list = []) {
  const counts = {}

  list.forEach((p) => {
    const h = HEALTH[p?.severity] || 'Unknown'
    counts[h] = (counts[h] || 0) + 1
  })

  return counts
}

// Resource alert calculation based on actual resource values
// supplied by the backend and the alert threshold setting.
export function getAlerts(hospitals = [], S = {}, max = 8) {
  const out = []
  const threshold = (Number(S.threshold) || 0) / 100

  for (const h of hospitals) {
    if (!h) continue

    for (const [key, name] of [
      ['icu', 'ICU'],
      ['vent', 'Ventilator'],
      ['oxy', 'Oxygen'],
    ]) {
      const resource = h[key]

      if (!Array.isArray(resource) || resource.length < 2) continue

      const [available, total] = resource

      if (
        Number(total) > 0 &&
        Number(available) / Number(total) <= threshold
      ) {
        out.push({
          lvl: Number(available) === 0 ? 'red' : 'orange',
          text: `${name} low in ${h.name} (${available}/${total})`,
          a: Number(available),
        })
      }
    }
  }

  return out
    .sort((x, y) => x.a - y.a)
    .slice(0, max)
}

export const hospitalStatus = (h) => {
  if (!h || !Array.isArray(h.icu) || !Array.isArray(h.beds)) {
    return ['Unknown', 'orange-t', 1]
  }

  if (h.icu[0] + h.beds[0] === 0) {
    return ['Full', 'red-t', 2]
  }

  if (h.icu[0] <= 1 || h.beds[0] <= 5) {
    return ['Limited', 'orange-t', 1]
  }

  return ['Available', 'green-t', 0]
}

export const needForSeverity = (sev) => {
  switch (sev) {
    case 'Critical':
      return 'ICU + Ventilator'
    case 'High':
      return 'ICU'
    case 'Medium':
      return 'Observation'
    default:
      return 'Observation'
  }
}
