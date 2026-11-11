'use strict';

/**
 * Seeder demo de ingredientes, recetas y stock (BE-7).
 *
 * Carga un catálogo mínimo de materias primas, las recetas de los productos
 * simples actuales, el stock de ingredientes por sucursal y las filas de
 * `Stocks` derivadas para que el catálogo quede operable. También sincroniza
 * las opciones "Sin X" (`personalizar`) a partir de la receta.
 *
 * Es idempotente: upserts por nombre/unidad y por las PK compuestas.
 */

const INGREDIENTES = [
  { nombre: 'Pan de hamburguesa', unidadMedida: 'unidad' },
  { nombre: 'Carne de res', unidadMedida: 'g' },
  { nombre: 'Queso cheddar', unidadMedida: 'g' },
  { nombre: 'Tomate', unidadMedida: 'g' },
  { nombre: 'Lechuga', unidadMedida: 'g' },
  { nombre: 'Papa', unidadMedida: 'g' },
  { nombre: 'Masa de pizza', unidadMedida: 'unidad' },
  { nombre: 'Muzzarella', unidadMedida: 'g' },
  { nombre: 'Harina', unidadMedida: 'g' },
  { nombre: 'Chocolate', unidadMedida: 'g' },
  { nombre: 'Leche', unidadMedida: 'ml' },
  { nombre: 'Café molido', unidadMedida: 'g' },
  { nombre: 'Limón', unidadMedida: 'unidad' },
  { nombre: 'Azúcar', unidadMedida: 'g' },
  { nombre: 'Hielo', unidadMedida: 'g' },
];

// Recetas por nombre de producto. Cada entrada: [ingrediente, cantidad, permiteQuitar].
const RECETAS = {
  'Hamburguesa Clásica': [
    ['Pan de hamburguesa', 1, false],
    ['Carne de res', 150, false],
    ['Queso cheddar', 20, true],
    ['Tomate', 20, true],
    ['Lechuga', 10, true],
  ],
  'Hamburguesa Doble': [
    ['Pan de hamburguesa', 1, false],
    ['Carne de res', 300, false],
    ['Queso cheddar', 40, true],
    ['Tomate', 20, true],
    ['Lechuga', 10, true],
  ],
  'Hamburguesa Cheddar Bacon': [
    ['Pan de hamburguesa', 1, false],
    ['Carne de res', 150, false],
    ['Queso cheddar', 30, true],
    ['Tomate', 20, true],
  ],
  'Hamburguesa Royale con Queso & Pepinillos': [
    ['Pan de hamburguesa', 1, false],
    ['Carne de res', 150, false],
    ['Queso cheddar', 20, true],
  ],
  'Papas Fritas Grandes': [['Papa', 300, false]],
  'Papas Cheddar': [
    ['Papa', 300, false],
    ['Queso cheddar', 40, true],
  ],
  "Papas 'Kimchi' Coreanas": [['Papa', 300, false]],
  'Pizza Muzzarella': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 200, true],
    ['Tomate', 100, true],
  ],
  'Pizza Napolitana': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 200, true],
    ['Tomate', 100, true],
  ],
  'Pizza Fugazzeta': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 250, true],
  ],
  'Pizza Cuatro Quesos': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 150, true],
    ['Queso cheddar', 50, true],
  ],
  'Pizza Pepperoni & Miel Picante': [
    ['Masa de pizza', 1, false],
    ['Muzzarella', 200, true],
    ['Tomate', 80, true],
  ],
  'Coca-Cola 500ml': [['Hielo', 100, true]],
  'Limonada Natural': [
    ['Limón', 2, true],
    ['Azúcar', 20, true],
    ['Hielo', 100, true],
  ],
  'Caramel Frappuccino': [
    ['Leche', 200, false],
    ['Café molido', 10, false],
    ['Azúcar', 20, true],
  ],
  'Pumpkin Spice Latte': [
    ['Leche', 200, false],
    ['Café molido', 10, false],
    ['Azúcar', 20, true],
  ],
  'The Pink Drink': [
    ['Leche', 150, false],
    ['Azúcar', 15, true],
  ],
  Cheesecake: [
    ['Harina', 150, false],
    ['Queso cheddar', 100, false],
    ['Azúcar', 80, false],
  ],
  'New York Cheesecake con Frutos Rojos': [
    ['Harina', 150, false],
    ['Queso cheddar', 100, false],
    ['Azúcar', 80, false],
  ],
  'Lava Cake': [
    ['Harina', 50, false],
    ['Chocolate', 80, false],
    ['Azúcar', 40, false],
  ],
  'Volcan de Chocolate': [
    ['Harina', 50, false],
    ['Chocolate', 80, false],
    ['Azúcar', 40, false],
  ],
  'Tarta Rogel': [
    ['Harina', 150, false],
    ['Azúcar', 100, false],
  ],
  'Hamburguesa Dulce': [
    ['Pan de hamburguesa', 1, false],
    ['Chocolate', 30, true],
  ],
};

module.exports = {
  up: async (queryInterface) => {
    const sequelize = queryInterface.sequelize;

    // Ingredientes
    for (const ingrediente of INGREDIENTES) {
      await sequelize.query(
        `INSERT INTO "Ingredientes" ("nombre","unidadMedida","activo","createdAt","updatedAt")
         VALUES (:nombre, :unidadMedida, TRUE, NOW(), NOW())
         ON CONFLICT (LOWER("nombre")) DO NOTHING`,
        { replacements: ingrediente }
      );
    }

    const [ingredientes] = await sequelize.query(
      `SELECT id, nombre FROM "Ingredientes"`
    );
    const idPorNombre = new Map(
      ingredientes.map((i) => [i.nombre.toLowerCase(), i.id])
    );

    const [productos] = await sequelize.query(
      `SELECT id, nombre FROM "Productos" WHERE tipo = 'PRODUCTO' AND activo = TRUE`
    );
    const idPorProducto = new Map(
      productos.map((p) => [p.nombre.toLowerCase(), p.id])
    );

    // Recetas
    for (const [nombreProducto, receta] of Object.entries(RECETAS)) {
      const productoId = idPorProducto.get(nombreProducto.toLowerCase());
      if (!productoId) continue;

      await sequelize.query(
        `DELETE FROM "ProductoIngredientes" WHERE "productoId" = :productoId`,
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

    // Stock de ingredientes: 1000 en cada sucursal activa.
    await sequelize.query(`
      INSERT INTO "IngredienteStocks" ("sucursalId","ingredienteId","cantidad","disponible","createdAt","updatedAt")
      SELECT s."id", i."id", 1000, TRUE, NOW(), NOW()
      FROM "Sucursales" AS s CROSS JOIN "Ingredientes" AS i
      WHERE s."activa" = TRUE
      ON CONFLICT ("sucursalId","ingredienteId") DO NOTHING
    `);

    // Filas de Stocks para los productos simples: se crean con una cantidad
    // generosa para que el catálogo quede operable. La cantidad real se deriva
    // de los ingredientes; el admin puede recalcular desde la pantalla de Stock.
    await sequelize.query(`
      INSERT INTO "Stocks" ("sucursalId","productoId","cantidad","disponible","createdAt","updatedAt")
      SELECT s."id", p."id", 100, TRUE, NOW(), NOW()
      FROM "Sucursales" AS s CROSS JOIN "Productos" AS p
      WHERE s."activa" = TRUE AND p."tipo" = 'PRODUCTO' AND p."activo" = TRUE
      ON CONFLICT ("sucursalId","productoId") DO NOTHING
    `);
  },

  down: async () => {
    // No se borran datos demo automáticamente.
  },
};
