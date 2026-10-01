'use strict';

const { geocodificarDireccion } = require('./utils/utils-georef');

const estados = [
  { nombre: 'pendiente', orden: 1, esInicial: true, esFinal: false },
  { nombre: 'confirmado', orden: 2, esInicial: false, esFinal: false },
  { nombre: 'en_preparacion', orden: 3, esInicial: false, esFinal: false },
  {
    nombre: 'listo_para_entregar',
    orden: 4,
    esInicial: false,
    esFinal: false,
  },
  { nombre: 'en_camino', orden: 5, esInicial: false, esFinal: false },
  { nombre: 'entregado', orden: 6, esInicial: false, esFinal: true },
  { nombre: 'cancelado', orden: 7, esInicial: false, esFinal: true },
];

// Sucursales reales. Las coordenadas NO se cargan a mano: se geocodifican en
// `up` con el MISMO servicio que usa la app (geolocation_service, Georef
// Argentina, vía el build transpilado — ver ./utils/utils-georef.js).
//
// Nota (Sucursal Oeste): la dirección oficial de Plaza Oeste es "Av. Brig.
// Gral. Juan Manuel de Rosas 658, Morón". Dos particularidades de Georef:
//   1. En el segmento de Morón de esa calle solo hay numeración para alturas
//      bajas (400/500/600); la altura 658 (e incluso 650/660/700) no existe en
//      la numeración de Georef (la única "J M DE ROSAS 658" que encuentra está
//      en Chivilcoy, una ciudad distinta).
//   2. El endpoint `direcciones` de Georef no matchea esta calle con el
//      prefijo "Av." (0 resultados con cualquier variante "Av. ..."); sin el
//      prefijo sí ("J. M. de Rosas 600" → 1 resultado).
// Por eso se usa la calle sin el prefijo "Av." y la altura 600 de la misma
// cuadra, frente al shopping, verificada: -34.6356, -58.6282 (Morón).
const sucursales = [
  {
    nombre: 'Sucursal Oeste',
    telefono: '011-4627-0000',
    horarios: 'Lun-Dom 10:00-23:00',
    direccion: {
      calle: 'J. M. de Rosas',
      altura: 600,
      provincia: 'Buenos Aires',
      // Iteración 1-geo: partido obligatorio en Buenos Aires (desambigua la
      // dirección en Georef; misma regla que el ABM).
      departamento: 'Morón',
      localidad: 'Morón',
      codigoPostal: '1708',
    },
  },
  {
    nombre: 'Sucursal Palermo',
    telefono: '011-5777-3000',
    horarios: 'Lun-Dom 11:00-00:00',
    direccion: {
      calle: 'Av. Santa Fe',
      altura: 3253,
      provincia: 'Ciudad Autónoma de Buenos Aires',
      localidad: 'Palermo',
      codigoPostal: '1425',
    },
  },
];

module.exports = {
  up: async (queryInterface) => {
    // Geocodificación (Georef) ANTES de persistir: si una dirección no se
    // encuentra, es ambigua o Georef falla, el seeder se detiene con el error
    // tipado y no se inserta nada (sin coordenadas de respaldo manuales).
    const geocodificadas = [];
    for (const sucursal of sucursales) {
      const geo = await geocodificarDireccion(sucursal.direccion);
      geocodificadas.push({ sucursal, geo });
    }

    await queryInterface.bulkInsert(
      'EstadoPedidos',
      estados.map((e) => ({
        ...e,
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
    await queryInterface.bulkInsert(
      'Sucursales',
      sucursales.map((s) => ({
        nombre: s.nombre,
        telefono: s.telefono,
        horarios: s.horarios,
        activa: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
    const [creadas] = await queryInterface.sequelize.query(
      `SELECT id, nombre FROM "Sucursales" WHERE nombre IN (:nombres)`,
      {
        replacements: { nombres: sucursales.map((s) => s.nombre) },
      }
    );
    await queryInterface.bulkInsert(
      'Direcciones',
      creadas.map((s) => {
        const { sucursal, geo } = geocodificadas.find(
          (x) => x.sucursal.nombre === s.nombre
        );
        const dir = sucursal.direccion;
        return {
          sucursalId: s.id,
          calle: dir.calle,
          altura: dir.altura,
          provincia: dir.provincia,
          // Iteración 1-geo: datos territoriales persistidos NORMALIZADOS
          // por Georef (partido/comuna, localidad censal, nomenclatura),
          // igual que hace el ABM (direccion_service).
          departamento: geo.normalizada.departamento,
          localidad: geo.normalizada.localidad,
          nomenclatura: geo.nomenclatura,
          codigoPostal: dir.codigoPostal,
          latitud: geo.latitud,
          longitud: geo.longitud,
          activa: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      })
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `DELETE FROM "Direcciones" WHERE "sucursalId" IN (SELECT id FROM "Sucursales")`
    );
    await queryInterface.bulkDelete('Sucursales', null, {});
    await queryInterface.bulkDelete('EstadoPedidos', null, {});
  },
};
