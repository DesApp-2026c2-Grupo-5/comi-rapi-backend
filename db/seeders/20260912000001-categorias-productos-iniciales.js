'use strict';

const categorias = [
  {
    nombre: 'Hamburguesas',
    descripcion: 'Nuestras deliciosas hamburguesas',
    imagen: '/api/imagenes/categorias/hamburguesas-1790053851796.webp',
  },
  {
    nombre: 'Pizzas',
    descripcion: 'Pizzas artesanales al horno de barro',
    imagen: '/api/imagenes/categorias/pizzas-1790053880184.webp',
  },
  {
    nombre: 'Combos',
    descripcion: 'Combos con papas y bebida',
    imagen: '/api/imagenes/categorias/combos-1790053842240.webp',
  },
  {
    nombre: 'Papas',
    descripcion: 'Papas fritas para compartir',
    imagen: '/api/imagenes/categorias/papas-1790053863426.webp',
  },
  {
    nombre: 'Bebidas',
    descripcion: 'Bebidas frías y calientes',
    imagen: '/api/imagenes/categorias/bebidas-1790053831873.webp',
  },
  {
    nombre: 'Postres',
    descripcion: 'El mejor cierre para tu pedido',
    imagen: '/api/imagenes/categorias/postres-1790053891920.webp',
  },
];

const imagenProducto = {
  'Hamburguesa Clásica':
    '/api/imagenes/productos/hamburguesa-cl-sica-1790052254629.webp',
  'Hamburguesa Doble':
    '/api/imagenes/productos/hamburguesa-doble-1790052273784.webp',
  'Pizza Muzzarella':
    '/api/imagenes/productos/pizza-muzzarella-1790052372329.webp',
  'Pizza Napolitana':
    '/api/imagenes/productos/pizza-napolitana-1790052386484.webp',
  'Coca-Cola 500ml':
    '/api/imagenes/productos/coca-cola-500ml-1790052521265.webp',
  'Limonada Natural':
    '/api/imagenes/productos/limonada-natural-1790052306263.webp',
  'Combo Doble': '/api/imagenes/productos/combo-doble-1790052511089.webp',
  'Papas Fritas Grandes':
    '/api/imagenes/productos/papas-fritas-grandes-1790052356724.webp',
  'Papas Cheddar': '/api/imagenes/productos/papas-cheddar-1790052341490.webp',
  'Lava Cake': '/api/imagenes/productos/lava-cake-1790052288448.webp',
  Cheesecake: '/api/imagenes/productos/cheesecake-1790052214004.webp',
  'Hamburguesa Cheddar Bacon':
    '/api/imagenes/productos/hamburguesa-cheddar-bacon-1792890157563.webp',
  'Hamburguesa Dulce':
    '/api/imagenes/productos/hamburguesa-dulce-1792890885264.webp',
  "Papas 'Kimchi' Coreanas":
    '/api/imagenes/productos/papas-kimchi-coreanas-1792895231374.webp',
  'Pizza Fugazzeta':
    '/api/imagenes/productos/pizza-fugazzeta-1792897264258.webp',
};

const productos = [
  {
    nombre: 'Hamburguesa Clásica',
    precio: 9800,
    categoria: 'Hamburguesas',
    descripcion: 'Carne jugosa, cheddar fundido y vegetales frescos.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Hamburguesa Doble',
    precio: 12900,
    categoria: 'Hamburguesas',
    descripcion: 'Doble carne, doble cheddar.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Hamburguesa Cheddar Bacon',
    precio: 11900,
    categoria: 'Hamburguesas',
    descripcion: 'Cheddar a chorros y panceta crocante.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Pizza Muzzarella',
    precio: 16900,
    categoria: 'Pizzas',
    descripcion: 'Muzzarella que se estira en cada porción.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Pizza Napolitana',
    precio: 18400,
    categoria: 'Pizzas',
    descripcion: 'Tomate fresco, muzzarella y albahaca.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Pizza Fugazzeta',
    precio: 17900,
    categoria: 'Pizzas',
    descripcion: 'Muzzarella en serio y cebolla dorada.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Coca-Cola 500ml',
    precio: 3600,
    categoria: 'Bebidas',
    descripcion: 'Bien fría, botella de vidrio de 500 ml.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Limonada Natural',
    precio: 4200,
    categoria: 'Bebidas',
    descripcion: 'Exprimida al momento, con hielo.',
    tipo: 'PRODUCTO',
  },
  {
    // El combo lleva Hamburguesa Doble + Papas Fritas Grandes + Coca-Cola 500ml,
    // que por separado dan 23.400. Va por debajo de esa suma para que tenga
    // sentido comprarlo como combo y no por separado.
    nombre: 'Combo Doble',
    precio: 21200,
    categoria: 'Combos',
    descripcion:
      'Hamburguesa Doble, papas grandes y Coca-Cola. Comida completa a precio de combo.',
    tipo: 'COMBO',
  },
  {
    nombre: 'Papas Fritas Grandes',
    precio: 6900,
    categoria: 'Papas',
    descripcion: 'Crocantes por fuera, tiernas por dentro.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Papas Cheddar',
    precio: 8700,
    categoria: 'Papas',
    descripcion: 'Papas crocantes ahogadas en cheddar.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: "Papas 'Kimchi' Coreanas",
    precio: 8400,
    categoria: 'Papas',
    descripcion: 'Papas con kimchi picante y mayonesa.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Lava Cake',
    precio: 6900,
    categoria: 'Postres',
    descripcion: 'Chocolate líquido que se desborda al cortar.',
    tipo: 'PRODUCTO',
  },
  {
    nombre: 'Cheesecake',
    precio: 7200,
    categoria: 'Postres',
    descripcion: 'Cremoso, con salsa de frutos rojos.',
    tipo: 'PRODUCTO',
  },
  {
    // Queda en Postres porque se vende y se agrupa como postre (pan de
    // chocolate, frutilla, caramelo salado): así está cargada en la base actual.
    nombre: 'Hamburguesa Dulce',
    precio: 7900,
    categoria: 'Postres',
    descripcion: 'Postre con forma de hamburguesa.',
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
