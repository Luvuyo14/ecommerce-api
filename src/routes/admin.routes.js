const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Every route in this file needs a valid wristband AND the admin role.
// Order matters: first check who they are, then check they are an admin.
router.use(authenticate, requireAdmin);

// GET /admin/ping  → a test door for admins only
router.get('/ping', (req, res) => {
  res.json({ message: `Welcome, admin ${req.user.email}!` });
});

module.exports = router;