
const express = require("express");
const router = express.Router();
console.log("Resource routes loaded");
const pool = require("../db");

// GET all hospital resources
router.get("/", async (req, res) => {
    try {
        const [resources] = await pool.query(`
            SELECT
                r.resource_id,
                r.hospital_id,
                h.hospital_name,
                r.resource_type,
                r.blood_group,
                r.total_quantity,
                r.available_quantity,
                r.unit
            FROM resource_inventory r
            JOIN hospitals h
                ON r.hospital_id = h.hospital_id
            ORDER BY r.hospital_id, r.resource_type
        `);

        res.json({
            success: true,
            count: resources.length,
            data: resources
        });
    } catch (error) {
        console.error("Error fetching resources:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch resources"
        });
    }
});


 // PUT: Update available quantity for a resource
router.put("/:resource_id/availability", async (req, res) => {
    try {
        const resourceId = Number(req.params.resource_id);
        const { available_quantity } = req.body;

        // Validate resource ID
        if (!Number.isSafeInteger(resourceId) || resourceId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid resource ID"
            });
        }

        // Validate available quantity
        if (
            available_quantity === undefined ||
            !Number.isSafeInteger(available_quantity) ||
            available_quantity < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Available quantity must be a non-negative integer"
            });
        }

        // Check whether resource exists and get its total quantity
        const [resources] = await pool.query(
            `SELECT resource_id, total_quantity, available_quantity
             FROM resource_inventory
             WHERE resource_id = ?`,
            [resourceId]
        );

        if (resources.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Resource not found"
            });
        }

        const resource = resources[0];

        // Available quantity cannot exceed total quantity
        if (available_quantity > resource.total_quantity) {
            return res.status(400).json({
                success: false,
                message: "Available quantity cannot exceed total quantity",
                total_quantity: resource.total_quantity
            });
        }

        // Update inventory
        await pool.query(
            `UPDATE resource_inventory
             SET available_quantity = ?
             WHERE resource_id = ?`,
            [available_quantity, resourceId]
        );

        // Return updated record
        const [updatedResources] = await pool.query(
            `SELECT resource_id, hospital_id, resource_type,
                    total_quantity, available_quantity, unit
             FROM resource_inventory
             WHERE resource_id = ?`,
            [resourceId]
        );

        return res.json({
            success: true,
            message: "Resource availability updated successfully",
            data: updatedResources[0]
        });

    } catch (error) {
        console.error("Resource update error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to update resource availability"
        });
    }
});


const allocationHandler = async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const caseId = Number(req.body.case_id);
        const resourceId = Number(req.body.resource_id);
        const quantity = Number(req.body.quantity);

        if (
            !Number.isSafeInteger(caseId) || caseId <= 0 ||
            !Number.isSafeInteger(resourceId) || resourceId <= 0 ||
            !Number.isSafeInteger(quantity) || quantity <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid case_id, resource_id and positive quantity are required"
            });
        }

        await connection.beginTransaction();

        // Lock the resource row to prevent concurrent over-allocation
        const [resources] = await connection.query(
            `SELECT resource_id, hospital_id, total_quantity,
                    available_quantity, resource_type
             FROM resource_inventory
             WHERE resource_id = ?
             FOR UPDATE`,
            [resourceId]
        );

        if (resources.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Resource not found"
            });
        }

        const resource = resources[0];

        // Confirm the emergency case exists at the same hospital
        const [cases] = await connection.query(
            `SELECT case_id, hospital_id, process_state
             FROM emergency_cases
             WHERE case_id = ?`,
            [caseId]
        );

        if (
            cases.length === 0 ||
            cases[0].hospital_id !== resource.hospital_id
        ) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Emergency case not found at this resource's hospital"
            });
        }

        if (["Completed", "Cancelled"].includes(cases[0].process_state)) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: "Cannot allocate resources to a completed or cancelled case"
            });
        }

        if (quantity > resource.available_quantity) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: "Insufficient available resources",
                available_quantity: resource.available_quantity
            });
        }

        // Reserve inventory
        await connection.query(
            `UPDATE resource_inventory
             SET available_quantity = available_quantity - ?
             WHERE resource_id = ?`,
            [quantity, resourceId]
        );

        // Record allocation
        const [allocation] = await connection.query(
            `INSERT INTO resource_allocations
                (case_id, resource_id, quantity, allocation_status)
             VALUES (?, ?, ?, 'Allocated')`,
            [caseId, resourceId, quantity]
        );

        // Record updated inventory history
        await connection.query(
            `INSERT INTO resource_history
                (resource_id, recorded_at, total_quantity,
                 available_quantity, used_quantity, source)
             VALUES (?, NOW(), ?, ?, ?, 'ALLOCATION')`,
            [
                resourceId,
                resource.total_quantity,
                resource.available_quantity - quantity,
                resource.total_quantity -
                    (resource.available_quantity - quantity)
            ]
        );

        await connection.commit();

        return res.status(201).json({
            success: true,
            message: "Resource allocated successfully",
            data: {
                allocation_id: allocation.insertId,
                case_id: caseId,
                resource_id: resourceId,
                resource_type: resource.resource_type,
                quantity,
                available_quantity:
                    resource.available_quantity - quantity,
                allocation_status: "Allocated"
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Resource allocation error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to allocate resource"
        });
    } finally {
        connection.release();
    }
};

