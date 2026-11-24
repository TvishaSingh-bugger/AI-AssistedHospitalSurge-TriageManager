require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const pool = require("../db");
const { hashPassword } = require("../auth");

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Usage: node scripts/resetAdminPassword.js admin@example.com");
  }

  const [accounts] = await pool.query(
    "SELECT user_id FROM app_users WHERE email = ? AND role = 'admin'",
    [email]
  );
  if (!accounts.length) {
    throw new Error(`No administrator account found for ${email}`);
  }

  const prompt = readline.createInterface({ input: stdin, output: stdout });
  try {
    const password = await prompt.question("Enter a new admin password (at least 12 characters): ");
    const confirmation = await prompt.question("Confirm the new password: ");
    if (password.length < 12) {
      throw new Error("Password must be at least 12 characters.");
    }
    if (password !== confirmation) {
      throw new Error("The passwords do not match.");
    }

    await pool.query(
      "UPDATE app_users SET password_hash = ? WHERE user_id = ? AND role = 'admin'",
      [hashPassword(password), accounts[0].user_id]
    );
    console.log(`Password updated for ${email}. You can now sign in as Administrator.`);
  } finally {
    prompt.close();
  }
}

main()
  .catch((error) => {
    console.error(`Admin password reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
