import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

// T1: el POST ahora selecciona sucursal vía `seleccionarSucursal` (ORS +
// stock + cobertura). Los tests del controller mockean el SERVICE (no
// node-fetch) para probar HTTP sin APIs externas ni handles abiertos: la
// lógica de selección se prueba en seleccion_sucursal_service.test.js.
jest.mock('../services/seleccion_sucursal_service', () => ({
  seleccionarSucursal: jest.fn(),
  SinSucursalElegibleError: class SinSucursalElegibleError extends Error {
    constructor(mensaje, opciones = {}) {
      super(
        mensaje ||
          'No hay sucursales disponibles con stock dentro de la cobertura'
      );
      this.name = 'SinSucursalElegibleError';
      if (opciones.faltantes) {
        this.faltantes = opciones.faltantes;
      }
    }
  },
}));
import {
  seleccionarSucursal,
  SinSucursalElegibleError,
} from '../services/seleccion_sucursal_service';

const {
  Categoria,
  EstadoPedido,
  Producto,
  Stock,
  Sucursal,
  Direccion,
  Usuario,
} = db;

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
  let direccionCliente;

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
    // T1: la sucursal necesita dirección con coordenadas para la selección.
    await Direccion.create({
      sucursalId: sucursal.id,
      calle: 'Av. Principal',
      altura: 123,
      provincia: 'Ciudad Autónoma de Buenos Aires',
      localidad: 'CABA',
      latitud: -34.6037,
      longitud: -58.3816,
      activa: true,
    });
    // El pedido descuenta stock: sin fila en `Stocks` la sucursal no ofrece el
    // producto y el POST se rechaza. Se carga con un número alto a propósito para
    // que las pruebas de pedido no peleen entre sí por las existencias.
    await Stock.create({
      sucursalId: sucursal.id,
      productoId: producto.id,
      cantidad: 10000,
      disponible: true,
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
    // El registro público ya no crea ADMINISTRADOR (siempre CLIENTE): el
    // admin del fixture se crea directo en la base, con sucursal asignada
    // (GET/PATCH de pedidos exigen requiereSucursal) y loguea por /login.
    await crearUsuario({
      email: 'admin-pedidos@test.com',
      rol: 'ADMINISTRADOR',
      sucursalId: sucursal.id,
    });
    const csrfAdmin = await obtenerCsrf(agenteAdmin);
    await agenteAdmin
      .post('/api/auth/login')
      .set('x-csrf-token', csrfAdmin)
      .send({ email: 'admin-pedidos@test.com', password: '123456' });

    // T1: dirección del cliente con coords (para los POST con direccionId).
    const cliente = await Usuario.findOne({
      where: { email: 'cliente-pedidos@test.com' },
    });
    direccionCliente = await Direccion.create({
      usuarioId: cliente.id,
      calle: 'Av. Cliente Test',
      altura: 500,
      provincia: 'Ciudad Autónoma de Buenos Aires',
      localidad: 'Comuna 1',
      latitud: -34.6038,
      longitud: -58.3817,
      activa: true,
    });
  });

  // T1: mock del service de selección — la lógica se prueba en
  // seleccion_sucursal_service.test.js; acá solo se prueba HTTP.
  beforeEach(() => {
    seleccionarSucursal.mockResolvedValue(sucursal);
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
          direccionId: direccionCliente.id,
          // total enviado a propósito incorrecto: el backend lo recalcula
          total: 1,
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(3000);
      expect(res.body.data.estado).toBe('pendiente');
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].nombreProducto).toBe('Hamburguesa Clásica');
      // T0: el snapshot tiene coords de la Direccion persistida.
      expect(Number(res.body.data.latitud)).toBeCloseTo(-34.6038, 3);
      expect(Number(res.body.data.longitud)).toBeCloseTo(-58.3817, 3);
    });

    // T0: direccionId con coords → snapshot geolocalizado; sin coords → 422.
    it('crea pedido con direccionId → snapshot con coordenadas (201)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionId: direccionCliente.id,
        });
      expect(res.statusCode).toBe(201);
      expect(Number(res.body.data.latitud)).toBeCloseTo(-34.6038, 3);
      expect(res.body.data.calle).toBe('Av. Cliente Test');
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
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionId: direccionCliente.id,
        });
      expect(res.statusCode).toBe(404);
    });

    // T1: sin sucursal elegible → 422 con mensaje claro.
    it('SinSucursalElegibleError → 422 con mensaje de cobertura/stock', async () => {
      seleccionarSucursal.mockRejectedValue(
        new (require('../services/seleccion_sucursal_service').SinSucursalElegibleError)()
      );
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionId: direccionCliente.id,
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/sucursales/i);
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

    // T0: direccionId de una dirección sin coordenadas → 422.
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
          direccionId: direccionCliente.id,
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
      // T3: el serializer expone los campos del ETA (null si ORS falló).
      expect(res.body.data).toHaveProperty('etaMinutos');
      expect(res.body.data).toHaveProperty('etaCalculadoEn');
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
          direccionId: direccionCliente.id,
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
          direccionId: direccionCliente.id,
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
          direccionId: direccionCliente.id,
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

    it('reasigna a la MÁS CERCANA con stock dentro de cobertura y cobra igual (200)', async () => {
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

      // La reasignación al pagar usa las MISMAS reglas D1 que la asignación
      // inicial (seleccion_sucursal_service): más cercana por ruta con stock,
      // dentro de cobertura, excluyendo la original (exceptoSucursalId).
      seleccionarSucursal.mockResolvedValue(sucursalRespaldo);

      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('confirmado');
      // El pedido quedó en la sucursal que sí tenía stock, no en la original.
      expect(res.body.data.sucursalId).toBe(sucursalRespaldo.id);
      // La búsqueda excluyó a la original: su reserva venció.
      expect(seleccionarSucursal).toHaveBeenLastCalledWith(
        expect.objectContaining({ exceptoSucursalId: sucursal.id })
      );

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

    it('ninguna sucursal en cobertura con stock → 409 con el máximo disponible, sin tocar nada', async () => {
      // Sin stock en ninguna sucursal.
      await Stock.update(
        { disponible: false },
        { where: { sucursalId: sucursalRespaldo.id, productoId: producto.id } }
      );
      const { csrf, id } = await pedidoSinStockEnLaSucursal();

      // El service de selección no encuentra elegibles y reporta los
      // faltantes de la mejor candidata.
      seleccionarSucursal.mockRejectedValue(
        new SinSucursalElegibleError(
          'No hay sucursales disponibles con stock dentro de la cobertura',
          {
            faltantes: [
              {
                productoId: producto.id,
                nombre: 'Hamburguesa Clásica',
                hay: 0,
                necesario: 1,
              },
            ],
          }
        )
      );

      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/no hay stock suficiente/i);
      expect(res.body.error).toMatch(/Hamburguesa/);
      // El mensaje nombra el producto faltante y no manda a armar el pedido
      // de nuevo: en el flujo de pago el problema nunca fue el carrito.
      expect(res.body.error).not.toMatch(/otra sucursal/i);

      // El pedido sigue PENDIENTE con su sucursal original: no se cobró
      // nada ni se movió stock (la transacción se revierte completa).
      const detalle = await agenteCliente.get(`/api/pedidos/${id}`);
      expect(detalle.body.data.estado).toBe('pendiente');
      expect(detalle.body.data.sucursalId).toBe(sucursal.id);
    });
  });

  // Regresión del caso reportado: quedaban Coca-Cola en 4 y en 10, el cliente
  // pedía 11 y el mensaje decía "quedan 4". La elección de la mejor candidata
  // (menos productos faltantes; empate → más unidades) vive ahora en
  // seleccion_sucursal_service (testeada allá); acá se prueba el mapeo HTTP
  // del 422 del POST con los faltantes que el service reporta.
  describe('el mensaje de stock informa el máximo disponible', () => {
    it('422 con "quedan 10" cuando la mejor candidata tiene 10', async () => {
      seleccionarSucursal.mockRejectedValue(
        new SinSucursalElegibleError(
          'No hay sucursales disponibles con stock dentro de la cobertura',
          {
            faltantes: [
              {
                productoId: producto.id,
                nombre: 'Hamburguesa Clásica',
                hay: 10,
                necesario: 11,
              },
            ],
          }
        )
      );
      const csrf = await obtenerCsrf(agenteCliente);

      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          productos: [{ productoId: producto.id, cantidad: 11 }],
          direccionEntrega: { calle: 'Av. Coca 123', ciudad: 'CABA' },
        });

      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/quedan 10 unidades disponibles/);
      expect(res.body.error).not.toMatch(/quedan 4/);
    });

    it('sin candidatas evaluadas → 422 con el mensaje genérico de cobertura', async () => {
      seleccionarSucursal.mockRejectedValue(
        new SinSucursalElegibleError(
          'No hay sucursales activas dentro de la cobertura de la dirección de entrega'
        )
      );
      const csrf = await obtenerCsrf(agenteCliente);

      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          productos: [{ productoId: producto.id, cantidad: 11 }],
          direccionEntrega: { calle: 'Av. Coca 123', ciudad: 'CABA' },
        });

      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/cobertura/i);
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
          direccionId: direccionCliente.id,
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
          direccionId: direccionCliente.id,
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
    let combo;

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

      // Combo con `producto` (que tiene promo 10%) como componente: sirve para
      // verificar que la promoción de un componente no baja el precio del combo.
      combo = await Producto.create({
        nombre: 'Combo Test',
        precio: 3200,
        categoriaId: producto.categoriaId,
        activo: true,
        tipo: 'COMBO',
      });
      await db.ComboComponente.create({
        comboId: combo.id,
        productoId: producto.id,
        cantidad: 1,
      });
      await Stock.create({
        sucursalId: sucursal.id,
        productoId: combo.id,
        cantidad: 10000,
        disponible: true,
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

    it('el combo no baja de precio aunque la promo alcance a su componente', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: combo.id, cantidad: 1 }],
          // promo10 alcanza a `producto`, que es componente del combo, no el combo.
          promocionIds: [promo10.id],
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('descuenta solo la línea sin combo cuando la promo alcanza a otro producto', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [
            { productoId: combo.id, cantidad: 1 },
            { productoId: producto.id, cantidad: 1 },
          ],
          promocionIds: [promo10.id],
        });
      expect(res.statusCode).toBe(201);
      // 3200 (combo intacto) + 1500 - 10% de 1500 = 4550
      expect(res.body.data.total).toBe(4550);
    });

    it('rechaza con 400 una promo que solo alcanza al combo', async () => {
      const promoCombo = await db.Promocion.create({
        nombre: 'Test Solo Combo',
        tipo: 'DESCUENTO_PORCENTUAL',
        valor: 10,
        activa: true,
      });
      await db.PromocionProducto.create({
        promocionId: promoCombo.id,
        productoId: combo.id,
      });

      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: combo.id, cantidad: 1 }],
          promocionIds: [promoCombo.id],
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
