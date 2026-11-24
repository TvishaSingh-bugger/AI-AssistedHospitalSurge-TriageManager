const pool = require("./db");

async function checkAdmin() {
    try {
        const [rows] = await pool.query(
            "SELECT user_id, full_name, email, role FROM app_users WHERE role = 'admin'"
        );

        console.table(rows);
    } catch (error) {
        console.error(error.message);
    } finally {
        await pool.end();
    }
}

checkAdmin();