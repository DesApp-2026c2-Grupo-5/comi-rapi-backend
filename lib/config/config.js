const path = require('path');
const debug = require('debug');
const parse = require('pg-connection-string').parse;
const dotenv = require('dotenv');

function getEnvironment() {
  return process.env.NODE_ENV || 'development';
}

function initializeEnv() {
  dotenv.config({
    path: path.resolve(process.cwd(), `.env.${getEnvironment()}`),
  });
}

function parseHerokuUrlIfPresent() {
  const url = process.env.DATABASE_URL;

  if (url === undefined) {
    return {};
  }

  const config = parse(url);

  // Heroku necesita sí o sí SSL, y para eso hay que habilitar el driver nativo.
  return {
    ...config,
    username: config.user,
    native: true,
  };
}

function normalizePort(val) {
  const portNum = parseInt(val, 10);

  if (Number.isNaN(portNum)) {
    // named pipe
    return val;
  }

  if (portNum >= 0) {
    // port number
    return portNum;
  }

  return false;
}

function initializeConfig() {
  const environment = getEnvironment();
  let dbConfig = {
    username: process.env.SQL_USERNAME,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DATABASE,
    host: process.env.SQL_HOST || 'localhost',
    port: process.env.SQL_PORT || '5432',
    dialect: 'postgresql',
    logging: debug('sequelize'),
  };
  if (environment === 'development') {
    dbConfig.seederStorage = 'sequelize';
  } else if (environment === 'test') {
    dbConfig.database =
      process.env.SQL_TEST_DATABASE || process.env.SQL_DATABASE;
  } else if (environment === 'production') {
    dbConfig = { ...dbConfig, ...parseHerokuUrlIfPresent() };
  }
  const session = {
    secret:
      process.env.SESSION_SECRET ||
      'comi-rapi-dev-secret-no-usar-en-produccion',
    ttl: (parseInt(process.env.SESSION_TTL_MIN, 10) || 480) * 60 * 1000,
    secure:
      (
        process.env.COOKIE_SECURE ||
        (environment === 'production' ? 'true' : 'false')
      ).toLowerCase() === 'true',
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
  };
  return {
    db: dbConfig,
    port: normalizePort(process.env.PORT || '3000'),
    session,
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    },
    rateLimit: {
      enabled:
        (process.env.RATE_LIMIT_ENABLED || 'true').toLowerCase() !== 'false',
    },
    imagenes: {
      dir: path.resolve(
        process.cwd(),
        process.env.IMAGENES_DIR ||
          '../comi-rapi-fronted/public/imagenes/productos'
      ),
      urlBase: '/imagenes/productos',
      categoriasDir: path.resolve(
        process.cwd(),
        process.env.IMAGENES_CATEGORIAS_DIR ||
          '../comi-rapi-fronted/public/imagenes/categorias'
      ),
      categoriasUrlBase: '/imagenes/categorias',
    },
  };
}

initializeEnv();

module.exports = initializeConfig();
