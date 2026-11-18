const express = require('express');
const { signup } = require('../controllers/auth.controller');

const router = express.Router();

// POST /auth/signup  → create a new account
router.post('/signup', signup);

module.exports = router;