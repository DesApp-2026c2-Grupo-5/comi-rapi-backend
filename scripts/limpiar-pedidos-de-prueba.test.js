/**
 * Regresión del script de limpieza de pedidos de prueba.
 *
 * Existe porque este script falló dos veces contra datos reales: una versión
 * `--dry-run` que igual borraba, y un alcance `%@test.com` que se llevó los 4
 * pedidos de ejemplo de `cliente@test.com`. Los dos bugs borraron datos, así que
 * lo que se prueba acá es justamente que NO borre lo que no debe.
 *
 * Corre contra `SQL_TEST_DATABASE` porque usa la config del proyecto
 * (`lib/config/config.js`), que cambia de base con `NODE_ENV=test`. Esa era
 * justamente una falla del script: antes leía `.env.development` a propósito, así
 * que con `NODE_ENV=test` igual habría borrado la base de desarrollo.
 */
import { cleanDb } from '../test/db_utils';
import db from '../lib/models';
import {
  main,
  sequelize,
  USUARIOS_PROTEGIDOS,
} from './limpiar-pedidos-de-prueba';

const {
  Categoria,
  EstadoPedido,
  Pedido,
  PedidoEstadoHistorial,
  PedidoItem,
  PedidoPromocion,
  Producto,
  Promocion,
  Sucursal,
  Usuario,
} = db;

const n = (model, where) => model.count({ where });

jest.setTimeout(30000);

let sucursal;
let estado;
let producto;
let idsDemo = [];
let idsPrueba = [];

beforeAll(async () => {
  await cleanDb();

  sucursal = await Sucursal.create({ nombre: 'Sucursal Test' });
  estado = await EstadoPedido.create({
    nombre: 'pendiente',
    orden: 1,
    esInicial: true,
  });
  const categoria = await Categoria.create({ nombre: 'Categoría Test' });
  producto = await Producto.create({
    nombre: 'Producto Test',
    precio: 100,
    categoriaId: categoria.id,
    tipo: 'PRODUCTO',
    activo: true,
  });
  const promocion = await Promocion.create({
    nombre: 'Promo Test',
    tipo: 'DESCUENTO_PORCENTUAL',
    valor: 10,
    activa: true,
  });

  // Un pedido de la seeder: son un entregable del TP, no se pueden tocar.
  await Usuario.create({
    nombre: 'Cliente Demo',
    email: 'cliente@test.com',
    password: '123456',
    rol: 'CLIENTE',
  });
  // El admin también está en la lista de protegidos.
  await Usuario.create({
    nombre: 'Admin Demo',
    email: 'admin@test.com',
    password: '123456',
    rol: 'ADMINISTRADOR',
  });
  // Dos usuarios de prueba: el bug de paréntesis se manfestaba cuando el patrón
  // matcheaba a uno solo y dejaba pasar al otro.
  await Usuario.bulkCreate([
    {
      nombre: 'E2E Uno',
      email: 'ws-e2e-uno@test.com',
      password: '123456',
      rol: 'CLIENTE',
    },
    {
      nombre: 'E2E Dos',
      email: 'ws-e2e-dos@test.com',
      password: '123456',
      rol: 'CLIENTE',
    },
  ]);

  const porEmail = Object.fromEntries(
    (await Usuario.findAll()).map((u) => [u.email, u.id])
  );

  const crearPedido = async (email, extra = {}) => {
    const pedido = await Pedido.create({
      usuarioId: porEmail[email],
      sucursalId: sucursal.id,
      estadoId: estado.id,
      total: 100,
      ...extra,
    });
    await PedidoItem.create({
      pedidoId: pedido.id,
      productoId: producto.id,
      nombreProducto: 'Producto Test',
      precioUnitario: 100,
      cantidad: 1,
      subtotal: 100,
    });
    await PedidoEstadoHistorial.create({
      pedidoId: pedido.id,
      estadoId: estado.id,
      usuarioId: porEmail[email],
    });
    return pedido;
  };

  // 3 pedidos de la seeder: 1 de cliente con las 3 dependientes, 1 de admin.
  const demoCliente = await crearPedido('cliente@test.com', {
    observacion: 'SEED-EJEMPLO',
  });
  const demoAdmin = await crearPedido('admin@test.com');
  idsDemo = [demoCliente.id, demoAdmin.id];

  // 2 pedidos de prueba, con dependientes en las tres tablas hijas.
  const prueba1 = await crearPedido('ws-e2e-uno@test.com');
  const prueba2 = await crearPedido('ws-e2e-dos@test.com');
  await PedidoPromocion.create({
    pedidoId: prueba1.id,
    promocionId: promocion.id,
    descuentoAplicado: 5,
  });
  await PedidoPromocion.create({
    pedidoId: prueba2.id,
    promocionId: promocion.id,
    descuentoAplicado: 5,
  });
  idsPrueba = [prueba1.id, prueba2.id];
});

afterAll(async () => {
  await sequelize.close();
  await db.sequelize.close();
});

it('el setup dejó 2 pedidos de la seeder y 2 de prueba', async () => {
  expect(await n(Pedido)).toBe(4);
  expect(await n(PedidoItem)).toBe(4);
  expect(await n(PedidoEstadoHistorial)).toBe(4);
  expect(await n(PedidoPromocion)).toBe(2);
});

it('NO borra NADA', async () => {
  // El `main` es el que se usa en los e2e, así que el chequeo de dry-run va por
  // el mismo código que el borrado real.
  await main({ dryRun: true });
  expect(await n(Pedido)).toBe(4);
  expect(await n(PedidoItem)).toBe(4);
  expect(await n(PedidoEstadoHistorial)).toBe(4);
  expect(await n(PedidoPromocion)).toBe(2);
});

it('borra los pedidos de prueba y todas sus dependientes', async () => {
  await main();

  const restantes = (await Pedido.findAll()).map((p) => p.id);
  expect(restantes.sort()).toEqual(idsDemo.slice().sort());
  expect(restantes).toHaveLength(2);
  for (const id of idsPrueba) {
    expect(restantes).not.toContain(id);
  }

  expect(await n(PedidoItem)).toBe(2);
  expect(await n(PedidoEstadoHistorial)).toBe(2);
  expect(await n(PedidoPromocion)).toBe(0);
});

it('conserva los pedidos de TODOS los usuarios protegidos', async () => {
  const pedidos = await Pedido.findAll({
    include: [{ model: Usuario, as: 'cliente' }],
  });
  const emails = pedidos.map((p) => p.cliente.email).sort();
  expect(emails).toEqual([...USUARIOS_PROTEGIDOS].sort());
});

it('no toca los usuarios (los e2e los reutilizan por el rate limiter)', async () => {
  expect(await n(Usuario)).toBe(4);
});

it('es idempotente: correrlo de nuevo no cambia nada', async () => {
  await main();
  expect(await n(Pedido)).toBe(2);
  expect(await n(PedidoItem)).toBe(2);
});
