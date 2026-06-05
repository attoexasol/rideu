const jwt = require('jsonwebtoken');

const token = jwt.sign(
  {
    sub: 'auth0|69e1504fee72d6a52b089017',
    email: 'info@coronadelivery.com',
    name: 'SUPER ADMIN',
    'https://drivewize.com/role': 'super_admin'
  },
  'test-secret',
  {
    expiresIn: '1h'
  }
);

console.log(token);