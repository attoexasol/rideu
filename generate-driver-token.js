const jwt = require('jsonwebtoken');

const token = jwt.sign(
    {
      sub: 'auth0|69c560b5b4f42ec99c0a1ae3',
      email: 'goliscab.349@drivers.drivewize.com',
      name: 'Ibrahim Golis',
      'https://drivewize.com/role': 'driver'
    },
    'test-secret',
    { expiresIn: '1h' }
  );

console.log(token);