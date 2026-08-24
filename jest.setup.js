const db = require('./lib/models');

afterAll(() => db.sequelize.close());
