const express = require('express');
const { signup, login } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /auth/signup  → create a new account
router.post('/signup', signup);

// POST /auth/login   → check the password and hand back a JWT
router.post('/login', login);

// GET /auth/me       → "Who am I?" (needs a valid wristband)
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;