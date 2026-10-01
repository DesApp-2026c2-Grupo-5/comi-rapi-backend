'use strict';

// Receta de los combos del catálogo inicial (DER §2.6).
//
// `cantidad` es cuántas unidades del componente lleva UNA unidad del combo.
// El precio del combo es propio y no se calcula sumando los componentes.

const combos = {
  'Combo Doble': [
    { producto: 'Hamburguesa Doble', cantidad: 1 },
    { producto: 'Papas Fritas Grandes', cantidad: 1 },
    { producto: 'Coca-Cola 500ml', cantidad: 1 },
  ],
};

module.exports = {
  up: async (queryInterface) => {
    const [productos] = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Productos";'
    );
    const idPorNombre = new Map(
      productos.map((producto) => [producto.nombre, producto.id])
    );

    const filas = [];
    Object.entries(combos).forEach(([nombreCombo, componentes]) => {
      const comboId = idPorNombre.get(nombreCombo);
      if (!comboId) return;
      componentes.forEach(({ producto, cantidad }) => {
        const productoId = idPorNombre.get(producto);
        if (!productoId) return;
        filas.push({ comboId, productoId, cantidad });
      });
    });

    if (filas.length > 0) {
      const ahora = new Date();
      await queryInterface.bulkInsert(
        'ComboComponentes',
        filas.map((fila) => ({ ...fila, createdAt: ahora, updatedAt: ahora }))
      );
    }
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('ComboComponentes', null, {});
  },
};
