
const crypto = require("crypto");

const SECRET = process.env.AUTH_SECRET;
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

if (!SECRET || SECRET.length < 32) {
  console.warn(
    "WARNING: AUTH_SECRET is missing or too short. Set a strong secret in backend/.env."
  );
}

const ACTIVE_SECRET = SECRET || "development-only-secret-do-not-use-in-production";

function hashPassword(password) {
  if (typeof password !== "string" || password.length < 1) {
    throw new Error("Password must be a non-empty string");
  }

  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);

  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifyPassword(password, stored) {
  try {
    if (typeof password !== "string" || !stored) return false;

    const parts = String(stored).split("$");

    if (parts.length !== 3 || parts[0] !== "scrypt") {
      return false;
    }

    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");

    if (!salt.length || !expected.length) return false;

    const actual = crypto.scryptSync(password, salt, expected.length);

    if (actual.length !== expected.length) return false;

    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sign(body) {
  return crypto
    .createHmac("sha256", ACTIVE_SECRET)
    .update(body)
    .digest("base64url");
}

function signToken(user) {
  const payload = {
    uid: user.user_id,
    role: user.role,
    hid: user.hospital_id ?? null,
    sid: user.staff_id ?? null,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(body);

  return `${body}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== "string") return null;

    const parts = token.split(".");

    if (parts.length !== 2) return null;

    const [body, signature] = parts;

    if (!body || !signature) return null;

    const expectedSignature = Buffer.from(sign(body));
    const actualSignature = Buffer.from(signature);

    if (
      expectedSignature.length !== actualSignature.length ||
      !crypto.timingSafeEqual(expectedSignature, actualSignature)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    );

    if (
      !payload.uid ||
      !payload.role ||
      !payload.exp ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// requireAuth() allows any authenticated account.
// requireAuth(["admin"]) restricts access to the Admin role.
function requireAuth(roles = []) {
  return (req, res, next) => {
    try {
      const header = req.headers.authorization || "";

      if (!header.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message: "Authentication token is required"
        });
      }

      const token = header.slice(7);
      const payload = verifyToken(token);

      if (!payload) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token"
        });
      }

      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to access this resource"
        });
      }

      req.user = payload;
      return next();

    } catch (error) {
      console.error("Authentication middleware error:", error.message);

      return res.status(401).json({
        success: false,
        message: "Authentication failed"
      });
    }
  };
}

// Admin can act across hospitals.
// Other authenticated roles are restricted to their assigned hospital.
function canActOnHospital(user, hospitalId) {
  if (!user || !hospitalId) return false;

  return (
    user.role === "admin" ||
    Number(user.hid) === Number(hospitalId)
  );
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  canActOnHospital
};
