const jwt = require("jsonwebtoken");

// Two audiences, two cookies, one signing secret. `role` is always present so
// a student token can never satisfy an admin route and vice versa — the
// original student middleware had that check commented out.

const COOKIE_NAMES = {
  user: "examai_admin",
  student: "examai_student",
};

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.COOKIE_SAMESITE || "strict",
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  maxAge: 30 * 24 * 60 * 60 * 1000,
});

const generateToken = (res, { id, sessionId, role, audience }) => {
  const token = jwt.sign(
    { id, sessionId, role, aud: audience },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  res.cookie(COOKIE_NAMES[audience], token, cookieOptions());
  return token;
};

// The mobile app (a Capacitor shell) runs on its own origin, so the API is a
// third-party site to its webview and iOS drops the session cookie. It asks
// for the token in the login response instead (header X-ExamAI-Client:
// native) and sends it back as "Authorization: Bearer". Students only: staff
// never sign in from the app.
const isNativeClient = (req) => req.get("x-examai-client") === "native";

const withSessionToken = (req, body, token) => (isNativeClient(req) ? { ...body, sessionToken: token } : body);

const readToken = (req, audience) => {
  const cookie = req.cookies?.[COOKIE_NAMES[audience]];
  if (cookie || audience !== "student") return cookie;
  const m = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") || "");
  return m ? m[1] : undefined;
};

const clearToken = (res, audience) => {
  res.cookie(COOKIE_NAMES[audience], "", {
    ...cookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
};

module.exports = { generateToken, clearToken, readToken, withSessionToken, COOKIE_NAMES };
