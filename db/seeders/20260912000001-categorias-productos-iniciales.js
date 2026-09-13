'use strict';

const categorias = [
  { nombre: 'Hamburguesas', descripcion: 'Nuestras deliciosas hamburguesas' },
  { nombre: 'Pizzas', descripcion: 'Pizzas artesanales al horno de barro' },
  { nombre: 'Combos', descripcion: 'Combos con papas y bebida' },
  { nombre: 'Papas', descripcion: 'Papas fritas para compartir' },
  { nombre: 'Bebidas', descripcion: 'Bebidas frías y calientes' },
  { nombre: 'Postres', descripcion: 'El mejor cierre para tu pedido' },
];

const productos = [
  {
    nombre: 'Hamburguesa Clásica',
    precio: 1500,
    categoria: 'Hamburguesas',
    descripcion: 'Deliciosa hamburguesa con lechuga, tomate y queso.',
  },
  {
    nombre: 'Hamburguesa Doble',
    precio: 2200,
    categoria: 'Hamburguesas',
    descripcion: 'Doble carne, doble queso, doble sabor.',
  },
  {
    nombre: 'Pizza Muzzarella',
    precio: 2500,
    categoria: 'Pizzas',
    descripcion: 'Pizza clásica con abundante muzzarella.',
  },
  {
    nombre: 'Pizza Napolitana',
    precio: 2800,
    categoria: 'Pizzas',
    descripcion: 'Con tomate, muzzarella y albahaca fresca.',
  },
  {
    nombre: 'Coca-Cola 500ml',
    precio: 800,
    categoria: 'Bebidas',
    descripcion: 'Coca-Cola bien fría de 500ml.',
  },
  {
    nombre: 'Limonada Natural',
    precio: 600,
    categoria: 'Bebidas',
    descripcion: 'Limonada natural recién preparada.',
  },
  {
    nombre: 'Combo Doble',
    precio: 3200,
    categoria: 'Combos',
    descripcion: 'Hamburguesa doble, papas fritas y bebida incluida.',
  },
  {
    nombre: 'Papas Fritas Grandes',
    precio: 900,
    categoria: 'Papas',
    descripcion: 'Porción grande de papas crujientes con sal.',
  },
  {
    nombre: 'Papas Cheddar',
    precio: 1200,
    categoria: 'Papas',
    descripcion: 'Papas con abundante cheddar fundido y cebollín.',
  },
  {
    nombre: 'Lava Cake',
    precio: 1100,
    categoria: 'Postres',
    descripcion: 'Bizcocho de chocolate con centro fundido.',
  },
  {
    nombre: 'Cheesecake',
    precio: 1300,
    categoria: 'Postres',
    descripcion: 'Cheesecake cremoso con salsa de frutos rojos.',
  },
];

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.bulkInsert(
      'Categorias',
      categorias.map((categoria) => ({
        ...categoria,
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
        imagen: `https://via.placeholder.com/300x200?text=${encodeURIComponent(
          producto.nombre
        )}`,
        descripcion: producto.descripcion,
        categoriaId: idsPorNombre[producto.categoria],
        activo: true,
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
