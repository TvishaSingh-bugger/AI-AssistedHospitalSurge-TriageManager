const pool = require("./db");
const { getHospitalCases } = require("./databaseCases");
const { criticalSection } = require("./criticalSection");
const { allocateResource, releaseResource } = require("./resourceManager");
const { addWaitingCase, removeWaitingCase } = require("./resourceWaiting");
const { applyAging } = require("./aging");
const { detectStarvation } = require("./starvation");
const { nowUnits } = require("./simClock");

const AGING_LIMIT = 5;
const STARVATION_LIMIT = 10;
const TERMINAL = ["Completed", "Cancelled"];

async function logEvent(hospitalId, caseId, type, message) {
  await pool.execute(
    `INSERT INTO system_events (hospital_id, case_id, event_type, event_message)
     VALUES (?, ?, ?, ?)`,
    [hospitalId, caseId, type, String(message).slice(0, 500)]
  );
}

async function consumeQueueEntries(caseId) {
  await pool.execute(
    `UPDATE queue_entries
     SET queue_status = 'CONSUMED', removed_at = NOW()
     WHERE case_id = ? AND removed_at IS NULL`,
    [caseId]
  );
}

// Allocates every resource the case needs (inside the critical section) and marks it Running.
// If something is missing, everything taken so far is released and the case goes to the
// resource-waiting queue. Shared by dispatchNext() and by the doctor's "Start" button.
async function startCaseResources(hospitalId, caseId) {
  const [needs] = await pool.execute(
    `SELECT resource_type, blood_group, required_quantity
     FROM case_resource_requirements
     WHERE case_id = ?`,
    [caseId]
  );

  if (needs.length === 0) {
    throw new Error("No resource requirements found for this case");
  }

  const given = [];

  try {
    await criticalSection(async () => {
      // Fetch existing active allocations using resource_inventory.
      const [existing] = await pool.execute(
        `SELECT
            ri.resource_type,
            ri.blood_group,
            ra.quantity
         FROM resource_allocations ra
         JOIN resource_inventory ri
           ON ra.resource_id = ri.resource_id
         WHERE ra.case_id = ?
           AND ra.allocation_status = 'Allocated'`,
        [caseId]
      );

      // Track existing allocations and allocations made during this attempt.
      const allocated = existing.map(a => ({
        resource_type: a.resource_type,
        blood_group: a.blood_group ?? null,
        quantity: Number(a.quantity)
      }));

      for (const need of needs) {
        const required = Number(need.required_quantity);

        const alreadyAllocated = allocated
          .filter(a =>
            a.resource_type === need.resource_type &&
            (a.blood_group ?? null) === (need.blood_group ?? null)
          )
          .reduce((sum, a) => sum + a.quantity, 0);

        const missing = required - alreadyAllocated;

        if (missing <= 0) continue;

        const result = await allocateResource({
          caseId,
          resourceType: need.resource_type,
          bloodGroup: need.blood_group,
          quantity: missing
        });

        given.push(result.allocationId);

        // Update tracking so subsequent requirements don't duplicate allocation.
        allocated.push({
          resource_type: need.resource_type,
          blood_group: need.blood_group ?? null,
          quantity: missing
        });
      }
    });
  } catch (err) {
    // Release only allocations created during this attempt.
    await criticalSection(async () => {
      for (const allocationId of given) {
        try {
          await releaseResource(allocationId);
        } catch (releaseErr) {
          await logEvent(
            hospitalId,
            caseId,
            "RESOURCE_ROLLBACK_ERROR",
            releaseErr.message
          );
        }
      }
    });

    await pool.execute(
      `UPDATE emergency_cases
       SET process_state = 'Waiting'
       WHERE case_id = ?`,
      [caseId]
    );

    await consumeQueueEntries(caseId);

    // Avoid creating duplicate waiting queue entries.
    const [queueRows] = await pool.execute(
      `SELECT case_id
       FROM queue_entries
       WHERE case_id = ?
         AND queue_type = 'RESOURCE_WAITING'
         AND queue_status = 'QUEUED'
         AND removed_at IS NULL`,
      [caseId]
    );

    if (queueRows.length === 0) {
      await pool.execute(
        `INSERT INTO queue_entries
           (hospital_id, case_id, queue_type, queue_position, queue_status)
         SELECT ?, ?, 'RESOURCE_WAITING',
                COALESCE(MAX(queue_position), 0) + 1, 'QUEUED'
         FROM queue_entries
         WHERE hospital_id = ?
           AND queue_type = 'RESOURCE_WAITING'`,
        [hospitalId, caseId, hospitalId]
      );
    }

    addWaitingCase({ id: caseId });

    await logEvent(
      hospitalId,
      caseId,
      "RESOURCE_WAIT",
      err.message
    );

    return {
      status: "WAITING",
      caseId,
      reason: err.message
    };
  }

  // All required resources are satisfied.
  await pool.execute(
    `UPDATE emergency_cases
     SET process_state = 'Running'
     WHERE case_id = ?`,
    [caseId]
  );

  await consumeQueueEntries(caseId);

  return {
    status: "RUNNING",
    caseId,
    allocations: given
  };
}

