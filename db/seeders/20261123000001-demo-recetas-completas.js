'use strict';

const INGREDIENTES = [
  { nombre: 'Pan de hamburguesa', unidadMedida: 'unidad' },
  { nombre: 'Pan de chocolate', unidadMedida: 'unidad' },
  { nombre: 'Carne de res', unidadMedida: 'g' },
  { nombre: 'Queso cheddar', unidadMedida: 'g' },
  { nombre: 'Queso crema', unidadMedida: 'g' },
  { nombre: 'Queso provolone', unidadMedida: 'g' },
  { nombre: 'Queso parmesano', unidadMedida: 'g' },
  { nombre: 'Muzzarella', unidadMedida: 'g' },
  { nombre: 'Tomate', unidadMedida: 'g' },
  { nombre: 'Lechuga', unidadMedida: 'g' },
  { nombre: 'Cebolla', unidadMedida: 'g' },
  { nombre: 'Cebolla caramelizada', unidadMedida: 'g' },
  { nombre: 'Cebolla de verdeo', unidadMedida: 'g' },
  { nombre: 'Pepinillos', unidadMedida: 'g' },
  { nombre: 'Bacon', unidadMedida: 'g' },
  { nombre: 'Pepperoni', unidadMedida: 'g' },
  { nombre: 'Miel picante', unidadMedida: 'g' },
  { nombre: 'Kimchi', unidadMedida: 'g' },
  { nombre: 'Ají', unidadMedida: 'g' },
  { nombre: 'Papa', unidadMedida: 'g' },
  { nombre: 'Masa de pizza', unidadMedida: 'unidad' },
  { nombre: 'Harina', unidadMedida: 'g' },
  { nombre: 'Manteca', unidadMedida: 'g' },
  { nombre: 'Huevo', unidadMedida: 'unidad' },
  { nombre: 'Azúcar', unidadMedida: 'g' },
  { nombre: 'Sal', unidadMedida: 'g' },
  { nombre: 'Aceite', unidadMedida: 'ml' },
  { nombre: 'Salsa de tomate', unidadMedida: 'g' },
  { nombre: 'Albahaca', unidadMedida: 'g' },
  { nombre: 'Orégano', unidadMedida: 'g' },
  { nombre: 'Ketchup', unidadMedida: 'g' },
  { nombre: 'Mayonesa', unidadMedida: 'g' },
  { nombre: 'Mostaza', unidadMedida: 'g' },
  { nombre: 'Coca-Cola', unidadMedida: 'ml' },
  { nombre: 'Agua', unidadMedida: 'ml' },
  { nombre: 'Hielo', unidadMedida: 'g' },
  { nombre: 'Limón', unidadMedida: 'unidad' },
  { nombre: 'Menta', unidadMedida: 'g' },
  { nombre: 'Leche', unidadMedida: 'ml' },
  { nombre: 'Café molido', unidadMedida: 'g' },
  { nombre: 'Crema de leche', unidadMedida: 'ml' },
  { nombre: 'Crema batida', unidadMedida: 'g' },
  { nombre: 'Salsa de caramelo', unidadMedida: 'g' },
  { nombre: 'Especias de calabaza', unidadMedida: 'g' },
  { nombre: 'Leche de coco', unidadMedida: 'ml' },
  { nombre: 'Frutillas', unidadMedida: 'g' },
  { nombre: 'Açaí', unidadMedida: 'g' },
  { nombre: 'Frutos rojos', unidadMedida: 'g' },
  { nombre: 'Chocolate', unidadMedida: 'g' },
  { nombre: 'Helado', unidadMedida: 'g' },
  { nombre: 'Dulce de leche', unidadMedida: 'g' },
  { nombre: 'Merengue', unidadMedida: 'g' },
];

