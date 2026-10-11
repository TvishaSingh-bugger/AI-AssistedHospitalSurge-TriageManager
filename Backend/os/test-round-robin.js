
const { roundRobin } = require("./roundRobin");

const processes = [
  { id: 1, arrivalTime: 0, burstTime: 5, priority: 2 },
  { id: 2, arrivalTime: 0, burstTime: 3, priority: 1 },
  { id: 3, arrivalTime: 1, burstTime: 1, priority: 3 },
];

const result = roundRobin(processes, 2);

console.table(
  result.map(p => ({
    id: p.id,
    completionTime: p.completionTime,
    turnaroundTime: p.turnaroundTime,
    waitingTime: p.waitingTime,
    responseTime: p.responseTime,
  }))
);
