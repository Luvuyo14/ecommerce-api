// Load the secrets from .env FIRST, before anything else needs them
require('dotenv').config();

// Safety check: without a secret we cannot make safe wristbands,
// so we refuse to start instead of failing later in a confusing way.
if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in .env. Add it and start again.');
  process.exit(1);
}

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});