async function dispatchNext(hospitalId) {
  const cases = await getHospitalCases(hospitalId);
  if (cases.length === 0) {
    return { status: "EMPTY", message: "No cases waiting" };
  }

  const now = await nowUnits();

  const original = new Map(cases.map(c => [c.id, c.priority]));
  const aged = applyAging(cases, now, AGING_LIMIT);

  for (const c of aged) {
    if (c.priority > original.get(c.id)) {
      await logEvent(
        hospitalId, c.id, "AGING_APPLIED",
        `Priority ${original.get(c.id)} -> ${c.priority} after waiting`
      );
    }
  }

  const starving = detectStarvation(aged, now, STARVATION_LIMIT);
  for (const s of starving) {
    await logEvent(
      hospitalId, s.id, "STARVATION_WARNING",
      `Case has waited ${s.waitingElapsed} minutes`
    );
  }

  aged.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.arrivalTime - b.arrivalTime ||
      a.id - b.id
  );
  const next = aged[0];
  await logEvent(hospitalId, next.id, "CASE_DEQUEUED", "Case picked by scheduler");

  const outcome = await startCaseResources(hospitalId, next.id);

  return {
    ...outcome,
    priority: next.priority,
    originalPriority: original.get(next.id),
    starvingCases: starving.map(s => s.id)
  };
}

// Start one specific case (doctor / staff pressing "Start").
async function startCase(caseId) {
  const [rows] = await pool.execute(
    "SELECT hospital_id, process_state FROM emergency_cases WHERE case_id = ?",
    [caseId]
  );
  if (rows.length === 0) {
    throw Object.assign(new Error("Emergency case not found"), { status: 404 });
  }
  if (TERMINAL.includes(rows[0].process_state)) {
    throw Object.assign(new Error("This case is already completed or cancelled"), { status: 409 });
  }
  if (rows[0].process_state === "Running") {
    return { status: "RUNNING", caseId, allocations: [] };
  }
  await logEvent(rows[0].hospital_id, caseId, "CASE_DEQUEUED", "Case started manually");
  return startCaseResources(rows[0].hospital_id, caseId);
}

async function completeCase(caseId, finalState = "Completed") {
  const [rows] = await pool.execute(
    "SELECT hospital_id FROM emergency_cases WHERE case_id = ?",
    [caseId]
  );
  if (rows.length === 0) {
    throw Object.assign(new Error("Emergency case not found"), { status: 404 });
  }
  const hospitalId = rows[0].hospital_id;

  const [allocs] = await pool.execute(
    `SELECT allocation_id FROM resource_allocations
     WHERE case_id = ? AND allocation_status = 'Allocated'`,
    [caseId]
  );

  const released = [];
  await criticalSection(async () => {
    for (const a of allocs) {
      await releaseResource(Number(a.allocation_id));
      released.push(Number(a.allocation_id));
    }
  });

  await pool.execute(
    "UPDATE emergency_cases SET process_state = ? WHERE case_id = ?",
    [finalState, caseId]
  );
  await consumeQueueEntries(caseId);

  // Freed resources: give cases that were waiting for resources another chance.
  const [waiting] = await pool.execute(
    `SELECT case_id FROM emergency_cases
     WHERE hospital_id = ? AND process_state = 'Waiting'`,
    [hospitalId]
  );
  for (const w of waiting) {
    removeWaitingCase(w.case_id);
  }
  await pool.execute(
    `UPDATE emergency_cases SET process_state = 'Ready'
     WHERE hospital_id = ? AND process_state = 'Waiting'`,
    [hospitalId]
  );
  await pool.execute(
    `UPDATE queue_entries
     SET queue_status = 'CONSUMED', removed_at = NOW()
     WHERE hospital_id = ? AND queue_type = 'RESOURCE_WAITING'
       AND removed_at IS NULL`,
    [hospitalId]
  );

  await logEvent(
    hospitalId,
    caseId,
    "RESOURCE_RELEASED",
    `Case ${finalState}; released ${released.length} allocation(s)`
  );

  return {
    caseId,
    state: finalState,
    releasedAllocations: released,
    waitingCasesReconsidered: waiting.length
  };
}

module.exports = { dispatchNext, startCase, completeCase };
