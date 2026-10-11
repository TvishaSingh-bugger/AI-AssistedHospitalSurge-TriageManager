
const { sjf } = require("./sjf");

const processes = [
  { id: "P1", arrivalTime: 0, burstTime: 7 },
  { id: "P2", arrivalTime: 2, burstTime: 4 },
  { id: "P3", arrivalTime: 1, burstTime: 2 },
  { id: "P4", arrivalTime: 3, burstTime: 1 }
];

const results = sjf(processes);

console.table(
  results.map(p => ({
    ID: p.id,
    Arrival: p.arrivalTime,
    Burst: p.burstTime,
    Start: p.startTime,
    Completion: p.completionTime,
    Waiting: p.waitingTime,
    Turnaround: p.turnaroundTime,
    Response: p.responseTime
  }))
);
