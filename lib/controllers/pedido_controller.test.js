import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { Categoria, EstadoPedido, Producto, Stock, Sucursal, Direccion } = db;

const agenteCliente = request.agent(app);
const agenteAdmin = request.agent(app);

async function obtenerCsrf(agente) {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function registrarYLoguear(agente, email, rol) {
  const csrf1 = await obtenerCsrf(agente);
  await agente.post('/api/auth/registro').set('x-csrf-token', csrf1).send({
    nombre: 'Test',
    email,
    password: '123456',
    rol,
  });
  const csrf2 = await obtenerCsrf(agente);
  await agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf2)
    .send({ email, password: '123456' });
}

describe('Pedidos controller', () => {
  let sucursal;
  let producto;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Test',
    });
    producto = await Producto.create({
      nombre: 'Hamburguesa Clásica',
      precio: 1500,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    sucursal = await Sucursal.create({ nombre: 'Sucursal Centro' });
    // El pedido descuenta stock: sin fila en `Stocks` la sucursal no ofrece el
    // producto y el POST se rechaza. Se carga con un número alto a propósito para
    // que las pruebas de pedido no peleen entre sí por las existencias.
    await Stock.create({
      sucursalId: sucursal.id,
      productoId: producto.id,
      cantidad: 10000,
      disponible: true,
    });
    await Direccion.create({
      sucursalId: sucursal.id,
      calle: 'Av. Principal',
      altura: 123,
      provincia: 'Buenos Aires',
      localidad: 'CABA',
      codigoPostal: '1406',
    });
    await EstadoPedido.bulkCreate([
      { nombre: 'pendiente', orden: 1, esInicial: true },
      { nombre: 'confirmado', orden: 2 },
      { nombre: 'en_preparacion', orden: 3 },
      { nombre: 'listo_para_entregar', orden: 4 },
      { nombre: 'en_camino', orden: 5 },
      { nombre: 'entregado', orden: 6, esFinal: true },
      { nombre: 'cancelado', orden: 7, esFinal: true },
    ]);

    await registrarYLoguear(
      agenteCliente,
      'cliente-pedidos@test.com',
      'CLIENTE'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-pedidos@test.com',
      'ADMINISTRADOR'
    );
  });

  describe('POST /api/pedidos', () => {
    it('responde 401 sin sesión', async () => {
      const res = await request(app)
        .post('/api/pedidos')
        .send({
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      // 401 por falta de sesión o 403 por falta de CSRF: ambos indican protección
      expect([401, 403]).toContain(res.statusCode);
    });

    it('crea un pedido con snapshot y total recalculado (201)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 2 }],
          direccionEntrega: { calle: 'Av. Siempreviva 123', ciudad: 'CABA' },
          // total enviado a propósito incorrecto: el backend lo recalcula
          total: 1,
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(3000);
      expect(res.body.data.estado).toBe('pendiente');
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].nombreProducto).toBe('Hamburguesa Clásica');
    });

    // T0 (plan maestro): el snapshot se resuelve con coordenadas desde la
    // Direccion persistida del usuario (direccionId).
    it('crea pedido con direccionId → snapshot con coordenadas de la Direccion (201)', async () => {
      const usuario = await db.Usuario.findOne({
        where: { email: 'cliente-pedidos@test.com' },
      });
      const direccion = await Direccion.create({
        usuarioId: usuario.id,
        calle: 'Av. Test Coordenadas',
        altura: 500,
        provincia: 'Ciudad Autónoma de Buenos Aires',
        localidad: 'Comuna 1',
        latitud: -34.6037,
        longitud: -58.3816,
        activa: true,
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionId: direccion.id,
        });
      expect(res.statusCode).toBe(201);
      expect(Number(res.body.data.latitud)).toBeCloseTo(-34.6037, 3);
      expect(Number(res.body.data.longitud)).toBeCloseTo(-58.3816, 3);
      expect(res.body.data.calle).toBe('Av. Test Coordenadas');
    });

    it('direccionId inexistente → 404', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionId: 999999,
        });
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/no encontrada/i);
    });

    it('direccionId de otro usuario → 404 (aislamiento)', async () => {
      const usuario = await db.Usuario.findOne({
        where: { email: 'cliente-pedidos@test.com' },
      });
      const direccion = await Direccion.create({
        usuarioId: usuario.id,
        calle: 'Av. Ajena',
        altura: 100,
        provincia: 'Ciudad Autónoma de Buenos Aires',
        latitud: -34.5,
        longitud: -58.3,
        activa: true,
      });
      // Cambia a una sesión ajena (admin) para intentar usar la dirección
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionId: direccion.id,
        });
      expect(res.statusCode).toBe(404);
    });

    it('direccionId de una dirección sin coordenadas → 422', async () => {
      const usuario = await db.Usuario.findOne({
        where: { email: 'cliente-pedidos@test.com' },
      });
      const direccion = await Direccion.create({
        usuarioId: usuario.id,
        calle: 'Av. Sin Coords',
        altura: 100,
        provincia: 'Ciudad Autónoma de Buenos Aires',
        latitud: null,
        longitud: null,
        activa: true,
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionId: direccion.id,
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/coordenadas/i);
    });

    it('rechaza pedido sin productos (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({ sucursalId: sucursal.id, productos: [] });
      expect(res.statusCode).toBe(400);
    });

    it('revalida precio vigente aunque el snapshot sea viejo (repetir)', async () => {
      const precioOriginal = Number(producto.precio);
      await producto.update({ precio: 6500 });
      try {
        const csrf = await obtenerCsrf(agenteCliente);
        const res = await agenteCliente
          .post('/api/pedidos')
          .set('x-csrf-token', csrf)
          .send({
            sucursalId: sucursal.id,
            productos: [
              {
                productoId: producto.id,
                cantidad: 1,
                // snapshot viejo a propósito: debe ignorarse
                nombre: 'Hamburguesa Clásica',
                precio: 1500,
              },
            ],
          });
        expect(res.statusCode).toBe(201);
        expect(res.body.data.total).toBe(6500);
        expect(res.body.data.items[0].precioUnitario).toBe(6500);
      } finally {
        await producto.update({ precio: precioOriginal });
      }
    });

    it('rechaza producto inactivo con error claro (400)', async () => {
      await producto.update({ activo: false });
      try {
        const csrf = await obtenerCsrf(agenteCliente);
        const res = await agenteCliente
          .post('/api/pedidos')
          .set('x-csrf-token', csrf)
          .send({
            sucursalId: sucursal.id,
            productos: [{ productoId: producto.id, cantidad: 1 }],
          });
        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/no disponible/i);
      } finally {
        await producto.update({ activo: true });
      }
    });

    it('rechaza producto inexistente con error claro (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: 999999, cantidad: 1 }],
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/no disponible/i);
    });
  });

  describe('GET /api/pedidos', () => {
    it('CLIENTE solo ve sus propios pedidos', async () => {
      const res = await agenteCliente.get('/api/pedidos');
      expect(res.statusCode).toBe(200);
      expect(
        res.body.data.every(
          (p) => p.cliente?.email === 'cliente-pedidos@test.com'
        )
      ).toBe(true);
    });

    it('ADMIN ve todos (?sucursalId= filtra)', async () => {
      const res = await agenteAdmin.get(
        `/api/pedidos?sucursalId=${sucursal.id}`
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PATCH /api/pedidos/:id/estado', () => {
    it('rechaza transición inválida pendiente → entregado (400)', async () => {
      const lista = await agenteCliente.get('/api/pedidos');
      const id = lista.body.data[0].id;
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'entregado' });
      expect(res.statusCode).toBe(400);
    });

    it('permite confirmar pendiente → confirmado con medioPago', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionEntrega: { calle: 'Av. Confirmar 1', ciudad: 'CABA' },
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;
      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('confirmado');
      expect(res.body.data.medioPago).toBe('TARJETA');
    });

    it('rechaza confirmar sin medioPago (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      const res = await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Medio de pago obligatorio para confirmar');
    });

    it('admin no puede confirmar pendiente ajeno (403, solo CLIENTE dueño)', async () => {
      const csrfCliente = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrfCliente)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrfAdmin)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      expect(res.statusCode).toBe(403);
    });

    it('cliente no puede avanzar confirmado → en_preparacion (403)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      const res = await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'en_preparacion' });
      expect(res.statusCode).toBe(403);
    });

    it('admin avanza confirmado → en_preparacion (200 + historial)', async () => {
      const csrfCliente = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrfCliente)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrfCliente)
        .send({ estado: 'confirmado', medioPago: 'MERCADO_PAGO' });
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrfAdmin)
        .send({ estado: 'en_preparacion' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('en_preparacion');
      expect(
        res.body.data.historial.some(
          (h) => h.EstadoPedido.nombre === 'en_preparacion'
        )
      ).toBe(true);
    });

    it('admin completa flujo hasta entregado (fallback repartidor)', async () => {
      const csrfCliente = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrfCliente)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      const id = creado.body.data.id;
      await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrfCliente)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      for (const estado of [
        'en_preparacion',
        'listo_para_entregar',
        'en_camino',
        'entregado',
      ]) {
        const res = await agenteAdmin
          .patch(`/api/pedidos/${id}/estado`)
          .set('x-csrf-token', csrfAdmin)
          .send({ estado });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.estado).toBe(estado);
      }
      const detalle = await agenteAdmin.get(`/api/pedidos/${id}`);
      expect(
        detalle.body.data.historial.map((h) => h.EstadoPedido.nombre)
      ).toEqual([
        'pendiente',
        'confirmado',
        'en_preparacion',
        'listo_para_entregar',
        'en_camino',
        'entregado',
      ]);
    });

    it('cliente no puede marcar en_camino → entregado (403)', async () => {
      const csrfCliente = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrfCliente)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      const id = creado.body.data.id;
      await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrfCliente)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      for (const estado of [
        'en_preparacion',
        'listo_para_entregar',
        'en_camino',
      ]) {
        await agenteAdmin
          .patch(`/api/pedidos/${id}/estado`)
          .set('x-csrf-token', csrfAdmin)
          .send({ estado });
      }
      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrfCliente)
        .send({ estado: 'entregado' });
      expect(res.statusCode).toBe(403);
    });

    it('cliente cancela su propio pedido pendiente (200)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionEntrega: { calle: 'Av. Siempreviva 456', ciudad: 'CABA' },
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;

      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'cancelado', observacion: 'Cancelado por el cliente' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('cancelado');
      expect(
        res.body.data.historial.some(
          (h) => h.EstadoPedido.nombre === 'cancelado'
        )
      ).toBe(true);
    });

    it('cliente no puede cancelarlo pedido ajeno (404/403)', async () => {
      const agenteOtro = request.agent(app);
      await registrarYLoguear(agenteOtro, 'cliente-otro@test.com', 'CLIENTE');

      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;

      const csrfOtro = await obtenerCsrf(agenteOtro);
      const res = await agenteOtro
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrfOtro)
        .send({ estado: 'cancelado' });
      expect(res.statusCode).toBe(403);
    });

    it('rechaza medioPago inválido (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      const res = await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'efectivo' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Medio de pago inválido');
    });

    it('persiste medioPago al confirmar', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionEntrega: { calle: 'Av. Siempreviva 456', ciudad: 'CABA' },
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;
      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'MERCADO_PAGO' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.medioPago).toBe('MERCADO_PAGO');

      const detalle = await agenteCliente.get(`/api/pedidos/${id}`);
      expect(detalle.statusCode).toBe(200);
      expect(detalle.body.data.medioPago).toBe('MERCADO_PAGO');
    });
  });

  describe('reasignación automática de sucursal al pagar', () => {
    let sucursalRespaldo;

    beforeAll(async () => {
      sucursalRespaldo = await Sucursal.create({ nombre: 'Sucursal Norte' });
      await Direccion.create({
        sucursalId: sucursalRespaldo.id,
        calle: 'Av. Respaldo 999',
        altura: 999,
        provincia: 'Buenos Aires',
        localidad: 'CABA',
        codigoPostal: '1406',
      });
    });

    // Estas pruebas apagan el stock y consumen existencias. Las siguientes del
    // archivo (historial, promociones) arman pedidos con el mismo producto, así
    // que hay que dejar la sucursal principal como estaba.
    afterAll(async () => {
      await Stock.update(
        { disponible: true, cantidad: 10000 },
        { where: { sucursalId: sucursal.id, productoId: producto.id } }
      );
    });

    /**
     * Crea un pedido pendiente de 1 unidad y después apaga el producto en la
     * sucursal del pedido: la reserva queda vencida, que es justo la situación
     * que dispara la reasignación.
     */
    async function pedidoSinStockEnLaSucursal() {
      const csrf = await obtenerCsrf(agenteCliente);
      // El test anterior puede haber dejado la sucursal apagada; se repone para
      // poder armar el pedido y recién después simular que se agotó.
      await Stock.update(
        { disponible: true },
        { where: { sucursalId: sucursal.id, productoId: producto.id } }
      );
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionEntrega: { calle: 'Av. Reasignada 777', ciudad: 'CABA' },
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;
      // El admin apaga el producto en la sucursal del pedido, después de que el
      // cliente ya lo armó: la reserva quedó vencida.
      await Stock.update(
        { disponible: false },
        { where: { sucursalId: sucursal.id, productoId: producto.id } }
      );
      return { csrf, id };
    }

    it('cambia de sucursal y cobra igual si hay otra con stock (200)', async () => {
      await Stock.create({
        sucursalId: sucursalRespaldo.id,
        productoId: producto.id,
        cantidad: 5,
        disponible: true,
      });
      // Se anota el stock antes de armar el pedido: la unidad que se reserve tiene
      // que volver a esta sucursal cuando el pago reasigne.
      const antesDeArmar = (
        await Stock.findOne({
          where: { sucursalId: sucursal.id, productoId: producto.id },
        })
      ).cantidad;
      const { csrf, id } = await pedidoSinStockEnLaSucursal();

      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('confirmado');
      // El pedido quedó en la sucursal que sí tenía stock, no en la original.
      expect(res.body.data.sucursalId).toBe(sucursalRespaldo.id);

      // La reserva se soltó en la sucursal vieja y se tomó en la nueva.
      const viejo = await Stock.findOne({
        where: { sucursalId: sucursal.id, productoId: producto.id },
      });
      expect(viejo.disponible).toBe(false);
      expect(viejo.cantidad).toBe(antesDeArmar);
      const nuevo = await Stock.findOne({
        where: { sucursalId: sucursalRespaldo.id, productoId: producto.id },
      });
      expect(nuevo.cantidad).toBe(4);
    });

    it('no manda al carrito: el mensaje de error es el de falta de stock', async () => {
      // Sin stock en ninguna sucursal.
      await Stock.update(
        { disponible: false },
        { where: { sucursalId: sucursalRespaldo.id, productoId: producto.id } }
      );
      const { csrf, id } = await pedidoSinStockEnLaSucursal();

      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/No nos queda stock/);
      expect(res.body.error).toMatch(/Hamburguesa/);
      // Ahora que la reasignación es automática, la única causa posible es que no
      // quede stock en ninguna sucursal, así que el mensaje nombra el producto y
      // no manda a armar el pedido de nuevo.
      expect(res.body.error).not.toMatch(/otra sucursal/i);

      // El pedido sigue PENDIENTE: no se cobró nada.
      const detalle = await agenteCliente.get(`/api/pedidos/${id}`);
      expect(detalle.body.data.estado).toBe('pendiente');
      expect(detalle.body.data.sucursalId).toBe(sucursal.id);
    });
  });

  describe('repetir pedido (reutiliza POST /pedidos)', () => {
    it('crea un pedido nuevo en pendiente desde items de un entregado propio', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const original = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 2 }],
          direccionEntrega: { calle: 'Av. Repetir 1', ciudad: 'CABA' },
        });
      expect(original.statusCode).toBe(201);
      const origenId = original.body.data.id;

      // Llevar el origen a entregado (flujo cliente confirma + admin avanza).
      await agenteCliente
        .patch(`/api/pedidos/${origenId}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      for (const estado of [
        'en_preparacion',
        'listo_para_entregar',
        'en_camino',
        'entregado',
      ]) {
        await agenteAdmin
          .patch(`/api/pedidos/${origenId}/estado`)
          .set('x-csrf-token', csrfAdmin)
          .send({ estado });
      }

      // Repetir: releer el pedido propio (solo dueño, 200) y re-postear sus productoId.
      const detalle = await agenteCliente.get(`/api/pedidos/${origenId}`);
      expect(detalle.statusCode).toBe(200);
      expect(detalle.body.data.estado).toBe('entregado');
      const itemsRepetidos = detalle.body.data.items.map((item) => ({
        productoId: item.productoId,
        cantidad: item.cantidad,
      }));

      const repetido = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: itemsRepetidos,
          direccionEntrega: { calle: 'Av. Repetir 1', ciudad: 'CABA' },
        });
      expect(repetido.statusCode).toBe(201);
      expect(repetido.body.data.estado).toBe('pendiente');
      expect(repetido.body.data.total).toBe(3000);
      expect(repetido.body.data.id).not.toBe(origenId);
    });

    it('no permite leer un pedido ajeno para repetirlo (403)', async () => {
      const agenteOtro = request.agent(app);
      await registrarYLoguear(
        agenteOtro,
        'cliente-repetir-otro@test.com',
        'CLIENTE'
      );
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      const csrfOtro = await obtenerCsrf(agenteOtro);
      const res = await agenteOtro.get(`/api/pedidos/${creado.body.data.id}`);
      expect(res.statusCode).toBe(403);
      expect(csrfOtro).toBeDefined();
    });
  });

  describe('filtros historial (74)', () => {
    it('filtra por estado manteniendo scope del cliente', async () => {
      const res = await agenteCliente.get('/api/pedidos?estado=pendiente');
      expect(res.statusCode).toBe(200);
      expect(
        res.body.data.every(
          (p) =>
            p.estado === 'pendiente' &&
            p.cliente?.email === 'cliente-pedidos@test.com'
        )
      ).toBe(true);
    });

    it('filtra por sucursalId para CLIENTE sin exponer otros usuarios', async () => {
      const res = await agenteCliente.get(
        `/api/pedidos?sucursalId=${sucursal.id}`
      );
      expect(res.statusCode).toBe(200);
      expect(
        res.body.data.every(
          (p) =>
            p.cliente?.email === 'cliente-pedidos@test.com' &&
            p.sucursalId === sucursal.id
        )
      ).toBe(true);
    });

    it('estado inexistente devuelve lista vacía (200)', async () => {
      const res = await agenteCliente.get('/api/pedidos?estado=no_existe');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('filtra por rango de fechas (desde/hasta)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      await db.Pedido.update(
        { fechaHora: new Date('2020-05-05T12:00:00Z') },
        { where: { id: creado.body.data.id } }
      );

      const fuera = await agenteCliente.get(
        '/api/pedidos?desde=2021-01-01&hasta=2021-12-31'
      );
      expect(fuera.statusCode).toBe(200);
      expect(fuera.body.data.some((p) => p.id === creado.body.data.id)).toBe(
        false
      );

      const dentro = await agenteCliente.get(
        '/api/pedidos?desde=2020-01-01&hasta=2020-12-31'
      );
      expect(dentro.statusCode).toBe(200);
      expect(dentro.body.data.some((p) => p.id === creado.body.data.id)).toBe(
        true
      );
    });
  });

  describe('promociones en POST /pedidos', () => {
    let promo2x1;
    let promo10;

    beforeAll(async () => {
      promo2x1 = await db.Promocion.create({
        nombre: 'Test 2x1',
        tipo: 'DOS_POR_UNO',
        valor: 50,
        activa: true,
      });
      await db.PromocionProducto.create({
        promocionId: promo2x1.id,
        productoId: producto.id,
      });
      promo10 = await db.Promocion.create({
        nombre: 'Test 10%',
        tipo: 'DESCUENTO_PORCENTUAL',
        valor: 10,
        activa: true,
      });
      await db.PromocionProducto.create({
        promocionId: promo10.id,
        productoId: producto.id,
      });
    });

    it('2x1 con par descuenta una unidad y guarda snapshot', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 2 }],
          promocionIds: [promo2x1.id],
        });
      expect(res.statusCode).toBe(201);
      // 2 x 1500 - 1500 (una gratis) = 1500
      expect(res.body.data.total).toBe(1500);

      const filas = await db.PedidoPromocion.findAll({
        where: { pedidoId: res.body.data.id },
      });
      expect(filas).toHaveLength(1);
      expect(filas[0].promocionId).toBe(promo2x1.id);
      expect(Number(filas[0].descuentoAplicado)).toBe(1500);
    });

    it('porcentual descuenta sobre alcanzados', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 2 }],
          promocionIds: [promo10.id],
        });
      expect(res.statusCode).toBe(201);
      // 3000 - 10% = 2700
      expect(res.body.data.total).toBe(2700);
    });

    it('sin promocionIds el total queda íntegro y sin snapshots', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 2 }],
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.total).toBe(3000);
      const filas = await db.PedidoPromocion.findAll({
        where: { pedidoId: res.body.data.id },
      });
      expect(filas).toHaveLength(0);
    });

    it('rechaza promo vencida, inactiva, sin alcance o inexistente (400)', async () => {
      const vencida = await db.Promocion.create({
        nombre: 'Test Vencida',
        tipo: 'DESCUENTO_PORCENTUAL',
        valor: 10,
        activa: true,
        fechaInicio: new Date('2020-01-01'),
        fechaFin: new Date('2020-12-31'),
      });
      await db.PromocionProducto.create({
        promocionId: vencida.id,
        productoId: producto.id,
      });
      const inactiva = await db.Promocion.create({
        nombre: 'Test Inactiva',
        tipo: 'DESCUENTO_PORCENTUAL',
        valor: 10,
        activa: false,
      });
      await db.PromocionProducto.create({
        promocionId: inactiva.id,
        productoId: producto.id,
      });
      const sinAlcance = await db.Promocion.create({
        nombre: 'Test Sin Alcance',
        tipo: 'DESCUENTO_PORCENTUAL',
        valor: 10,
        activa: true,
      });

      const csrf = await obtenerCsrf(agenteCliente);
      const cuerpo = {
        sucursalId: sucursal.id,
        productos: [{ productoId: producto.id, cantidad: 1 }],
      };
      for (const pid of [vencida.id, inactiva.id, sinAlcance.id, 999999]) {
        const res = await agenteCliente
          .post('/api/pedidos')
          .set('x-csrf-token', csrf)
          .send({ ...cuerpo, promocionIds: [pid] });
        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
      }
    });

    it('show expone promociones aplicadas con snapshot', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 2 }],
          promocionIds: [promo10.id],
        });
      expect(creado.statusCode).toBe(201);

      const detalle = await agenteCliente.get(
        `/api/pedidos/${creado.body.data.id}`
      );
      expect(detalle.statusCode).toBe(200);
      expect(detalle.body.data.promociones).toEqual([
        {
          promocionId: promo10.id,
          nombre: 'Test 10%',
          tipo: 'DESCUENTO_PORCENTUAL',
          descuentoAplicado: 300,
        },
      ]);
    });

    it('index expone promociones y [] cuando no hay', async () => {
      const res = await agenteCliente.get('/api/pedidos');
      expect(res.statusCode).toBe(200);
      const conPromo = res.body.data.find((p) =>
        (p.promociones || []).some((pr) => pr.promocionId === promo10.id)
      );
      expect(conPromo).toBeDefined();
      for (const pedido of res.body.data) {
        expect(Array.isArray(pedido.promociones)).toBe(true);
      }
    });
  });
});
