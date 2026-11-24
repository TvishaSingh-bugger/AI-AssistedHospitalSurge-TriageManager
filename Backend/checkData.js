const pool = require("./db");

async function checkTables() {
    try {
        const [tables] = await pool.query("SHOW TABLES");

        console.log("\n--- DATABASE TABLES ---");
        console.table(tables);

        console.log("\n--- TABLE ROW COUNTS ---");

        for (const row of tables) {
            const tableName = Object.values(row)[0];

            try {
                const [result] = await pool.query(
                    `SELECT COUNT(*) AS total FROM \`${tableName}\``
                );

                console.log(`${tableName}: ${result[0].total}`);
            } catch (error) {
                console.log(`${tableName}: ${error.message}`);
            }
        }
    } catch (error) {
        console.error(error.message);
    } finally {
        await pool.end();
    }
}

checkTables();