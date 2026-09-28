'use strict';

// Seeder demo de promociones (87 BE-3).
// Semántica de `valor` (ver docs/promociones.md):
// - DESCUENTO_PORCENTUAL: porcentaje 0-100 aplicado al precio.
// - DOS_POR_UNO: 2x1 literal (llevás 2 del mismo producto, pagás 1);
//   `valor` se guarda 50.00 por convención y el motor futuro lo ignora.

const promociones = [
  {
    nombre: 'Promo 10% Hamburguesas',
    descripcion: '10% de descuento en hamburguesas seleccionadas.',
    tipo: 'DESCUENTO_PORCENTUAL',
    valor: 10,
    productos: ['Hamburguesa Clásica', 'Hamburguesa Doble'],
  },
  {
    nombre: 'Promo 2x1 Papas',
    descripcion: 'Llevás 2 y pagás 1 en papas seleccionadas.',
    tipo: 'DOS_POR_UNO',
    valor: 50,
    productos: ['Papas Fritas Grandes', 'Papas Cheddar'],
  },
];

module.exports = {
  up: async (queryInterface) => {
    const ahora = new Date();
    const en30Dias = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);

    await queryInterface.bulkInsert(
      'Promociones',
      promociones.map((promocion) => ({
        nombre: promocion.nombre,
        descripcion: promocion.descripcion,
        tipo: promocion.tipo,
        valor: promocion.valor,
        fechaInicio: ahora,
        fechaFin: en30Dias,
        activa: true,
        createdAt: ahora,
        updatedAt: ahora,
      }))
    );

    const [filasPromos] = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Promociones" WHERE nombre IN (:nombres);',
      {
        replacements: {
          nombres: promociones.map((promocion) => promocion.nombre),
        },
      }
    );
    const promoIdPorNombre = Object.fromEntries(
      filasPromos.map((fila) => [fila.nombre, fila.id])
    );

    const [filasProductos] = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Productos" WHERE nombre IN (:nombres);',
      {
        replacements: {
          nombres: [...new Set(promociones.flatMap((p) => p.productos))],
        },
      }
    );
    const productoIdPorNombre = Object.fromEntries(
      filasProductos.map((fila) => [fila.nombre, fila.id])
    );

    const vinculos = [];
    for (const promocion of promociones) {
      for (const nombreProducto of promocion.productos) {
        const productoId = productoIdPorNombre[nombreProducto];
        if (!productoId) {
          throw new Error(
            `Seeder promociones: producto "${nombreProducto}" no existe`
          );
        }
        vinculos.push({
          promocionId: promoIdPorNombre[promocion.nombre],
          productoId,
          createdAt: ahora,
          updatedAt: ahora,
        });
      }
    }
    await queryInterface.bulkInsert('PromocionProductos', vinculos);
  },

  down: async (queryInterface) => {
    const [filas] = await queryInterface.sequelize.query(
      'SELECT id FROM "Promociones" WHERE nombre IN (:nombres);',
      {
        replacements: {
          nombres: promociones.map((promocion) => promocion.nombre),
        },
      }
    );
    const ids = filas.map((fila) => fila.id);
    if (ids.length > 0) {
      await queryInterface.bulkDelete(
        'PromocionProductos',
        { promocionId: ids },
        {}
      );
      await queryInterface.bulkDelete('Promociones', { id: ids }, {});
    }
  },
};
