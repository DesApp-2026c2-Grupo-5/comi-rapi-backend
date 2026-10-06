'use strict';

// Combos extra del catálogo inicial, con su receta (DER §2.6).
//
// El catálogo inicial traía un solo combo ("Combo Doble", en
// 20260930000003-combo-componentes). Con uno solo no se puede probar nada
// interesante de combos: no hay forma de ver dos combos con recetas distintas en
// la misma sucursal, ni un combo cuyo componente se esté por acabar.
//
// ESTE ARCHIVO ES LA FUENTE DE VERDAD DE ESTOS COMBOS. Todo lo que se cambie acá
// (precio, receta, descripción, imagen) hay que cambiarlo acá: lo que se carga
// desde la pantalla de admin vive sólo en la base y un reset
// (`docker compose down -v` + seed) lo borra. Por eso las imágenes van
// declaradas acá y no se dejan "en la base".
//
// Ojo con la imagen: el archivo tiene que estar en el repo del frontend, en
// `public/imagenes/productos/`. Si subís una imagen desde la pantalla, el
// archivo queda sin trackear (git lo muestra como `??`) y un compañero que
// clonee no la va a tener: la combo le sale con la imagen rota. Hay que
// `git add`ear el archivo sí o sí.
//
// El precio de cada combo es PROPIO y va por debajo de la suma de sus
// componentes: si saliera al mismo precio, no tendría sentido comprarlo como
// combo en lugar de por separado, que es justo lo que hay que poder mostrar.
//
// Va antes que el seeder de stock (20260930000004) a propósito: ahí se calcula
// la cantidad de cada combo a partir de la receta, y para eso los componentes
// tienen que existir ya.

const combos = [
  {
    nombre: 'Combo Clásico',
    precio: 19500,
    descripcion: 'Hamburguesa clásica, papas fritas grandes y bebida.',
    imagen:
      '/imagenes/productos/combo-cl-sico-1790808917969-1791229635931.webp',
    componentes: [
      { producto: 'Hamburguesa Clásica', cantidad: 1 },
      { producto: 'Papas Fritas Grandes', cantidad: 1 },
      { producto: 'Coca-Cola 500ml', cantidad: 1 },
    ],
    // Suma de los componentes: 9.800 + 6.900 + 3.600 = 20.300.
  },
  {
    nombre: 'Combo Pizza',
    precio: 25900,
    descripcion: 'Pizza muzzarella, papas fritas y una coca cola.',
    imagen:
      '/imagenes/productos/combo-pizza-papas-bebida-1790809471048-1791229758604.webp',
    componentes: [
      { producto: 'Pizza Muzzarella', cantidad: 1 },
      { producto: 'Papas Fritas Grandes', cantidad: 1 },
      { producto: 'Coca-Cola 500ml', cantidad: 1 },
    ],
    // Suma: 16.900 + 6.900 + 3.600 = 27.400.
  },
];

module.exports = {
  up: async (queryInterface) => {
    const [categorias] = await queryInterface.sequelize.query(
      `SELECT id FROM "Categorias" WHERE nombre = 'Combos';`
    );
    const [productos] = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Productos";'
    );
    const idPorNombre = new Map(
      productos.map((producto) => [producto.nombre, producto.id])
    );

    const categoriaId = categorias[0] ? categorias[0].id : null;
    const ahora = new Date();

    const nuevos = combos.filter((combo) => !idPorNombre.has(combo.nombre));
    if (nuevos.length === 0) return;

    nuevos.forEach((combo) => {
      const faltantes = combo.componentes
        .map((c) => c.producto)
        .filter((nombre) => !idPorNombre.has(nombre));
      // Si un componente no existe se aborta con el nombre en el mensaje: es
      // mucho más útil que insertar un combo sin receta, que después aparece
      // como "no se puede armar" en la pantalla de stock sin explicación.
      if (faltantes.length > 0) {
        throw new Error(
          `El combo "${
            combo.nombre
          }" usa productos que no están en el catálogo: ${faltantes.join(', ')}`
        );
      }
    });

    await queryInterface.bulkInsert(
      'Productos',
      nuevos.map((combo) => ({
        nombre: combo.nombre,
        precio: combo.precio,
        descripcion: combo.descripcion,
        imagen: combo.imagen,
        categoriaId,
        activo: true,
        tipo: 'COMBO',
        createdAt: ahora,
        updatedAt: ahora,
      }))
    );

    // Postgres no devuelve los ids con bulkInsert, así que se releen por nombre.
    const [
      creados,
    ] = await queryInterface.sequelize.query(
      `SELECT id, nombre FROM "Productos" WHERE nombre IN (${nuevos
        .map(() => '?')
        .join(', ')});`,
      { replacements: nuevos.map((combo) => combo.nombre) }
    );
    const idDeNuevo = new Map(creados.map((p) => [p.nombre, p.id]));

    const recetas = [];
    combos.forEach((combo) => {
      const comboId = idDeNuevo.get(combo.nombre);
      if (!comboId) return;
      combo.componentes.forEach(({ producto, cantidad }) => {
        recetas.push({
          comboId,
          productoId: idPorNombre.get(producto),
          cantidad,
          createdAt: ahora,
          updatedAt: ahora,
        });
      });
    });
    await queryInterface.bulkInsert('ComboComponentes', recetas);
  },

  down: async (queryInterface) => {
    const nombres = combos.map((combo) => combo.nombre);
    const [
      productos,
    ] = await queryInterface.sequelize.query(
      `SELECT id FROM "Productos" WHERE nombre IN (${nombres
        .map(() => '?')
        .join(', ')});`,
      { replacements: nombres }
    );
    const ids = productos.map((producto) => producto.id);
    if (ids.length === 0) return;
    await queryInterface.bulkDelete('ComboComponentes', null, { comboId: ids });
    await queryInterface.bulkDelete('Productos', null, { id: ids });
  },
};
