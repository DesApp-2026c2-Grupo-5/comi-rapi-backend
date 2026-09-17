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

const sucursales = [
  {
    nombre: 'Sucursal Centro',
    direccion: 'Av. Principal 123',
    latitud: -34.6037,
    longitud: -58.3816,
    telefono: '011-1234-5678',
    horarios: 'Lun-Dom 10:00-23:00',
  },
  {
    nombre: 'Sucursal Norte',
    direccion: 'Calle Norte 456',
    latitud: -34.5926,
    longitud: -58.3912,
    telefono: '011-8765-4321',
    horarios: 'Lun-Vie 10:00-22:00',
  },
  {
    nombre: 'Sucursal Sur',
    direccion: 'Av. Sur 789',
    latitud: -34.6123,
    longitud: -58.3718,
    telefono: '011-5678-1234',
    horarios: 'Lun-Sab 11:00-00:00',
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
        ...s,
        activa: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('Sucursales', null, {});
    await queryInterface.bulkDelete('EstadoPedidos', null, {});
  },
};
