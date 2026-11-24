const crypto = require("crypto");

const SECRET = process.env.AUTH_SECRET || "mednexus-dev-secret-change-me";
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

if (!process.env.AUTH_SECRET) {
  console.warn("AUTH_SECRET is not set in .env - using an insecure development secret.");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sign = body => crypto.createHmac("sha256", SECRET).update(body).digest("base64url");

// Stateless signed token: base64url(payload).signature
function signToken(user) {
  const payload = {
    uid: user.user_id,
    role: user.role,
    hid: user.hospital_id ?? null,
    sid: user.staff_id ?? null,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

// Express middleware. requireAuth() = any logged-in user; requireAuth(["admin"]) = role-restricted.
function requireAuth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const payload = verifyToken(header.startsWith("Bearer ") ? header.slice(7) : "");
    if (!payload) {
      return res.status(401).json({ success: false, message: "Please log in" });
    }
    if (roles.length && !roles.includes(payload.role)) {
      return res.status(403).json({ success: false, message: "You do not have permission to do this" });
    }
    req.user = payload;
    return next();
  };
}

// Staff and doctors may only act on their own hospital; admins on any.
function canActOnHospital(user, hospitalId) {
  return user.role === "admin" || Number(user.hid) === Number(hospitalId);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, requireAuth, canActOnHospital };
