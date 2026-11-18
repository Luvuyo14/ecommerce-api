const express = require('express');
const { signup, login } = require('../controllers/auth.controller');

const router = express.Router();

// POST /auth/signup  → create a new account
router.post('/signup', signup);

// POST /auth/login   → check the password and hand back a JWT
router.post('/login', login);

module.exports = router;