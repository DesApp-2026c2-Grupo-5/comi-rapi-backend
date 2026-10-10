'use strict';

// Existencias iniciales por sucursal (DER §2.10).
//
// El stock es por sucursal: el mismo producto tiene una cantidad distinta en
// cada una.
//
// Este seeder arma TODOS los pares (sucursal, producto activo), no una lista
//_partial_: antes tenía una tabla escrita a mano con sucursales que ya no
// existían ("Centro", "Norte", "Sur"), así que cada búsqueda fallaba y terminaba
// insertando CERO filas sin avisar. Por eso el catálogo entero aparecía sin
// stock y había que cargarlo a mano desde la pantalla.
//
// A partir de CANTIDAD_BASE se leagan dos ajustes por sucursal, para tener
// situaciones distintas que probar sin tocar nada:
//
// - Palermo con pocas gaseosas: los tres combos llevan Coca-Cola, así que los
//   tres quedan en 6 aunque el resto de sus componentes dé 25. Es el caso que
//   muestra que un combo se limita por el componente que menos da (docs/DER.md
//   §8), sin tocar la pantalla. Palermo además tiene pocas pizzas y un postre
//   por agotarse, para ver el aviso de stock insuficiente.
// - Oeste con la limonada en 0 pero todavía ofrecida: se ve "se ofrece pero no
//   hay stock". Ningún combo la lleva, así que este caso no arrastra a los
//   combos y los dos casos quedan independientes.
// - Recoleta con las Papas Cheddar en 0: es la segunda sucursal en cobertura de
//   la dirección demo del cliente, y es la que queda sin stock para disparar el
//   caso de reasignación al pagar. Se eligió un producto que el único combo
//   ("Combo Doble") no lleva, para que agotarlo en Recoleta no baje el combo ni
//   se confunda con el caso de Palermo.
//
// La cantidad de un COMBO no se escribe: se calcula acá con la misma regla que
// usa la aplicación, min(floor(cantidad del componente / cantidad que lleva la
// receta)). Si se dejara un número fijo, la fila arrancaría desfasada respecto
// de lo que la pantalla muestra.

const CANTIDAD_BASE = 25;

// Ajustes por sucursal. Producto inexistente o sucursal inexistente abortan el
// seed con un error claro: es preferible que falle el seed a que falte stock en
// silencio.
const ajustesPorSucursal = {
  'Sucursal Palermo': {
    'Coca-Cola 500ml': 6,
    'Pizza Napolitana': 3,
    Cheesecake: 2,
  },
  'Sucursal Oeste': {
    'Limonada Natural': 0,
  },
  'Sucursal Recoleta': {
    'Papas Cheddar': 0,
  },
};

module.exports = {
  up: async (queryInterface) => {
    const [productos] = await queryInterface.sequelize.query(
      'SELECT id, nombre, tipo FROM "Productos" WHERE activo = true;'
    );
    const [sucursales] = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Sucursales" WHERE activa = true;'
    );
    if (productos.length === 0 || sucursales.length === 0) {
      throw new Error(
        'No hay productos o sucursales activos para armar el stock. Revisá que corrieron los seeders anteriores.'
      );
    }

    const nombresSucursal = new Set(sucursales.map((s) => s.nombre));
    const nombresProducto = new Set(productos.map((p) => p.nombre));
    const errores = [];
    Object.keys(ajustesPorSucursal).forEach((nombre) => {
      if (!nombresSucursal.has(nombre)) {
        errores.push(`sucursal "${nombre}"`);
      }
      Object.keys(ajustesPorSucursal[nombre]).forEach((producto) => {
        if (!nombresProducto.has(producto)) {
          errores.push(`producto "${producto}" de "${nombre}"`);
        }
      });
    });
    if (errores.length > 0) {
      throw new Error(
        `Los ajustes de stock no matchean nada del catálogo: ${errores.join(
          ', '
        )}`
      );
    }

    // Stock de los productos simples: base + ajustes.
    const cantidadPorSucursalProducto = new Map();
    const simples = productos.filter((producto) => producto.tipo !== 'COMBO');
    sucursales.forEach((sucursal) => {
      simples.forEach((producto) => {
        const ajuste = (ajustesPorSucursal[sucursal.nombre] || {})[
          producto.nombre
        ];
        const cantidad = ajuste === undefined ? CANTIDAD_BASE : ajuste;
        cantidadPorSucursalProducto.set(
          `${sucursal.id}-${producto.id}`,
          cantidad
        );
      });
    });

    const ahora = new Date();
    const filas = [];
    sucursales.forEach((sucursal) => {
      simples.forEach((producto) => {
        filas.push({
          sucursalId: sucursal.id,
          productoId: producto.id,
          cantidad: cantidadPorSucursalProducto.get(
            `${sucursal.id}-${producto.id}`
          ),
          disponible: true,
          createdAt: ahora,
          updatedAt: ahora,
        });
      });
    });

    // Stock de los combos: sale de la receta, igual que en la aplicación.
    const combos = productos.filter((producto) => producto.tipo === 'COMBO');
    if (combos.length > 0) {
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
      combos.forEach((combo) => {
        const receta = recetaPorCombo.get(combo.id) || [];
        sucursales.forEach((sucursal) => {
          const maximo = receta.reduce((minimo, componente) => {
            const hay = cantidadPorSucursalProducto.get(
              `${sucursal.id}-${componente.productoId}`
            );
            const porEste = Math.floor(Number(hay ?? 0) / componente.cantidad);
            return Math.min(minimo, porEste);
          }, Infinity);
          filas.push({
            sucursalId: sucursal.id,
            productoId: combo.id,
            // Sin receta no se puede armar: 0, que es lo mismo que muestra la
            // pantalla para un combo sin componentes.
            cantidad: Number.isFinite(maximo) ? maximo : 0,
            disponible: true,
            createdAt: ahora,
            updatedAt: ahora,
          });
        });
      });
    }

    if (filas.length > 0) {
      await queryInterface.bulkInsert('Stocks', filas);
    }
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('Stocks', null, {});
  },
};
