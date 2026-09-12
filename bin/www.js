#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Module dependencies.
 */

import debugPkg from 'debug';
import http from 'http';
import app from '../lib/app';
import db from '../lib/models';

const debug = debugPkg('js/www:server');

/**
 * Create HTTP server.
 */

const server = http.createServer(app);

/**
 * Listen on the port set on the app, on all network interfaces.
 */
const port = app.get('port');
if (!port) {
  throw '¡¡Hay que setear el port de la aplicación Express!!';
}

// Run sequelize before listen, but don't crash if the DB is unavailable:
// the server must boot anyway so the API responds (e.g. /api/health).
function startServer() {
  app.listen(port, () => {
    console.log(`¡Aplicación iniciada! ====> 🌎 http://localhost:${port}`);
  });
}

db.sequelize
  .authenticate()
  .then(() => {
    console.log('Conexión a la base de datos establecida.');
    startServer();
  })
  .catch((error) => {
    console.warn(
      `No se pudo conectar a la base de datos (${error.message}). ` +
        'El servidor arranca igual, pero las rutas que usan datos van a fallar.'
    );
    startServer();
  });

server.on('error', onError);
server.on('listening', onListening);

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  const addr = server.address();
  const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr.port}`;
  debug(`Listening on ${bind}`);
}
