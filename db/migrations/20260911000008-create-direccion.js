'use strict';

// Migración placeholder histórica (no-op). En su momento se reservó el timestamp
// para "create-direccion" pero quedó como no-op y ya está registrada como aplicada.
// La tabla `Direcciones` se crea en 20260917000001-create-direccion.js.
module.exports = {
  up: async () => {},
  down: async () => {},
};
