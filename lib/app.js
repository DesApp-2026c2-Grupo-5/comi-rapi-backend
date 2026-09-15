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

/**
 * Get port from environment and store in Express.
 */

app.set('port', config.port || '3001');

// Cookies de sesión solo via HTTPS cuando se configura proxy (Heroku, etc.)
if (config.session.secure) {
  app.set('trust proxy', 1);
}

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

app.use('/', routes);
app.use(errorHandler);

module.exports = app;