router.post("/allocate", allocationHandler);



router.put("/allocations/:allocation_id/release", async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
        const allocationId = Number(req.params.allocation_id);

        if (!Number.isSafeInteger(allocationId) || allocationId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid allocation ID"
            });
        }

        await connection.beginTransaction();
        transactionStarted = true;

        // Lock the allocation so it cannot be released twice
        const [allocations] = await connection.query(
            `SELECT allocation_id, case_id, resource_id, quantity,
                    allocation_status
             FROM resource_allocations
             WHERE allocation_id = ?
             FOR UPDATE`,
            [allocationId]
        );

        if (allocations.length === 0) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(404).json({
                success: false,
                message: "Allocation not found"
            });
        }

        const allocation = allocations[0];

        if (allocation.allocation_status !== "Allocated") {
            await connection.rollback();
            transactionStarted = false;

            return res.status(409).json({
                success: false,
                message: "This allocation has already been released or cancelled"
            });
        }

        // Lock the associated inventory row
        const [resources] = await connection.query(
            `SELECT resource_id, total_quantity, available_quantity
             FROM resource_inventory
             WHERE resource_id = ?
             FOR UPDATE`,
            [allocation.resource_id]
        );

        if (resources.length === 0) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(404).json({
                success: false,
                message: "Associated resource not found"
            });
        }

        const resource = resources[0];
        const restoredQuantity =
            resource.available_quantity + allocation.quantity;

        if (restoredQuantity > resource.total_quantity) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(409).json({
                success: false,
                message: "Release would exceed total resource quantity"
            });
        }

        // Restore available inventory
        await connection.query(
            `UPDATE resource_inventory
             SET available_quantity = ?
             WHERE resource_id = ?`,
            [restoredQuantity, allocation.resource_id]
        );

        // Mark allocation as released
        await connection.query(
            `UPDATE resource_allocations
             SET allocation_status = 'Released',
                 released_at = NOW()
             WHERE allocation_id = ?`,
            [allocationId]
        );

        // Record the release in resource history
        await connection.query(
            `INSERT INTO resource_history
                (resource_id, recorded_at, total_quantity,
                 available_quantity, used_quantity, source)
             VALUES (?, NOW(), ?, ?, ?, 'RELEASE')`,
            [
                allocation.resource_id,
                resource.total_quantity,
                restoredQuantity,
                resource.total_quantity - restoredQuantity
            ]
        );

        await connection.commit();
        transactionStarted = false;

        return res.json({
            success: true,
            message: "Resource released successfully",
            data: {
                allocation_id: allocationId,
                case_id: allocation.case_id,
                resource_id: allocation.resource_id,
                quantity_released: allocation.quantity,
                available_quantity: restoredQuantity,
                allocation_status: "Released"
            }
        });

    } catch (error) {
        if (transactionStarted) {
            await connection.rollback();
        }

        console.error("Resource release error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to release resource"
        });
    } finally {
        connection.release();
    }
});



module.exports = router;
