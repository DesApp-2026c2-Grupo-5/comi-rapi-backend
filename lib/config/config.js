const path = require('path');
const debug = require('debug');
const parse = require('pg-connection-string').parse;
const dotenv = require('dotenv');

function getEnvironment() {
  return process.env.NODE_ENV || 'development';
}

function initializeEnv() {
  // Override local para secretos (ej. ORS_API_KEY): `.env.local` (gitignored) se
  // carga PRIMERO, así los valores de los `.env.*` versionados no pisan los
  // locales (dotenv no reemplaza variables ya definidas).
  dotenv.config({
    path: path.resolve(process.cwd(), '.env.local'),
  });
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
    // Georef Argentina (geocodificación de direcciones). API pública, sin secretos.
    georef: {
      baseUrl:
        process.env.GEOREF_BASE_URL || 'https://apis.datos.gob.ar/georef',
      timeoutMs: parseInt(process.env.GEOREF_TIMEOUT_MS, 10) || 5000,
      maxResultados: parseInt(process.env.GEOREF_MAX_RESULTADOS, 10) || 10,
    },
    // OpenRouteService (cálculo de rutas: distancia/duración). API externa con clave.
    ors: {
      baseUrl: process.env.ORS_BASE_URL || 'https://api.openrouteservice.org',
      apiKey: process.env.ORS_API_KEY || '',
      timeoutMs: parseInt(process.env.ORS_TIMEOUT_MS, 10) || 5000,
      profile: process.env.ORS_PROFILE || 'driving-car',
    },
    // Cobertura geográfica (reglas de negocio en cobertura_service). Radio máximo
    // de delivery en km; las zonas habilitadas se configuran en cobertura-zonas.js.
    cobertura: {
      radioMaxKm: parseFloat(process.env.COBERTURA_RADIO_MAX_KM) || 5,
    },
  };
}

initializeEnv();

module.exports = initializeConfig();
