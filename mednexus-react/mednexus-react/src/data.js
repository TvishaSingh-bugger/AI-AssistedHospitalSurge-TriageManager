const mins = (n) => Date.now() - n * 60000

export const SEED_H = [
  { id: 1, name: 'Geeta Hospital', dist: 2.1, icu: [5, 10], vent: [3, 8], oxy: [12, 20], beds: [20, 60], blood: [8, 15] },
  { id: 2, name: 'City Hospital', dist: 3.4, icu: [4, 8], vent: [2, 6], oxy: [10, 18], beds: [12, 50], blood: [6, 12] },
  { id: 3, name: 'Sunrise Hospital', dist: 5.0, icu: [6, 12], vent: [4, 10], oxy: [15, 25], beds: [30, 80], blood: [10, 20] },
  { id: 4, name: 'LifeCare Hospital', dist: 6.8, icu: [0, 8], vent: [0, 5], oxy: [8, 15], beds: [0, 40], blood: [4, 10] },
  { id: 5, name: 'Apollo Care', dist: 8.2, icu: [3, 10], vent: [2, 7], oxy: [9, 16], beds: [14, 55], blood: [5, 12] },
]

export const SEED_P = [
  { id: 'E1021', name: 'Rohan Sharma', age: 45, dept: 'Emergency', hid: 1, type: 'Emergency', severity: 'Critical', need: 'ICU + Ventilator', reason: 'Chest Pain', status: 'Waiting', time: mins(10) },
  { id: 'E1020', name: 'Neha Verma', age: 32, dept: 'Emergency', hid: 1, type: 'Emergency', severity: 'High', need: 'ICU', reason: 'Injury', status: 'Allocated', time: mins(25) },
  { id: 'E1019', name: 'Aarav Singh', age: 28, dept: 'Emergency', hid: 1, type: 'Emergency', severity: 'Medium', need: 'Oxygen', reason: 'Breathing Issue', status: 'Allocated', time: mins(40) },
  { id: 'E1018', name: 'Priya Patel', age: 36, dept: 'Emergency', hid: 1, type: 'Emergency', severity: 'High', need: 'ICU', reason: 'Accident', status: 'Waiting', time: mins(50) },
  { id: 'E1017', name: 'Mohit Kumar', age: 50, dept: 'Emergency', hid: 1, type: 'Emergency', severity: 'Low', need: 'Observation', reason: 'Dizziness', status: 'Admitted', time: mins(80) },
  { id: 'R1016', name: 'Ankit Rao', age: 36, dept: 'General Medicine', hid: 1, type: 'Regular', severity: 'Low', need: 'None', reason: 'Fever', status: 'Waiting', time: mins(100), slot: '04:30 PM' },
  { id: 'R1015', name: 'Pooja Jain', age: 52, dept: 'Orthopedics', hid: 1, type: 'Regular', severity: 'Medium', need: 'None', reason: 'Knee Pain', status: 'Waiting', time: mins(120), slot: '02:00 PM' },
  { id: 'R1014', name: 'Tarun Das', age: 40, dept: 'Cardiology', hid: 1, type: 'Regular', severity: 'Low', need: 'None', reason: 'Checkup', status: 'Completed', time: mins(300), slot: '09:00 AM' },
  { id: 'E1013', name: 'Sita Devi', age: 60, dept: 'Emergency', hid: 2, type: 'Emergency', severity: 'High', need: 'ICU', reason: 'Breathing Issue', status: 'Waiting', time: mins(15) },
  { id: 'R1012', name: 'Amit Yadav', age: 30, dept: 'General Medicine', hid: 2, type: 'Regular', severity: 'Low', need: 'None', reason: 'Checkup', status: 'Waiting', time: mins(70), slot: '11:00 AM' },
  { id: 'R1011', name: 'Kiran Rao', age: 47, dept: 'Orthopedics', hid: 3, type: 'Regular', severity: 'Medium', need: 'None', reason: 'Knee Pain', status: 'Waiting', time: mins(45), slot: '12:00 PM' },
]

export const SEED_U = [
  { id: 1, name: 'Rashi Srivastava', email: 'rashi@mednexus.com', role: 'staff', hid: 1 },
  { id: 2, name: 'Dr. Arjun Mehta', email: 'arjun@mednexus.com', role: 'doctor', hid: 1 },
  { id: 3, name: 'Vikas Rana', email: 'vikas@mednexus.com', role: 'staff', hid: 2 },
  { id: 4, name: 'Dr. Neha Gupta', email: 'neha@mednexus.com', role: 'doctor', hid: 2 },
  { id: 5, name: 'Simran Preet Kaur', email: 'simran@mail.com', role: 'patient', hid: 0 },
  { id: 6, name: 'Admin', email: 'admin@mednexus.com', role: 'admin', hid: 0 },
]

export const RANK = { Critical: 1, High: 2, Medium: 3, Low: 4 }
export const STATUSES = ['Waiting', 'Allocated', 'Admitted', 'In Progress', 'Completed']
export const NEEDS = ['None', 'ICU', 'ICU + Ventilator', 'Oxygen', 'Observation']
export const DEPTS = ['General Medicine', 'Orthopedics', 'Cardiology', 'Pediatrics', 'ENT']
export const HEALTH = { Critical: 'Critical', High: 'High Risk', Medium: 'Observation', Low: 'Stable' }
export const SLOTS = ['09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM']

// emergency patients always come first, then by severity, then by arrival time
export const score = (p) => (p.type === 'Emergency' ? 0 : 10) + RANK[p.severity]

export const queue = (P, hid, type) =>
  P.filter((p) => p.hid === hid && p.status !== 'Completed' && (!type || p.type === type))
    .sort((a, b) => score(a) - score(b) || a.time - b.time)

export const newId = (P, type) =>
  (type === 'Emergency' ? 'E' : 'R') + (Math.max(1000, ...P.map((p) => +p.id.slice(1) || 0)) + 1)

export const needKeys = (n) =>
  n === 'ICU' ? ['icu'] : n === 'ICU + Ventilator' ? ['icu', 'vent'] : n === 'Oxygen' ? ['oxy'] : []

export const holds = (p) => !['Waiting', 'Completed'].includes(p.status) && needKeys(p.need).length > 0

export const fmtDate = (p) => p.date || new Date(p.time).toLocaleDateString('en-GB')
export const fmtTime = (p) => p.slot || new Date(p.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function healthCounts(list) {
  const c = {}
  list.forEach((p) => {
    const h = HEALTH[p.severity]
    c[h] = (c[h] || 0) + 1
  })
  return c
}

export function getAlerts(hospitals, P, S) {
  const out = []
  const t = S.threshold / 100
  hospitals.forEach((h) => {
    ;[['icu', 'ICU'], ['vent', 'Ventilator'], ['oxy', 'Oxygen']].forEach(([k, n]) => {
      const [a, tot] = h[k]
      if (tot && a / tot <= t) out.push({ lvl: a === 0 ? 'red' : 'orange', text: `${n} low in ${h.name} (${a}/${tot})` })
    })
    const need = P.filter((p) => p.hid === h.id && p.status === 'Waiting' && needKeys(p.need).includes('icu')).length
    if (need > h.icu[0]) out.push({ lvl: 'red', text: `ICU shortage predicted for ${h.name} (${need} waiting, ${h.icu[0]} free)` })
  })
  return out
}

export const hospitalStatus = (h) => {
  if (h.icu[0] + h.beds[0] === 0) return ['Full', 'red-t', 2]
  if (h.icu[0] <= 1 || h.beds[0] <= 5) return ['Limited', 'orange-t', 1]
  return ['Available', 'green-t', 0]
}
