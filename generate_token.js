const jwt = require('jsonwebtoken');

const JWT_SECRET = 'healthexperts-secret-change-in-production';

// Generate token for Yahoska (admin)
const token = jwt.sign(
  { id: 1, email: 'yperez@healthexps.com', role: 'admin' },
  JWT_SECRET,
  { expiresIn: '24h' }
);

console.log('Bearer ' + token);
