/**
 * Middleware de sesión server-side en PostgreSQL.
 * Usa express-session + connect-pg-simple (tabla `session`).
 * La cookie de sesión es HttpOnly y nunca se expone al frontend.
 */
import session from 'express-session';
import { Pool } from 'pg';
import connectPgSimple from 'connect-pg-simple';
import config from '../config/config';

const PgSessionStore = connectPgSimple(session);

const pool = new Pool({
  user: config.db.username,
  password: config.db.password,
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
});

const sessionMiddleware = session({
  store: new PgSessionStore({ pool, createTableIfMissing: true }),
  name: 'comirapi.sid',
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: config.session.sameSite,
    secure: config.session.secure,
    maxAge: config.session.ttl,
  },
});

/** Cierra el pool de conexiones de la tienda (útil para los tests). */
export const closeSessionPool = () => pool.end();

export default sessionMiddleware;
