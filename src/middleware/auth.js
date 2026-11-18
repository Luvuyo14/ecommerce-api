const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// The bouncer: checks the wristband (JWT) on every protected request.
async function authenticate(req, res, next) {
  try {
    // 1. Find the wristband. It must arrive as:  Authorization: Bearer <token>
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Please log in first.' });
    }

    // 2. Check the stamp and the expiry date.
    //    "algorithms" says: only accept the stamp type WE use (HS256),
    //    so nobody can sneak in a token with a different or missing stamp.
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
      });
    } catch (error) {
      const message =
        error.name === 'TokenExpiredError'
          ? 'Your session has expired. Please log in again.'
          : 'Invalid token.';
      return res.status(401).json({ message });
    }

    // 3. The wristband says who it belongs to (sub = user id)
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) {
      return res.status(401).json({ message: 'Invalid token.' });
    }

    // 4. Look the person up in the guest book.
    //    This way a deleted user, or a changed role, counts straight away
    //    instead of waiting for the old wristband to expire.
    const result = await pool.query(
      'SELECT id, email, role FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];

    if (!user) {
      return res
        .status(401)
        .json({ message: 'This account no longer exists.' });
    }

    // 5. Attach the person to the request, so later code knows who is asking.
    req.user = user;
    next(); // "You may pass."
  } catch (error) {
    console.error('Auth error:', error.message);
    return res
      .status(500)
      .json({ message: 'Something went wrong. Please try again later.' });
  }
}

// The VIP bouncer: must run AFTER authenticate.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admins only.' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };