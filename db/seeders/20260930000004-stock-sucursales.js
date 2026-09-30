'use strict';

// Existencias iniciales por sucursal (DER §2.10).
//
// El stock es por sucursal: el mismo producto tiene una cantidad distinta en
// cada una. Los combos también entran con fila propia, pero su `cantidad` es un
// tope que puso la sucursal, no la garantía de que se pueda armar.
//
// "Sucursal Sur" deja a propósito la Hamburguesa Doble en 0 y "Sucursal Centro"
// con un tope de combos por debajo de su máximo: sirven para ver que la
// disponibilidad de un combo sale del stock de sus componentes y no de su fila.

const stockPorSucursal = {
  'Sucursal Centro': {
    'Hamburguesa Clásica': 25,
    'Hamburguesa Doble': 20,
    'Pizza Muzzarella': 15,
    'Pizza Napolitana': 12,
    'Papas Fritas Grandes': 25,
    'Papas Cheddar': 18,
    'Coca-Cola 500ml': 40,
    'Limonada Natural': 30,
    'Lava Cake': 15,
    Cheesecake: 12,
    'Combo Doble': 15,
  },
  'Sucursal Norte': {
    'Hamburguesa Clásica': 18,
    'Hamburguesa Doble': 10,
    'Pizza Muzzarella': 10,
    'Pizza Napolitana': 8,
    'Papas Fritas Grandes': 12,
    'Papas Cheddar': 10,
    'Coca-Cola 500ml': 30,
    'Limonada Natural': 20,
    'Lava Cake': 10,
    Cheesecake: 9,
    'Combo Doble': 8,
  },
  // Sin hamburguesa doble no hay combos, por más que la fila del combo cargue 5.
  'Sucursal Sur': {
    'Hamburguesa Clásica': 14,
    'Hamburguesa Doble': 0,
    'Pizza Muzzarella': 12,
    'Pizza Napolitana': 12,
    'Papas Fritas Grandes': 20,
    'Papas Cheddar': 15,
    'Coca-Cola 500ml': 35,
    'Limonada Natural': 25,
    'Lava Cake': 12,
    Cheesecake: 10,
    'Combo Doble': 5,
  },
};

module.exports = {
  up: async (queryInterface) => {
    const [productos] = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Productos" WHERE activo = true;'
    );
    const [sucursales] = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Sucursales";'
    );

    const idProducto = new Map(
      productos.map((producto) => [producto.nombre, producto.id])
    );
    const ahora = new Date();
    const filas = [];
    sucursales.forEach((sucursal) => {
      const cantidades = stockPorSucursal[sucursal.nombre];
      if (!cantidades) return;
      Object.entries(cantidades).forEach(([nombreProducto, cantidad]) => {
        const productoId = idProducto.get(nombreProducto);
        if (!productoId) return;
        filas.push({
          sucursalId: sucursal.id,
          productoId,
          cantidad,
          disponible: true,
          createdAt: ahora,
          updatedAt: ahora,
        });
      });
    });

    if (filas.length > 0) {
      await queryInterface.bulkInsert('Stocks', filas);
    }
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('Stocks', null, {});
  },
};
