const pool = require("./db");

async function deleteAdmin() {
    try {
        const [result] = await pool.query(
            "DELETE FROM app_users WHERE user_id = ? AND role = ? AND email = ?",
            [1, "admin", "admin@mednexus.com"]
        );

        console.log("Deleted admin records:", result.affectedRows);
    } catch (error) {
        console.error("Error:", error.message);
    } finally {
        await pool.end();
    }
}

deleteAdmin();