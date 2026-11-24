const pool = require("./db");

const allowedResources = new Set([
  "ICU_BED",
  "GENERAL_BED",
  "VENTILATOR",
  "OXYGEN_CYLINDER",
  "OXYGEN_SUPPLY",
  "BLOOD_UNIT"
]);

async function getResources(hospitalId) {
  const [rows] = await pool.execute(
    `SELECT *
     FROM resource_inventory
     WHERE hospital_id = ?
     ORDER BY resource_type, blood_group`,
    [hospitalId]
  );

  return rows;
}

async function allocateResource({
  caseId,
  resourceType,
  quantity = 1,
  bloodGroup = null
}) {
  if (!Number.isInteger(caseId) || caseId <= 0) {
    throw new Error("caseId must be a positive integer");
  }

  if (!allowedResources.has(resourceType)) {
    throw new Error("Invalid resourceType");
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [cases] = await connection.execute(
      `SELECT case_id, hospital_id
       FROM emergency_cases
       WHERE case_id = ?
       FOR UPDATE`,
      [caseId]
    );

    if (cases.length === 0) {
      throw new Error("Emergency case not found");
    }

    const hospitalId = cases[0].hospital_id;

    const [resources] = await connection.execute(
      `SELECT resource_id, total_quantity, available_quantity
       FROM resource_inventory
       WHERE hospital_id = ?
         AND resource_type = ?
         AND (blood_group <=> ?)
       FOR UPDATE`,
      [hospitalId, resourceType, bloodGroup]
    );

    if (resources.length === 0) {
      throw new Error("Resource not found for this hospital");
    }

    const resource = resources[0];

    if (resource.available_quantity < quantity) {
      throw new Error("Insufficient resource quantity");
    }

    await connection.execute(
      `UPDATE resource_inventory
       SET available_quantity = available_quantity - ?
       WHERE resource_id = ?`,
      [quantity, resource.resource_id]
    );

    const [allocationResult] = await connection.execute(
      `INSERT INTO resource_allocations
       (case_id, resource_id, quantity, allocation_status)
       VALUES (?, ?, ?, 'Allocated')`,
      [caseId, resource.resource_id, quantity]
    );

    const newAvailable =
      resource.available_quantity - quantity;

    await connection.execute(
      `INSERT INTO resource_history
       (resource_id, recorded_at, total_quantity,
        available_quantity, used_quantity, source)
       VALUES (?, NOW(), ?, ?, ?, 'ALLOCATION')`,
      [
        resource.resource_id,
        resource.total_quantity,
        newAvailable,
        resource.total_quantity - newAvailable
      ]
    );

    await connection.execute(
      `INSERT INTO system_events
       (hospital_id, case_id, event_type, event_message, metadata)
       VALUES (?, ?, 'RESOURCE_ALLOCATED', ?, ?)`,
      [
        hospitalId,
        caseId,
        `Allocated ${quantity} ${resourceType}`,
        JSON.stringify({ resourceType, quantity })
      ]
    );

    await connection.commit();

    return {
      success: true,
      allocationId: allocationResult.insertId,
      caseId,
      resourceType,
      quantity,
      availableQuantity: newAvailable
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function releaseResource(allocationId) {
  if (!Number.isInteger(allocationId) || allocationId <= 0) {
    throw new Error("allocationId must be a positive integer");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT
         ra.allocation_id,
         ra.case_id,
         ra.resource_id,
         ra.quantity,
         ra.allocation_status,
         ri.hospital_id,
         ri.resource_type,
         ri.total_quantity,
         ri.available_quantity
       FROM resource_allocations ra
       JOIN resource_inventory ri
         ON ri.resource_id = ra.resource_id
       WHERE ra.allocation_id = ?
       FOR UPDATE`,
      [allocationId]
    );

    if (rows.length === 0) {
      throw new Error("Allocation not found");
    }

    const allocation = rows[0];

    if (allocation.allocation_status !== "Allocated") {
      throw new Error("Allocation has already been released");
    }

    const newAvailable =
      allocation.available_quantity + allocation.quantity;

    if (newAvailable > allocation.total_quantity) {
      throw new Error("Release would exceed total resource quantity");
    }

    await connection.execute(
      `UPDATE resource_inventory
       SET available_quantity = ?
       WHERE resource_id = ?`,
      [newAvailable, allocation.resource_id]
    );

    await connection.execute(
      `UPDATE resource_allocations
       SET allocation_status = 'Released',
           released_at = NOW()
       WHERE allocation_id = ?`,
      [allocationId]
    );

    await connection.execute(
      `INSERT INTO resource_history
       (resource_id, recorded_at, total_quantity,
        available_quantity, used_quantity, source)
       VALUES (?, NOW(), ?, ?, ?, 'RELEASE')`,
      [
        allocation.resource_id,
        allocation.total_quantity,
        newAvailable,
        allocation.total_quantity - newAvailable
      ]
    );

    await connection.execute(
      `INSERT INTO system_events
       (hospital_id, case_id, event_type, event_message, metadata)
       VALUES (?, ?, 'RESOURCE_RELEASED', ?, ?)`,
      [
        allocation.hospital_id,
        allocation.case_id,
        `Released ${allocation.quantity} ${allocation.resource_type}`,
        JSON.stringify({
          resourceType: allocation.resource_type,
          quantity: allocation.quantity
        })
      ]
    );

    await connection.commit();

    return {
      success: true,
      allocationId,
      availableQuantity: newAvailable
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getResources,
  allocateResource,
  releaseResource
};