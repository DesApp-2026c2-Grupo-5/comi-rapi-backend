'use strict';

/**
 * Plantillas de personalización iniciales por categoría.
 *
 * Reproduce el catálogo genérico que antes vivía hardcodeado en el frontend
 * (src/services/personalizacionConfig.js) para que, al eliminar ese fallback,
 * los productos sin configuración propia sigan mostrando opciones.
 *
 * Los ingredientes (`personalizar`) NO se siembran: son propios de cada
 * producto y se cargan en su formulario de alta/edición.
 *
 * Los acompañamientos sólo se insertan si el producto ofrecido existe en la
 * base; los que no existen se omiten y se informan por consola.
 *
 * Idempotente: no duplica filas si ya existen.
 */

const CATALOGO = {
  Hamburguesas: {
    extra: [
      { nombre: 'Tomate', precio: 1800 },
      { nombre: 'Bacon', precio: 3200 },
      { nombre: 'Queso Cheddar en fetas', precio: 2400 },
    ],
    personalizar: [
      'Pan XL',
      'Mostaza',
      'Ketchup',
      'Cebolla',
      'Bacon',
      'Queso Cheddar en fetas',
      'Carne',
    ],
    acompanar: [
      { producto: 'Pileta de Cheddar', precio: 5400 },
      { producto: 'Hamburguesa Con Queso', precio: 13900 },
      { producto: 'Papas Fritas Grandes', precio: 6900 },
    ],
    condimento: ['Sobre de Ketchup', 'Sobre de Mayonesa'],
  },
  Pizzas: {
    extra: [
      { nombre: 'Muzzarella extra', precio: 2200 },
      { nombre: 'Jamón', precio: 2800 },
      { nombre: 'Tomate', precio: 1800 },
    ],
    personalizar: ['Muzzarella', 'Tomate', 'Albahaca', 'Aceitunas', 'Orégano'],
    acompanar: [
      { producto: 'Papas Fritas Grandes', precio: 6900 },
      { producto: 'Gaseosa 500ml', precio: 3600 },
    ],
    condimento: ['Sobre de Orégano', 'Sobre de Ají'],
  },
  Combos: {
    extra: [
      { nombre: 'Bacon', precio: 3200 },
      { nombre: 'Queso Cheddar en fetas', precio: 2400 },
    ],
    personalizar: [
      'Pan',
      'Carne',
      'Queso',
      'Lechuga',
      'Tomate',
      'Papas',
      'Bebida',
    ],
    acompanar: [
      { producto: 'Pileta de Cheddar', precio: 5400 },
      { producto: 'Papas Fritas Grandes', precio: 6900 },
    ],
    condimento: ['Sobre de Ketchup', 'Sobre de Mayonesa'],
  },
  Papas: {
    extra: [
      { nombre: 'Cheddar extra', precio: 2400 },
      { nombre: 'Bacon', precio: 3200 },
    ],
    personalizar: ['Sal', 'Cheddar', 'Cebollín'],
    acompanar: [{ producto: 'Bebida 500ml', precio: 3600 }],
    condimento: ['Sobre de Ketchup', 'Sobre de Mayonesa'],
  },
  Bebidas: {
    extra: [],
    personalizar: ['Hielo', 'Azúcar', 'Limón'],
    acompanar: [],
    condimento: [],
  },
  Postres: {
    extra: [],
    personalizar: [],
    acompanar: [],
    condimento: [],
  },
};

const clave = (fila) =>
  `${fila.categoriaId}|${fila.tipo}|${fila.nombre}|${
    fila.productoReferenciaId ?? ''
  }`;

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const categorias = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Categorias";',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const productos = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Productos";',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const idCategoria = Object.fromEntries(
      categorias.map((c) => [c.nombre, c.id])
    );
    const idProducto = Object.fromEntries(
      productos.map((p) => [p.nombre, p.id])
    );

    const ahora = new Date();
    const faltantes = [];
    const omitidos = [];

    const agregar = (categoriaId, tipo, nombre, precio, ref) => {
      faltantes.push({
        categoriaId,
        tipo,
        nombre,
        precio,
        productoReferenciaId: ref,
        minimo: 0,
        maximo: 1,
        activo: true,
        createdAt: ahora,
        updatedAt: ahora,
      });
    };

    Object.entries(CATALOGO).forEach(([nombreCategoria, tipos]) => {
      const categoriaId = idCategoria[nombreCategoria];
      if (!categoriaId) {
        omitidos.push(`categoría ${nombreCategoria}`);
        return;
      }

      (tipos.extra || []).forEach((el) => {
        agregar(categoriaId, 'extra', el.nombre, el.precio, null);
      });
      // `personalizar` (ingredientes) no se siembra: es propio de cada producto.
      (tipos.condimento || []).forEach((nombre) => {
        agregar(categoriaId, 'condimento', nombre, null, null);
      });
      (tipos.acompanar || []).forEach((el) => {
        const ref = idProducto[el.producto];
        if (!ref) {
          omitidos.push(`${nombreCategoria}: ${el.producto}`);
          return;
        }
        agregar(categoriaId, 'acompanar', el.producto, el.precio, ref);
      });
    });

    const existentes = await queryInterface.sequelize.query(
      'SELECT "categoriaId", tipo, nombre, "productoReferenciaId" FROM "PersonalizacionCategorias";',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const claves = new Set(existentes.map(clave));
    const aInsertar = faltantes.filter((f) => !claves.has(clave(f)));

    if (aInsertar.length > 0) {
      await queryInterface.bulkInsert('PersonalizacionCategorias', aInsertar);
    }

    console.log(
      `  ${aInsertar.length} plantillas insertadas, ${
        faltantes.length - aInsertar.length
      } ya existían` +
        (omitidos.length
          ? ` — omitidos por no existir: ${omitidos.join(', ')}`
          : '')
    );
  },

  down: async (queryInterface, Sequelize) => {
    const categorias = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Categorias";',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const productos = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Productos";',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const idCategoria = Object.fromEntries(
      categorias.map((c) => [c.nombre, c.id])
    );
    const idProducto = Object.fromEntries(
      productos.map((p) => [p.nombre, p.id])
    );

    const claves = [];
    Object.entries(CATALOGO).forEach(([nombreCategoria, tipos]) => {
      const categoriaId = idCategoria[nombreCategoria];
      if (!categoriaId) return;
      (tipos.extra || []).forEach((el) => {
        claves.push({
          categoriaId,
          tipo: 'extra',
          nombre: el.nombre,
          productoReferenciaId: null,
        });
      });
      (tipos.personalizar || []).forEach((nombre) => {
        claves.push({
          categoriaId,
          tipo: 'personalizar',
          nombre,
          productoReferenciaId: null,
        });
      });
      (tipos.condimento || []).forEach((nombre) => {
        claves.push({
          categoriaId,
          tipo: 'condimento',
          nombre,
          productoReferenciaId: null,
        });
      });
      (tipos.acompanar || []).forEach((el) => {
        const ref = idProducto[el.producto];
        if (!ref) return;
        claves.push({
          categoriaId,
          tipo: 'acompanar',
          nombre: el.producto,
          productoReferenciaId: ref,
        });
      });
    });

    if (claves.length) {
      const { Op } = Sequelize;
      await queryInterface.bulkDelete('PersonalizacionCategorias', {
        [Op.or]: claves,
      });
    }
    console.log('  plantillas por categoría revertidas');
  },
};
