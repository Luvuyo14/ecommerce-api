const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// How many times bcrypt "scrambles" the password.
// More rounds = harder to crack, but slower. 10 is the standard choice.
const SALT_ROUNDS = 10;

// A simple check that an email looks like "something@something.something"
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A fake scrambled password. We use it at login when the email does not exist,
// so the server takes about the same time to answer either way.
// (Otherwise an attacker could measure the speed to find which emails exist.)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

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

async function login(req, res) {
  try {
    const { email, password } = req.body ?? {};

    // 1. Both must be text. If not, the request is badly made.
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res
        .status(400)
        .json({ message: 'Please send both email and password.' });
    }

    // 2. Look for the user (same tidy-up as signup)
    const cleanEmail = email.trim().toLowerCase();
    const result = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [cleanEmail]
    );
    const user = result.rows[0]; // undefined if nobody has this email

    // 3. Compare the typed password with the saved scramble.
    //    If there is no user, we still compare against the dummy hash (see above).
    const passwordIsCorrect = await bcrypt.compare(
      password,
      user ? user.password_hash : DUMMY_HASH
    );

    // 4. One vague message for BOTH "no such email" and "wrong password".
    //    This way attackers cannot find out which emails have accounts.
    if (!user || !passwordIsCorrect) {
      return res
        .status(401)
        .json({ message: 'Invalid email or password.' });
    }

    // 5. Make the wristband (JWT).
    //    sub = "subject" = who the token is about (must be text).
    const token = jwt.sign(
      { sub: String(user.id), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    // 6. Send the wristband back with a few safe details. Never the hash.
    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Login error:', error.message);
    return res
      .status(500)
      .json({ message: 'Something went wrong. Please try again later.' });
  }
}

module.exports = { signup, login };