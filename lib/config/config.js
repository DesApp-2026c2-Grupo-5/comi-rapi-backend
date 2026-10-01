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
  const argon2 = {
    // En producción y desarrollo se usan los parámetros estándar de Argon2id
    // (timeCost=3, 64 MiB). En tests se bajan a propósito: las suites crean
    // decenas de usuarios, y cada hash a costo default tarda ~150 ms contra
    // ~4 ms a costo mínimo. El algoritmo y el formato del hash son los mismos,
    // así que verify() no distingue; solo cambia el esfuerzo de cálculo.
    // Ajustables por variable de entorno sin tocar código.
    timeCost:
      parseInt(process.env.ARGON2_TIMECOST, 10) ||
      (environment === 'test' ? 2 : 3),
    memoryCost:
      parseInt(process.env.ARGON2_MEMORYCOST, 10) ||
      (environment === 'test' ? 1024 : 65536),
    parallelism:
      parseInt(process.env.ARGON2_PARALLELISM, 10) ||
      (environment === 'test' ? 1 : 4),
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
    frontend: {
      // URL pública del frontend: se usa para armar el enlace del email.
      url: process.env.FRONTEND_URL || 'http://localhost:5173',
    },
    argon2,
    perfil: {
      // Límite de cambios de contraseña por usuario: frena el intento de
      // adivinar la contraseña actual desde una sesión robada.
      rateLimitPassword: {
        max: parseInt(process.env.PERFIL_RATE_LIMIT_PASSWORD_MAX, 10) || 5,
        windowMinutes:
          parseInt(process.env.PERFIL_RATE_LIMIT_PASSWORD_WINDOW_MINUTES, 10) ||
          15,
      },
    },
    passwordReset: {
      // Vigencia del token de recuperación.
      expirationMinutes:
        parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES, 10) || 10,
      // Límite por IP para requesting una recuperación.
      rateLimitIp: {
        max: parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_IP_MAX, 10) || 3,
        windowMinutes:
          parseInt(
            process.env.PASSWORD_RESET_RATE_LIMIT_IP_WINDOW_MINUTES,
            10
          ) || 60,
      },
      // Límite por email normalizado.
      rateLimitEmail: {
        max: parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_EMAIL_MAX, 10) || 3,
        windowMinutes:
          parseInt(
            process.env.PASSWORD_RESET_RATE_LIMIT_EMAIL_WINDOW_MINUTES,
            10
          ) || 60,
      },
    },
    mail: {
      // 'smtp' para envío real, 'console' SOLO en desarrollo.
      transport: process.env.MAIL_TRANSPORT || '',
      host: process.env.SMTP_HOST || 'localhost',
      port: normalizePort(process.env.SMTP_PORT || '1025'),
      user: process.env.SMTP_USER || '',
      password: process.env.SMTP_PASSWORD || '',
      from: process.env.SMTP_FROM || 'no-reply@comiapi.local',
      // TLS implícito (SMTPS, típicamente 465). Mailpit y la mayoría de los
      // proveedores de desarrollo usan texto plano o STARTTLS, así que el
      // default es false y se activa por variable de entorno.
      secure: process.env.SMTP_SECURE === 'true',
      // Obliga a STARTTLS en las conexiones no seguras (587). Evita bajar a
      // texto plano si el servidor no lo anuncia.
      requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
      // Verificar el certificado del servidor. Solo se desactiva a propósito
      // contra un relay local de desarrollo.
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
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
      perfilesDir: path.resolve(
        process.cwd(),
        process.env.IMAGENES_PERFILES_DIR ||
          '../comi-rapi-fronted/public/imagenes/perfiles'
      ),
      perfilesUrlBase: '/imagenes/perfiles',
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