const RECETAS = {
  'Hamburguesa Clásica': [
    ['Pan de hamburguesa', 1, false],
    ['Carne de res', 150, false],
    ['Queso cheddar', 20, true],
    ['Tomate', 20, true],
    ['Lechuga', 10, true],
    ['Cebolla', 15, true],
    ['Ketchup', 15, true],
    ['Mayonesa', 15, true],
    ['Mostaza', 5, true],
  ],
  'Hamburguesa Doble': [
    ['Pan de hamburguesa', 1, false],
    ['Carne de res', 300, false],
    ['Queso cheddar', 40, true],
    ['Tomate', 20, true],
    ['Lechuga', 10, true],
    ['Cebolla', 20, true],
    ['Ketchup', 20, true],
    ['Mayonesa', 20, true],
    ['Mostaza', 10, true],
  ],
  'Hamburguesa Cheddar Bacon': [
    ['Pan de hamburguesa', 1, false],
    ['Carne de res', 150, false],
    ['Queso cheddar', 40, true],
    ['Bacon', 30, true],
    ['Tomate', 20, true],
    ['Lechuga', 10, true],
    ['Cebolla', 15, true],
    ['Mayonesa', 20, true],
    ['Ketchup', 15, true],
    ['Mostaza', 5, true],
  ],
  'Hamburguesa Royale con Queso & Pepinillos': [
    ['Pan de hamburguesa', 1, false],
    ['Carne de res', 150, false],
    ['Queso cheddar', 20, true],
    ['Pepinillos', 30, true],
    ['Cebolla', 15, true],
    ['Tomate', 20, true],
    ['Lechuga', 10, true],
    ['Mayonesa', 20, true],
    ['Mostaza', 10, true],
    ['Ketchup', 15, true],
  ],
  'Papas Fritas Grandes': [
    ['Papa', 300, false],
    ['Aceite', 30, false],
    ['Sal', 5, true],
  ],
  'Papas Cheddar': [
    ['Papa', 300, false],
    ['Aceite', 30, false],
    ['Queso cheddar', 50, true],
    ['Sal', 5, true],
  ],
  "Papas 'Kimchi' Coreanas": [
    ['Papa', 300, false],
    ['Aceite', 30, false],
    ['Kimchi', 60, true],
    ['Mayonesa', 30, true],
    ['Cebolla de verdeo', 10, true],
    ['Ají', 5, true],
    ['Sal', 5, true],
  ],
  'Pizza Muzzarella': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 250, true],
    ['Salsa de tomate', 120, true],
    ['Albahaca', 5, true],
    ['Orégano', 5, true],
    ['Aceite', 10, false],
    ['Sal', 3, true],
  ],
  'Pizza Napolitana': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 200, true],
    ['Salsa de tomate', 120, true],
    ['Tomate', 100, true],
    ['Albahaca', 10, true],
    ['Orégano', 5, true],
    ['Aceite', 10, false],
    ['Sal', 3, true],
  ],
  'Pizza Fugazzeta': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 250, true],
    ['Cebolla', 150, true],
    ['Cebolla caramelizada', 50, true],
    ['Orégano', 5, true],
    ['Aceite', 10, false],
    ['Sal', 3, true],
  ],
  'Pizza Cuatro Quesos': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 150, true],
    ['Queso cheddar', 50, true],
    ['Queso provolone', 60, true],
    ['Queso parmesano', 40, true],
    ['Orégano', 5, true],
    ['Aceite', 10, false],
  ],
  'Pizza Pepperoni & Miel Picante': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 200, true],
    ['Salsa de tomate', 100, true],
    ['Pepperoni', 80, true],
    ['Miel picante', 30, true],
    ['Orégano', 5, true],
    ['Aceite', 10, false],
  ],
  'Coca-Cola 500ml': [
    ['Coca-Cola', 500, false],
    ['Hielo', 100, true],
  ],
  'Limonada Natural': [
    ['Limón', 3, false],
    ['Azúcar', 40, true],
    ['Agua', 300, false],
    ['Hielo', 150, true],
    ['Menta', 5, true],
  ],
  'Caramel Frappuccino.': [
    ['Leche', 200, false],
    ['Café molido', 15, false],
    ['Azúcar', 20, true],
    ['Hielo', 100, true],
    ['Salsa de caramelo', 30, true],
    ['Crema batida', 50, true],
  ],
  'Pumpkin Spice Latte': [
    ['Leche', 200, false],
    ['Café molido', 10, false],
    ['Azúcar', 20, true],
    ['Especias de calabaza', 5, true],
    ['Crema batida', 50, true],
  ],
  'The Pink Drink': [
    ['Leche de coco', 200, false],
    ['Frutillas', 80, true],
    ['Açaí', 30, true],
    ['Hielo', 100, true],
    ['Azúcar', 15, true],
  ],
  Cheesecake: [
    ['Harina', 150, false],
    ['Queso crema', 200, false],
    ['Azúcar', 100, false],
    ['Manteca', 60, false],
    ['Huevo', 3, false],
    ['Crema de leche', 100, false],
    ['Frutos rojos', 80, true],
  ],
  'New York Cheesecake con Frutos Rojos': [
    ['Harina', 150, false],
    ['Queso crema', 250, false],
    ['Azúcar', 120, false],
    ['Manteca', 60, false],
    ['Huevo', 3, false],
    ['Crema de leche', 100, false],
    ['Frutos rojos', 100, true],
  ],
  'Lava Cake': [
    ['Harina', 50, false],
    ['Chocolate', 80, false],
    ['Azúcar', 40, true],
    ['Manteca', 60, false],
    ['Huevo', 2, false],
    ['Helado', 80, true],
  ],
  'Volcan de Chocolate': [
    ['Harina', 50, false],
    ['Chocolate', 100, false],
    ['Azúcar', 40, true],
    ['Manteca', 60, false],
    ['Huevo', 2, false],
    ['Helado', 80, true],
  ],
  'Tarta Rogel': [
    ['Harina', 200, false],
    ['Azúcar', 100, false],
    ['Manteca', 80, false],
    ['Huevo', 2, false],
    ['Dulce de leche', 150, true],
    ['Merengue', 100, true],
  ],
  'Hamburguesa Dulce': [
    ['Pan de chocolate', 1, false],
    ['Frutillas', 50, true],
    ['Crema batida', 50, true],
    ['Salsa de caramelo', 40, true],
    ['Chocolate', 20, true],
  ],
};

