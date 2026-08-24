import config from './config';

module.exports = {
  development: config.db,
  test: config.db,
  production: config.db,
};
