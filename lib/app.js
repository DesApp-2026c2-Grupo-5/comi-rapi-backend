/* eslint-disable no-console */
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import logger from 'morgan';
import routes from './routes';
import errorHandler from './middlewares/error_handler';
import sessionMiddleware from './middlewares/session';
import { csrfProtection } from './middlewares/csrf';
import config from './config/config';

const app = express();

// ETag débil para permitir 304 en GET (Express lo usa al comparar `If-None-Match`).
app.set('etag', 'weak');

/**
 * Get port from environment and store in Express.
 */

app.set('port', config.port || '3001');

// Cookies de sesión solo via HTTPS cuando se configura proxy (Heroku, etc.)
if (config.session.secure) {
  app.set('trust proxy', 1);
}

// Imágenes del catálogo y de perfiles: se sirven desde el propio backend en
// /api/imagenes/<carpeta>/<archivo>. Va antes del logger para no llenar la
// consola con un GET por cada imagen y antes de helmet para que el navegador
// pueda pedirlas desde otro origen (Vite en desarrollo). El ETag y el
// Cache-Control de express.static permiten que el navegador reutilice el
// archivo sin volver a descargarlo.
app.use(
  '/api/imagenes',
  express.static(config.imagenes.publicDir, {
    maxAge: '7d',
    fallthrough: true,
    dotfiles: 'ignore',
  })
);

app.use(logger('dev'));
app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Sesión server-side (cookie HttpOnly) + protección CSRF global.
app.use(sessionMiddleware);
app.use(csrfProtection);

// Catálogo público: se permite guardar la respuesta, pero SIEMPRE se revalida
// con el ETag. `private` evita que un proxy compartido sirva respuestas de una
// sesión (p. ej. promociones inactivas para un admin) a otro usuario, y
// `no-cache` evita que una edición reciente quede oculta por el `max-age` del
// navegador (el frontend ya cachea en memoria e invalida por mutación/evento).
const PREFIJOS_CACHEABLES = [
  '/api/public/bootstrap',
  '/api/productos',
  '/api/categorias',
  '/api/promociones',
  '/api/sucursales',
  '/api/parametros',
  '/api/personalizacion',
];
app.use((req, res, next) => {
  if (
    req.method === 'GET' &&
    PREFIJOS_CACHEABLES.some(
      (prefijo) => req.path === prefijo || req.path.startsWith(`${prefijo}/`)
    )
  ) {
    res.set('Cache-Control', 'private, no-cache');
  }
  next();
});

app.use('/', routes);
app.use(errorHandler);

module.exports = app;
