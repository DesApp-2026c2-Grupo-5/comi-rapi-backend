'use strict';

// Helper de geocodificación para los seeders.
//
// Por qué existe: los seeders se ejecutan con Node puro (sequelize-cli) y no
// pasan por Babel; `lib/services/geolocation_service.js` está en sintaxis ESM
// (import/export) y no puede requerirse directamente desde acá. Sí puede
// requerirse el build transpilado (`dist/`), que es el mismo servicio que corre
// la app: se reutilizan exactamente su lógica, query y errores tipados (no se
// duplica Georef). El flujo documentado de seeds (`docs/reset-db.md`) corre
// `npm run db:init` (transpila + migra) antes de seedear, así `dist/` está
// actualizado. Si falta, el error indica cómo resolverlo.
//
// Regla: si Georef no encuentra la dirección, devuelve resultados ambiguos o
// falla por indisponibilidad, el error tipado se propaga y el seeder se detiene
// con un error claro. No se insertan datos incompletos ni coordenadas de
// respaldo manuales. Los seeders NO validan cobertura (no usan ORS).

const path = require('path');

function cargarGeocodificador() {
  const ruta = path.resolve(
    __dirname,
    '../../../dist/lib/services/geolocation_service'
  );
  try {
    return require(ruta);
  } catch (error) {
    throw new Error(
      'No se pudo cargar el servicio de geocodificación transpilado (dist). ' +
        'Ejecutar "npm run build" (o "npm run db:init") antes de correr los seeders. Causa: ' +
        (error && error.message)
    );
  }
}

/**
 * Geocodifica una dirección con el mismo servicio que usa la app
 * (`geolocation_service`, Georef Argentina).
 * @param {object} datos - { calle, altura, provincia, localidad }.
 * @returns {Promise<object>} { latitud, longitud, nomenclatura, normalizada }.
 * @throws {Error} Si no se pudo cargar el servicio transpilado.
 * @throws {DireccionNoEncontradaError|DireccionAmbiguaError|GeorefError}
 */
async function geocodificarDireccion(datos) {
  const { geocodificarDireccion: geocodificar } = cargarGeocodificador();
  return geocodificar(datos);
}

module.exports = { geocodificarDireccion };
