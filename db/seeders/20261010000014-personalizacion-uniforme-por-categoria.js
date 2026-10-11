'use strict';

/**
 * Catálogo canónico y uniforme de personalización por producto.
 *
 * CARACTERÍSTICAS:
 *  - Idempotente: solo inserta lo que falta (clave producto + tipo + nombre +
 *    producto de referencia). Correrlo dos veces NO duplica.
 *  - Portable: busca los productos por NOMBRE, no por id (los ids no son
 *    estables entre entornos porque dependen del orden de los seeders).
 *  - Reversible: down() borra únicamente lo que este seeder crea, sin tocar
 *    elementos que existieran antes.
 *
 * Regla de uniformidad: todos los productos de una misma categoría comparten
 * exactamente el mismo set. Topes del modal cliente (extra 6, personalizar 7,
 * acompanar 3, condimento 2) respetados para que se vean todas las opciones.
 */

const CATALOGO = {
  'Hamburguesa Clásica': [
    { tipo: 'extra', nombre: 'Bacon', precio: 3200.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Queso Cheddar en fetas',
      precio: 2400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Medallón extra', precio: 4800.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Cebolla caramelizada',
      precio: 1400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Tomate en rodajas', precio: 1200.0, ref: null },
    { tipo: 'personalizar', nombre: 'Pan XL', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Queso Cheddar en fetas',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Bacon', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Lechuga', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Tomate', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Cebolla', precio: null, ref: null },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Cheddar',
      precio: 8700.0,
      ref: 'Papas Cheddar',
    },
    {
      tipo: 'acompanar',
      nombre: 'Coca-Cola 500ml',
      precio: 3600.0,
      ref: 'Coca-Cola 500ml',
    },
    { tipo: 'condimento', nombre: 'Sobre de Ketchup', precio: null, ref: null },
    { tipo: 'condimento', nombre: 'Sobre de Mostaza', precio: null, ref: null },
    {
      tipo: 'condimento',
      nombre: 'Sobre de Mayonesa',
      precio: null,
      ref: null,
    },
  ],
  'Hamburguesa Doble': [
    { tipo: 'extra', nombre: 'Bacon', precio: 3200.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Queso Cheddar en fetas',
      precio: 2400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Medallón extra', precio: 4800.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Cebolla caramelizada',
      precio: 1400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Tomate en rodajas', precio: 1200.0, ref: null },
    { tipo: 'personalizar', nombre: 'Pan XL', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Queso Cheddar en fetas',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Bacon', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Lechuga', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Tomate', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Cebolla', precio: null, ref: null },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Cheddar',
      precio: 8700.0,
      ref: 'Papas Cheddar',
    },
    {
      tipo: 'acompanar',
      nombre: 'Coca-Cola 500ml',
      precio: 3600.0,
      ref: 'Coca-Cola 500ml',
    },
    { tipo: 'condimento', nombre: 'Sobre de Ketchup', precio: null, ref: null },
    { tipo: 'condimento', nombre: 'Sobre de Mostaza', precio: null, ref: null },
    {
      tipo: 'condimento',
      nombre: 'Sobre de Mayonesa',
      precio: null,
      ref: null,
    },
  ],
  'Pizza Muzzarella': [
    { tipo: 'extra', nombre: 'Muzzarella extra', precio: 2200.0, ref: null },
    { tipo: 'extra', nombre: 'Jamón', precio: 2800.0, ref: null },
    { tipo: 'extra', nombre: 'Morrón asado', precio: 1800.0, ref: null },
    { tipo: 'extra', nombre: 'Aceitunas negras', precio: 1400.0, ref: null },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Tomate en rodajas', precio: 1600.0, ref: null },
    { tipo: 'personalizar', nombre: 'Muzzarella', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Aceitunas', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Orégano', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Salsa de tomate',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Morrón asado', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Masa fina', precio: null, ref: null },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Coca-Cola 500ml',
      precio: 3600.0,
      ref: 'Coca-Cola 500ml',
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Cheddar',
      precio: 8700.0,
      ref: 'Papas Cheddar',
    },
    { tipo: 'condimento', nombre: 'Sobre de Orégano', precio: null, ref: null },
    { tipo: 'condimento', nombre: 'Sobre de Ají', precio: null, ref: null },
  ],
  'Pizza Napolitana': [
    { tipo: 'extra', nombre: 'Muzzarella extra', precio: 2200.0, ref: null },
    { tipo: 'extra', nombre: 'Jamón', precio: 2800.0, ref: null },
    { tipo: 'extra', nombre: 'Morrón asado', precio: 1800.0, ref: null },
    { tipo: 'extra', nombre: 'Aceitunas negras', precio: 1400.0, ref: null },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Tomate en rodajas', precio: 1600.0, ref: null },
    { tipo: 'personalizar', nombre: 'Muzzarella', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Aceitunas', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Orégano', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Salsa de tomate',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Morrón asado', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Masa fina', precio: null, ref: null },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Coca-Cola 500ml',
      precio: 3600.0,
      ref: 'Coca-Cola 500ml',
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Cheddar',
      precio: 8700.0,
      ref: 'Papas Cheddar',
    },
    { tipo: 'condimento', nombre: 'Sobre de Orégano', precio: null, ref: null },
    { tipo: 'condimento', nombre: 'Sobre de Ají', precio: null, ref: null },
  ],
  'Coca-Cola 500ml': [
    { tipo: 'personalizar', nombre: 'Hielo', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Azúcar', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Rodaja de limón',
      precio: null,
      ref: null,
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Hamburguesa Clásica',
      precio: 9800.0,
      ref: 'Hamburguesa Clásica',
    },
  ],
  'Limonada Natural': [
    { tipo: 'personalizar', nombre: 'Hielo', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Azúcar', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Rodaja de limón',
      precio: null,
      ref: null,
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Hamburguesa Clásica',
      precio: 9800.0,
      ref: 'Hamburguesa Clásica',
    },
  ],
  'Combo Doble': [
    { tipo: 'extra', nombre: 'Bacon', precio: 3200.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Queso Cheddar en fetas',
      precio: 2400.0,
      ref: null,
    },
    {
      tipo: 'extra',
      nombre: 'Muzzarella extra',
      precio: 2200.0,
      ref: null,
      activo: false,
    },
    {
      tipo: 'extra',
      nombre: 'Cebolla caramelizada',
      precio: 1400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Morrón asado', precio: 1800.0, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Queso Cheddar en fetas',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Bacon', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Lechuga', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Cebolla', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Muzzarella',
      precio: null,
      ref: null,
      activo: false,
    },
    {
      tipo: 'personalizar',
      nombre: 'Aceitunas',
      precio: null,
      ref: null,
      activo: false,
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Cheddar',
      precio: 8700.0,
      ref: 'Papas Cheddar',
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Limonada Natural',
      precio: 3400.0,
      ref: 'Limonada Natural',
    },
    { tipo: 'condimento', nombre: 'Sobre de Ketchup', precio: null, ref: null },
    { tipo: 'condimento', nombre: 'Sobre de Mostaza', precio: null, ref: null },
  ],
  'Papas Fritas Grandes': [
    { tipo: 'extra', nombre: 'Cheddar extra', precio: 2400.0, ref: null },
    { tipo: 'extra', nombre: 'Bacon', precio: 3200.0, ref: null },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Cebolla de verdeo', precio: 1300.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Dip de queso cheddar',
      precio: 1900.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Sal de ajo', precio: 900.0, ref: null },
    { tipo: 'personalizar', nombre: 'Sal', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Cheddar', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Bacon', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Cebolla de verdeo',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Pimienta', precio: null, ref: null },
    {
      tipo: 'acompanar',
      nombre: 'Coca-Cola 500ml',
      precio: 3600.0,
      ref: 'Coca-Cola 500ml',
    },
    {
      tipo: 'acompanar',
      nombre: 'Limonada Natural',
      precio: 3400.0,
      ref: 'Limonada Natural',
    },
    {
      tipo: 'acompanar',
      nombre: 'Hamburguesa Clásica',
      precio: 9800.0,
      ref: 'Hamburguesa Clásica',
    },
    { tipo: 'condimento', nombre: 'Sobre de Ketchup', precio: null, ref: null },
    {
      tipo: 'condimento',
      nombre: 'Sobre de Mayonesa',
      precio: null,
      ref: null,
    },
  ],
  'Papas Cheddar': [
    { tipo: 'extra', nombre: 'Cheddar extra', precio: 2400.0, ref: null },
    { tipo: 'extra', nombre: 'Bacon', precio: 3200.0, ref: null },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Cebolla de verdeo', precio: 1300.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Dip de queso cheddar',
      precio: 1900.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Sal de ajo', precio: 900.0, ref: null },
    { tipo: 'personalizar', nombre: 'Sal', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Cheddar', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Bacon', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Cebolla de verdeo',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Pimienta', precio: null, ref: null },
    {
      tipo: 'acompanar',
      nombre: 'Coca-Cola 500ml',
      precio: 3600.0,
      ref: 'Coca-Cola 500ml',
    },
    {
      tipo: 'acompanar',
      nombre: 'Limonada Natural',
      precio: 3400.0,
      ref: 'Limonada Natural',
    },
    {
      tipo: 'acompanar',
      nombre: 'Hamburguesa Clásica',
      precio: 9800.0,
      ref: 'Hamburguesa Clásica',
    },
    { tipo: 'condimento', nombre: 'Sobre de Ketchup', precio: null, ref: null },
    {
      tipo: 'condimento',
      nombre: 'Sobre de Mayonesa',
      precio: null,
      ref: null,
    },
  ],
  'Lava Cake': [
    {
      tipo: 'extra',
      nombre: 'Bocha de helado de crema',
      precio: 1800.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Dulce de leche', precio: 1200.0, ref: null },
    { tipo: 'extra', nombre: 'Frutillas', precio: 1600.0, ref: null },
    { tipo: 'extra', nombre: 'Crema chantilly', precio: 1300.0, ref: null },
    { tipo: 'extra', nombre: 'Chocolate rallado', precio: 1100.0, ref: null },
    { tipo: 'personalizar', nombre: 'Azúcar', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Frutillas', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Crema chantilly',
      precio: null,
      ref: null,
    },
    {
      tipo: 'personalizar',
      nombre: 'Salsa de chocolate',
      precio: null,
      ref: null,
    },
    {
      tipo: 'acompanar',
      nombre: 'Coca-Cola 500ml',
      precio: 3600.0,
      ref: 'Coca-Cola 500ml',
    },
    {
      tipo: 'acompanar',
      nombre: 'Limonada Natural',
      precio: 3400.0,
      ref: 'Limonada Natural',
    },
    {
      tipo: 'condimento',
      nombre: 'Sobre de salsa de chocolate',
      precio: null,
      ref: null,
    },
  ],
  Cheesecake: [
    {
      tipo: 'extra',
      nombre: 'Bocha de helado de crema',
      precio: 1800.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Dulce de leche', precio: 1200.0, ref: null },
    { tipo: 'extra', nombre: 'Frutillas', precio: 1600.0, ref: null },
    { tipo: 'extra', nombre: 'Crema chantilly', precio: 1300.0, ref: null },
    { tipo: 'extra', nombre: 'Chocolate rallado', precio: 1100.0, ref: null },
    { tipo: 'personalizar', nombre: 'Azúcar', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Frutillas', precio: null, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Crema chantilly',
      precio: null,
      ref: null,
    },
    {
      tipo: 'personalizar',
      nombre: 'Salsa de chocolate',
      precio: null,
      ref: null,
    },
    {
      tipo: 'acompanar',
      nombre: 'Coca-Cola 500ml',
      precio: 3600.0,
      ref: 'Coca-Cola 500ml',
    },
    {
      tipo: 'acompanar',
      nombre: 'Limonada Natural',
      precio: 3400.0,
      ref: 'Limonada Natural',
    },
    {
      tipo: 'condimento',
      nombre: 'Sobre de salsa de chocolate',
      precio: null,
      ref: null,
    },
  ],
  'Combo Clásico': [
    { tipo: 'extra', nombre: 'Bacon', precio: 3200.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Queso Cheddar en fetas',
      precio: 2400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Muzzarella extra', precio: 2200.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Cebolla caramelizada',
      precio: 1400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Morrón asado', precio: 1800.0, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Queso Cheddar en fetas',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Bacon', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Lechuga', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Cebolla', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Muzzarella', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Aceitunas', precio: null, ref: null },
    {
      tipo: 'acompanar',
      nombre: 'Papas Cheddar',
      precio: 8700.0,
      ref: 'Papas Cheddar',
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Limonada Natural',
      precio: 3400.0,
      ref: 'Limonada Natural',
    },
    { tipo: 'condimento', nombre: 'Sobre de Ketchup', precio: null, ref: null },
    { tipo: 'condimento', nombre: 'Sobre de Mostaza', precio: null, ref: null },
  ],
  'Combo Pizza': [
    { tipo: 'extra', nombre: 'Bacon', precio: 3200.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Queso Cheddar en fetas',
      precio: 2400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Muzzarella extra', precio: 2200.0, ref: null },
    {
      tipo: 'extra',
      nombre: 'Cebolla caramelizada',
      precio: 1400.0,
      ref: null,
    },
    { tipo: 'extra', nombre: 'Huevo frito', precio: 1500.0, ref: null },
    { tipo: 'extra', nombre: 'Morrón asado', precio: 1800.0, ref: null },
    {
      tipo: 'personalizar',
      nombre: 'Queso Cheddar en fetas',
      precio: null,
      ref: null,
    },
    { tipo: 'personalizar', nombre: 'Bacon', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Lechuga', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Cebolla', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Muzzarella', precio: null, ref: null },
    { tipo: 'personalizar', nombre: 'Aceitunas', precio: null, ref: null },
    {
      tipo: 'acompanar',
      nombre: 'Papas Cheddar',
      precio: 8700.0,
      ref: 'Papas Cheddar',
    },
    {
      tipo: 'acompanar',
      nombre: 'Papas Fritas Grandes',
      precio: 6900.0,
      ref: 'Papas Fritas Grandes',
    },
    {
      tipo: 'acompanar',
      nombre: 'Limonada Natural',
      precio: 3400.0,
      ref: 'Limonada Natural',
    },
    { tipo: 'condimento', nombre: 'Sobre de Ketchup', precio: null, ref: null },
    { tipo: 'condimento', nombre: 'Sobre de Mostaza', precio: null, ref: null },
  ],
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const productos = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Productos";',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const idPorNombre = Object.fromEntries(
      productos.map((p) => [p.nombre, p.id])
    );

    const ahora = new Date();
    const faltantes = [];
    const sinProducto = [];

    Object.keys(CATALOGO).forEach((nombreProducto) => {
      const productoId = idPorNombre[nombreProducto];
      if (!productoId) {
        sinProducto.push(nombreProducto);
        return;
      }
      CATALOGO[nombreProducto].forEach((el) => {
        const ref = el.ref ? idPorNombre[el.ref] : null;
        faltantes.push({
          productoId,
          tipo: el.tipo,
          nombre: el.nombre,
          precio: el.precio,
          productoReferenciaId: ref,
          activo: el.activo !== false,
          createdAt: ahora,
          updatedAt: ahora,
        });
      });
    });

    // Idempotencia: descartar lo que ya existe para no duplicar.
    const existentes = await queryInterface.sequelize.query(
      'SELECT "productoId", tipo, nombre, "productoReferenciaId" FROM "PersonalizacionElementos";',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const claves = new Set(
      existentes.map(
        (e) =>
          `${e.productoId}|${e.tipo}|${e.nombre}|${
            e.productoReferenciaId ?? ''
          }`
      )
    );

    const aInsertar = faltantes.filter((f) => {
      const clave = `${f.productoId}|${f.tipo}|${f.nombre}|${
        f.productoReferenciaId ?? ''
      }`;
      return !claves.has(clave);
    });

    if (aInsertar.length > 0) {
      await queryInterface.bulkInsert('PersonalizacionElementos', aInsertar);
    }

    const avisos = [];
    if (sinProducto.length) {
      avisos.push(`productos no encontrados: ${sinProducto.join(', ')}`);
    }
    console.log(
      `  ${aInsertar.length} insertados, ${
        faltantes.length - aInsertar.length
      } ya existían (de ${faltantes.length} del catálogo)` +
        (avisos.length ? ` — ${avisos.join('; ')}` : '')
    );
  },

  down: async (queryInterface, Sequelize) => {
    // Solo borra lo del catálogo: los elementos ajenos se conservan.
    const productos = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Productos";',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const idPorNombre = Object.fromEntries(
      productos.map((p) => [p.nombre, p.id])
    );

    const claves = [];
    Object.keys(CATALOGO).forEach((nombreProducto) => {
      const productoId = idPorNombre[nombreProducto];
      if (!productoId) return;
      CATALOGO[nombreProducto].forEach((el) => {
        claves.push({
          productoId,
          tipo: el.tipo,
          nombre: el.nombre,
          productoReferenciaId: el.ref ? idPorNombre[el.ref] : null,
        });
      });
    });

    if (claves.length) {
      const { Op } = Sequelize;
      await queryInterface.bulkDelete('PersonalizacionElementos', {
        [Op.or]: claves.map((k) => ({
          productoId: k.productoId,
          tipo: k.tipo,
          nombre: k.nombre,
          productoReferenciaId: k.productoReferenciaId,
        })),
      });
    }
    console.log(`  catálogo de personalización revertido`);
  },
};
