'use strict';

/*
 * Se ejecuta (jest.config.js -> setupFiles) ANTES de que los tests carguen la
 * configuración de la app (lib/config/config.js). Fija NODE_ENV=test para que
 * las suites usen siempre SQL_TEST_DATABASE y nunca la base de desarrollo,
 * aunque Jest se invoque sin NODE_ENV (por ejemplo, desde el runner del editor).
 */
process.env.NODE_ENV = 'test';
