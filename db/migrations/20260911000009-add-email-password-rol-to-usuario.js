'use strict';

// Intencionalmente vacía: la realineación real de Usuario se implementa en la
// migration 20260913000011-realign-usuario-to-der.js. Esta migration se mantiene
// como no-op para preservar el historial y evitar que db:migrate falle.
module.exports = {
  up: async () => {},
  down: async () => {},
};
