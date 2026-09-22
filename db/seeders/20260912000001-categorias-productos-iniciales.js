'use strict';

const categorias = [
  {
    nombre: 'Hamburguesas',
    descripcion: 'Nuestras deliciosas hamburguesas',
    imagen: '/imagenes/categorias/hamburguesas-1790053851796.webp',
  },
  {
    nombre: 'Pizzas',
    descripcion: 'Pizzas artesanales al horno de barro',
    imagen: '/imagenes/categorias/pizzas-1790053880184.webp',
  },
  {
    nombre: 'Combos',
    descripcion: 'Combos con papas y bebida',
    imagen: '/imagenes/categorias/combos-1790053842240.webp',
  },
  {
    nombre: 'Papas',
    descripcion: 'Papas fritas para compartir',
    imagen: '/imagenes/categorias/papas-1790053863426.webp',
  },
  {
    nombre: 'Bebidas',
    descripcion: 'Bebidas frías y calientes',
    imagen: '/imagenes/categorias/bebidas-1790053831873.webp',
  },
  {
    nombre: 'Postres',
    descripcion: 'El mejor cierre para tu pedido',
    imagen: '/imagenes/categorias/postres-1790053891920.webp',
  },
];

const imagenProducto = {
  'Hamburguesa Clásica':
    '/imagenes/productos/hamburguesa-cl-sica-1790052254629.webp',
  'Hamburguesa Doble':
    '/imagenes/productos/hamburguesa-doble-1790052273784.webp',
  'Pizza Muzzarella': '/imagenes/productos/pizza-muzzarella-1790052372329.webp',
  'Pizza Napolitana': '/imagenes/productos/pizza-napolitana-1790052386484.webp',
  'Coca-Cola 500ml': '/imagenes/productos/coca-cola-500ml-1790052521265.webp',
  'Limonada Natural': '/imagenes/productos/limonada-natural-1790052306263.webp',
  'Combo Doble': '/imagenes/productos/combo-doble-1790052511089.webp',
  'Papas Fritas Grandes':
    '/imagenes/productos/papas-fritas-grandes-1790052356724.webp',
  'Papas Cheddar': '/imagenes/productos/papas-cheddar-1790052341490.webp',
  'Lava Cake': '/imagenes/productos/lava-cake-1790052288448.webp',
  Cheesecake: '/imagenes/productos/cheesecake-1790052214004.webp',
};

const productos = [
  {
    nombre: 'Hamburguesa Clásica',
    precio: 1500,
    categoria: 'Hamburguesas',
    descripcion: 'Deliciosa hamburguesa con lechuga, tomate y queso.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Hamburguesa Doble',
    precio: 2200,
    categoria: 'Hamburguesas',
    descripcion: 'Doble carne, doble queso, doble sabor.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Pizza Muzzarella',
    precio: 2500,
    categoria: 'Pizzas',
    descripcion: 'Pizza clásica con abundante muzzarella.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Pizza Napolitana',
    precio: 2800,
    categoria: 'Pizzas',
    descripcion: 'Con tomate, muzzarella y albahaca fresca.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Coca-Cola 500ml',
    precio: 800,
    categoria: 'Bebidas',
    descripcion: 'Coca-Cola bien fría de 500ml.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Limonada Natural',
    precio: 600,
    categoria: 'Bebidas',
    descripcion: 'Limonada natural recién preparada.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Combo Doble',
    precio: 3200,
    categoria: 'Combos',
    descripcion: 'Hamburguesa doble, papas fritas y bebida incluida.',
    tipo: 'COMBO',
  },
  {
    nombre: 'Papas Fritas Grandes',
    precio: 900,
    categoria: 'Papas',
    descripcion: 'Porción grande de papas crujientes con sal.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Papas Cheddar',
    precio: 1200,
    categoria: 'Papas',
    descripcion: 'Papas con abundante cheddar fundido y cebollín.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Lava Cake',
    precio: 1100,
    categoria: 'Postres',
    descripcion: 'Bizcocho de chocolate con centro fundido.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Cheesecake',
    precio: 1300,
    categoria: 'Postres',
    descripcion: 'Cheesecake cremoso con salsa de frutos rojos.',
    tipo: 'PRODUCTO',
  },
];

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.bulkInsert(
      'Categorias',
      categorias.map((categoria) => ({
        ...categoria,
        activa: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );

    const [filas] = await queryInterface.sequelize.query(
      'SELECT id, nombre FROM "Categorias";'
    );
    const idsPorNombre = Object.fromEntries(
      filas.map((fila) => [fila.nombre, fila.id])
    );

    await queryInterface.bulkInsert(
      'Productos',
      productos.map((producto) => ({
        nombre: producto.nombre,
        precio: producto.precio,
        imagen: imagenProducto[producto.nombre] || null,
        descripcion: producto.descripcion,
        categoriaId: idsPorNombre[producto.categoria],
        activo: true,
        tipo: producto.tipo,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('Productos', null, {});
    await queryInterface.bulkDelete('Categorias', null, {});
  },
};
