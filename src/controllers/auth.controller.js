const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// How many times bcrypt "scrambles" the password.
// More rounds = harder to crack, but slower. 10 is the standard choice.
const SALT_ROUNDS = 10;

// A simple check that an email looks like "something@something.something"
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function signup(req, res) {
  try {
    // Take the email and password out of the request.
    // "?? {}" means: if nothing was sent, use an empty box instead of crashing.
    const { email, password } = req.body ?? {};

    // 1. Check the email
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
      return res
        .status(400)
        .json({ message: 'Please send a valid email address.' });
    }

    // 2. Check the password (bcrypt only reads the first 72 characters,
    //    so we set a maximum to avoid surprises)
    if (typeof password !== 'string' || password.length < 8) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 8 characters long.' });
    }
    if (password.length > 72) {
      return res
        .status(400)
        .json({ message: 'Password must be 72 characters or fewer.' });
    }

    // 3. Tidy the email: remove spaces and use lowercase,
    //    so "Sam@Mail.com" and "sam@mail.com" are the same person.
    const cleanEmail = email.trim().toLowerCase();

    // 4. Scramble the password. We never save the real one.
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // 5. Save the user. $1 and $2 are safe "blanks" that PostgreSQL fills in.
    //    We do NOT set the role: everyone who signs up is a "customer".
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, role, created_at`,
      [cleanEmail, passwordHash]
    );

    // 6. Reply with 201 Created. We never send the password hash back.
    return res.status(201).json({
      message: 'Account created successfully.',
      user: result.rows[0],
    });
  } catch (error) {
    // 23505 is PostgreSQL's code for "this value must be unique, but it already exists"
    if (error.code === '23505') {
      return res
        .status(409)
        .json({ message: 'An account with this email already exists.' });
    }

    console.error('Signup error:', error.message);
    return res
      .status(500)
      .json({ message: 'Something went wrong. Please try again later.' });
  }
}

module.exports = { signup };