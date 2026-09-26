'use strict';

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

// Las sucursales ya no almacenan `direccion`/`latitud`/`longitud`: cada una tiene
// un registro 1:1 en `Direcciones` (FK `sucursalId`), que concentra los datos de
// ubicación. Se preservan las coordenadas que antes estaban en `Sucursales`.
const sucursales = [
  {
    nombre: 'Sucursal Centro',
    telefono: '011-1234-5678',
    horarios: 'Lun-Dom 10:00-23:00',
    direccion: {
      calle: 'Av. Principal',
      altura: 123,
      provincia: 'Ciudad Autónoma de Buenos Aires',
      localidad: 'CABA',
      codigoPostal: '1000',
      latitud: -34.6037,
      longitud: -58.3816,
    },
  },
  {
    nombre: 'Sucursal Norte',
    telefono: '011-8765-4321',
    horarios: 'Lun-Vie 10:00-22:00',
    direccion: {
      calle: 'Calle Norte',
      altura: 456,
      provincia: 'Ciudad Autónoma de Buenos Aires',
      localidad: 'CABA',
      codigoPostal: '1425',
      latitud: -34.5926,
      longitud: -58.3912,
    },
  },
  {
    nombre: 'Sucursal Sur',
    telefono: '011-5678-1234',
    horarios: 'Lun-Sab 11:00-00:00',
    direccion: {
      calle: 'Av. Sur',
      altura: 789,
      provincia: 'Ciudad Autónoma de Buenos Aires',
      localidad: 'CABA',
      codigoPostal: '1064',
      latitud: -34.6123,
      longitud: -58.3718,
    },
  },
];

module.exports = {
  up: async (queryInterface) => {
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
        const dir = sucursales.find((x) => x.nombre === s.nombre).direccion;
        return {
          sucursalId: s.id,
          calle: dir.calle,
          altura: dir.altura,
          provincia: dir.provincia,
          localidad: dir.localidad,
          codigoPostal: dir.codigoPostal,
          latitud: dir.latitud,
          longitud: dir.longitud,
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