module.exports = {
  up: async (queryInterface) => {
    const sequelize = queryInterface.sequelize;

    for (const ingrediente of INGREDIENTES) {
      await sequelize.query(
        `INSERT INTO "Ingredientes" ("nombre","unidadMedida","activo","createdAt","updatedAt")
         VALUES (:nombre, :unidadMedida, TRUE, NOW(), NOW())
         ON CONFLICT (LOWER("nombre")) DO NOTHING`,
        { replacements: ingrediente }
      );
    }

    const [ingredientes] = await sequelize.query(
      'SELECT id, nombre FROM "Ingredientes"'
    );
    const idPorNombre = new Map(
      ingredientes.map((ingrediente) => [
        ingrediente.nombre.toLowerCase(),
        ingrediente.id,
      ])
    );

    const [productos] = await sequelize.query(
      `SELECT id, nombre FROM "Productos" WHERE tipo = 'PRODUCTO' AND activo = TRUE`
    );
    const idPorProducto = new Map(
      productos.map((producto) => [producto.nombre.toLowerCase(), producto.id])
    );

    for (const [nombreProducto, receta] of Object.entries(RECETAS)) {
      const productoId = idPorProducto.get(nombreProducto.toLowerCase());
      if (!productoId) continue;

      await sequelize.query(
        'DELETE FROM "ProductoIngredientes" WHERE "productoId" = :productoId',
        { replacements: { productoId } }
      );
      await sequelize.query(
        `DELETE FROM "PersonalizacionElementos"
         WHERE "productoId" = :productoId AND "tipo" = 'personalizar'`,
        { replacements: { productoId } }
      );

      for (const [nombreIngrediente, cantidad, permiteQuitar] of receta) {
        const ingredienteId = idPorNombre.get(nombreIngrediente.toLowerCase());
        if (!ingredienteId) continue;

        await sequelize.query(
          `INSERT INTO "ProductoIngredientes"
             ("productoId","ingredienteId","cantidad","permiteQuitar","createdAt","updatedAt")
           VALUES (:productoId, :ingredienteId, :cantidad, :permiteQuitar, NOW(), NOW())
           ON CONFLICT ("productoId","ingredienteId") DO UPDATE SET
             "cantidad" = EXCLUDED."cantidad",
             "permiteQuitar" = EXCLUDED."permiteQuitar",
             "updatedAt" = NOW()`,
          {
            replacements: {
              productoId,
              ingredienteId,
              cantidad,
              permiteQuitar,
            },
          }
        );

        if (permiteQuitar) {
          await sequelize.query(
            `INSERT INTO "PersonalizacionElementos"
               ("productoId","tipo","nombre","precio","productoReferenciaId","minimo","maximo","activo","ingredienteId","createdAt","updatedAt")
             SELECT :productoId, 'personalizar', i."nombre", NULL, NULL, 0, 1, TRUE, i."id", NOW(), NOW()
             FROM "Ingredientes" AS i
             WHERE i."id" = :ingredienteId
             ON CONFLICT DO NOTHING`,
            { replacements: { productoId, ingredienteId } }
          );
        }
      }
    }

    await sequelize.query(`
      INSERT INTO "IngredienteStocks" ("sucursalId","ingredienteId","cantidad","disponible","createdAt","updatedAt")
      SELECT s."id", i."id", 1000, TRUE, NOW(), NOW()
      FROM "Sucursales" AS s CROSS JOIN "Ingredientes" AS i
      WHERE s."activa" = TRUE
      ON CONFLICT ("sucursalId","ingredienteId") DO NOTHING
    `);
  },

  down: async () => {},
};
