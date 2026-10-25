'use strict';

// Stock de demo en 150 para TODO el catálogo activo en cada sucursal activa.
//
// Por qué un seeder aparte y no tocar `20260930000004-stock-sucursales.js`: ese
// seeder arma el stock inicial con cantidades chicas y "ajustes" pensados para
// probar faltantes (Palermo con poca Coca-Cola, Oeste sin Limonada, etc.). Acá
// se quiere lo contrario: volumen parejo para que las compras demo no choquen
// con el stock y las pantallas no muestren alertas de reposición en cada
// producto.
//
// Regla de combos (DER §8): la cantidad de un combo NO se carga a mano, se
// deriva de su receta:
//
//     cantidad = min( floor(150 / unidades que lleva el componente) )
//
// Con las recetas actuales (todas 1x) el resultado también es 150. Si mañana
// un combo lleva 2 unidades de algo, su stock derivado baja a 75 y el número
// sigue siendo coherente con lo que la sucursal puede armar.
//
// Idempotente: upsert por la PK compuesta (sucursalId, productoId). También
// vuelve a poner `disponible = true`, porque el seeder anterior apagaba algunos
// productos para simular faltantes.

const CANTIDAD_BASE = 150;
const CANTIDAD_RESTAURADA = 25;

async function aplicarStock(queryInterface, cantidadBase) {
  const [sucursales] = await queryInterface.sequelize.query(
    `SELECT id FROM "Sucursales" WHERE activa = TRUE ORDER BY id`
  );
  if (!sucursales.length) {
    throw new Error(
      'Seeder de stock: no hay sucursales activas. Ejecutar los seeders previos.'
    );
  }

  const [productos] = await queryInterface.sequelize.query(
    `SELECT id, tipo FROM "Productos" WHERE activo = TRUE ORDER BY id`
  );
  if (!productos.length) {
    throw new Error(
      'Seeder de stock: no hay productos activos. Ejecutar los seeders previos.'
    );
  }

  const [componentes] = await queryInterface.sequelize.query(
    'SELECT "comboId", "productoId", cantidad FROM "ComboComponentes";'
  );
  const recetaPorCombo = new Map();
  componentes.forEach((componente) => {
    if (!recetaPorCombo.has(componente.comboId)) {
      recetaPorCombo.set(componente.comboId, []);
    }
    recetaPorCombo.get(componente.comboId).push(componente);
  });

  const cantidadDeCombo = (productoId) => {
    const receta = recetaPorCombo.get(productoId) || [];
    if (!receta.length) return 0;
    return receta.reduce((minimo, componente) => {
      const porEste = Math.floor(
        cantidadBase / Math.max(1, Number(componente.cantidad))
      );
      return Math.min(minimo, porEste);
    }, Infinity);
  };

  for (const sucursal of sucursales) {
    for (const producto of productos) {
      const cantidad =
        producto.tipo === 'COMBO' ? cantidadDeCombo(producto.id) : cantidadBase;
      await queryInterface.sequelize.query(
        `INSERT INTO "Stocks"
           ("sucursalId","productoId","cantidad","disponible","createdAt","updatedAt")
         VALUES (:sucursalId,:productoId,:cantidad,TRUE,NOW(),NOW())
         ON CONFLICT ("sucursalId","productoId") DO UPDATE SET
           "cantidad" = EXCLUDED."cantidad",
           "disponible" = TRUE,
           "updatedAt" = NOW()`,
        {
          replacements: {
            sucursalId: sucursal.id,
            productoId: producto.id,
            cantidad,
          },
        }
      );
    }
  }

  return sucursales.length * productos.length;
}

module.exports = {
  up: async (queryInterface) => {
    const filas = await aplicarStock(queryInterface, CANTIDAD_BASE);
    console.log(
      `Stock: ${filas} pares sucursal-producto en ${CANTIDAD_BASE} (combos según receta).`
    );
  },

  down: async (queryInterface) => {
    // No hay forma de reconstruir los ajustes originales (Palermo 6, Oeste 0,
    // etc.) sin duplicar ese seeder. Se vuelve a la base 25 para que el stock
    // no quede en 150 si alguien deshace este seeder.
    await aplicarStock(queryInterface, CANTIDAD_RESTAURADA);
  },
};
