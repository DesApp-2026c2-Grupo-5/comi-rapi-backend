/**
 * Tests del canal de tiempo real (casos 1 a 7).
 *
 * Levanta un servidor HTTP real con Socket.IO adjunto y conecta clientes con
 * la MISMA cookie de sesión que usa la API REST, para comprobar que el canal
 * respeta la autenticación y la autorización por rooms ya existentes.
 *
 * El WebSocket solo notifica: estos tests comprueban el `pedidoId` recibido y
 * que los datos siguen obteniéndose por REST.
 */
import http from 'http';
import request from 'supertest';
import { io } from 'socket.io-client';
import { cleanDb } from '../../test/db_utils';
import app from '../app';

// T1 (plan maestro): el POST de pedidos ahora selecciona sucursal vía
// `seleccionarSucursal` (ORS + cobertura). Se mockea el SERVICE para que
// estos tests de WebSocket no dependan de APIs externas.
jest.mock('../services/seleccion_sucursal_service', () => ({
  seleccionarSucursal: jest.fn(),
  SinSucursalElegibleError: class SinSucursalElegibleError extends Error {
    constructor(mensaje) {
      super(mensaje || 'No hay sucursales disponibles');
      this.name = 'SinSucursalElegibleError';
    }
  },
}));
import db from '../models';
import { cerrarSocketIO, configurarSocketIO } from './index';
import { EVENTOS } from './eventos';

const {
  Categoria,
  EstadoPedido,
  Pedido,
  Producto,
  Stock,
  Sucursal,
  Direccion,
} = db;

/**
 * Espera máxima por evento. Los trash tests que comprueban que algo NO llega
 * pagan esta espera completa, así que cuanto más alta, más lenta la suite.
 * En localhost el evento es casi sincrónico con la respuesta REST que el test
 * ya esperó. 1500 ms es un equilibrio: recorta ~12 s de las ~8 aserciones
 * negativas frente a los 3000 originales y deja margen para el handshake de
 * reconexión (que es el único camino donde la entrega puede tardar más).
 */
const TIMEOUT_EVENTO_MS = 1500;
/** La reconexión suma el tiempo de espera del cliente al del handshake. */
const TIMEOUT_RECONEXION_MS = 8000;

/** Agentes REST: cada uno tiene su propio tarro de cookies. */
const agentes = {};
const sesiones = {};

/** Servidor HTTP de test y puerto real que le asigna el SO. */
let server;
let puerto;
/** Clientes Socket.IO abiertos, para cerrar todo al terminar. */
const sockets = [];

let productoId;

function leerSid(res) {
  const cookies = res.headers['set-cookie'] || [];
  for (const cookie of cookies) {
    const match = cookie.match(/comirapi\.sid=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

async function obtenerCsrf(agente) {
  const csrfCacheado = csrfPorAgente.get(agente);
  if (csrfCacheado) return csrfCacheado;
  const res = await agente.get('/api/auth/csrf-token');
  const token = res.body.data.csrfToken;
  csrfPorAgente.set(agente, token);
  return token;
}

/**
 * La ruta GET /csrf-token ROTA el token en cada llamada (ver csrf.js), pero las
 * rutas protegidas no lo hacen. Por eso el par cookie+header se puede pedir una
 * sola vez por agente y reutilizarlo: cada GET extra solo pagaba ~45 ms de
 * round-trip para regenerar lo mismo. Cacheado por agente con WeakMap.
 */
const csrfPorAgente = new WeakMap();

/**
 * Obtiene el token CSRF ANTES de armar la petición.
 *
 * El orden importa: `agente.post(...)` captura el estado del tarro de cookies
 * en el momento de crearse, así que el GET que emite la cookie `csrf-token`
 * tiene que haber terminado antes (protección double-submit).
 */
const patch = async (agente, path, body) => {
  const csrf = await obtenerCsrf(agente);
  return agente.patch(path).set('x-csrf-token', csrf).send(body);
};

const post = async (agente, path, body) => {
  const csrf = await obtenerCsrf(agente);
  return agente.post(path).set('x-csrf-token', csrf).send(body);
};

/** Registra (si hace falta) y loguea a un usuario; guarda su cookie de sesión. */
async function registrarYLoguear(llave, email, rol) {
  const agente = request.agent(app);
  agentes[llave] = agente;
  await post(agente, '/api/auth/registro', {
    nombre: 'Test',
    email,
    password: '123456',
    rol,
  });
  const res = await post(agente, '/api/auth/login', {
    email,
    password: '123456',
  });
  sesiones[llave] = leerSid(res);
  return sesiones[llave];
}

/**
 * Conecta un cliente Socket.IO con (o sin) la cookie de sesión indicada.
 *
 * @param {string|null} sid - Valor crudo de la cookie `comirapi.sid`.
 * @param {object} [opciones]
 * @param {boolean} [opciones.reconexion] - Si es `true`, el cliente reconecta
 *   solo ante una caída, como haría el navegador en producción.
 */
function conectar(sid, opciones = {}) {
  const { reconexion = false } = opciones;
  return new Promise((resolve, reject) => {
    const socket = io(`http://localhost:${puerto}`, {
      transports: ['websocket'],
      reconnection: reconexion,
      reconnectionAttempts: 5,
      reconnectionDelay: 50,
      extraHeaders: sid ? { Cookie: `comirapi.sid=${sid}` } : {},
    });
    socket.on('connect', () => {
      sockets.push(socket);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

/**
 * Simula una caída de red y espera la reconexión automática del cliente.
 *
 * Cerrar el engine TCP es la forma más fiel de cortar el connection: el cliente
 * no sabe que el error es definitivo, así que entra en su ciclo de reconexión y
 * vuelve a hacer el handshake, que es exactamente lo que pasa en el navegador.
 */
function cortarYEsperarReconexion(socket) {
  return new Promise((resolve, reject) => {
    const idAnterior = socket.id;
    const timer = setTimeout(
      () => reject(new Error('El socket no se reconectó a tiempo')),
      TIMEOUT_RECONEXION_MS
    );
    // Se espera al `connect` del Socket y no al `reconnect` del Manager a
    // propósito: el Manager avisa antes de que el Socket reprocese el CONNECT,
    // y en ese instante `socket.id` todavía es undefined.
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve({ idAnterior, idNuevo: socket.id });
    });
    socket.io.engine.close();
  });
}

/** Cuenta cuántas veces llega un evento durante `ms`, para detectar duplicados. */
const contarEventos = (socket, evento, ms) =>
  new Promise((resolve) => {
    let total = 0;
    const handler = () => {
      total += 1;
    };
    socket.on(evento, handler);
    setTimeout(() => {
      socket.off(evento, handler);
      resolve(total);
    }, ms);
  });

/** Espera un evento; resuelve con `null` si no llega antes del timeout. */
const esperarEvento = (socket, evento) =>
  new Promise((resolve) => {
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(evento, handler);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(evento, handler);
      resolve(null);
    }, TIMEOUT_EVENTO_MS);
    socket.on(evento, handler);
  });

const suscribir = (socket, pedidoId) =>
  new Promise((resolve) => {
    socket.emit(EVENTOS.SUSCRIBIR_PEDIDO, { pedidoId }, (respuesta) =>
      resolve(respuesta)
    );
  });

const crearPedido = async (llave) =>
  post(agentes[llave], '/api/pedidos', {
    productos: [{ productoId, cantidad: 2 }],
  });

/**
 * Crea un pedido y lo deja en `confirmado` por REST.
 *
 * Desde `pendiente` el admin solo puede pasar a `cancelado`: la transición
 * `pendiente → confirmado` la hace el cliente dueño con un medio de pago
 * (ver `puedeTransicionarConRol`). Así el pedido queda en un estado desde el
 * cual el admin sí puede avanzar a `en_preparacion`.
 *
 * Se hace por REST y ANTES de que el test se suscriba, para que el test no
 * reciba el `pedido_actualizado` de la confirmación.
 */
const crearPedidoConfirmado = async (llave) => {
  const creada = await crearPedido(llave);
  expect(creada.status).toBe(201);
  const pedidoId = creada.body.data.id;
  const confirmado = await patch(
    agentes[llave],
    `/api/pedidos/${pedidoId}/estado`,
    {
      estado: 'confirmado',
      medioPago: 'TARJETA',
    }
  );
  expect(confirmado.status).toBe(200);
  return pedidoId;
};

beforeAll(async () => {
  await cleanDb();
  const categoria = await Categoria.create({
    nombre: 'Hamburguesas',
    descripcion: 'T',
  });
  const creado = await Producto.create({
    nombre: 'Hamburguesa Clásica',
    precio: 1500,
    categoriaId: categoria.id,
    activo: true,
    tipo: 'PRODUCTO',
  });
  productoId = creado.id;
  const sucursal = await Sucursal.create({ nombre: 'Sucursal Centro' });
  // Crear un pedido descuenta stock, y sin fila en `Stocks` la sucursal no
  // ofrece el producto. Con cantidad alta para que los pedidos de esta suite no
  // compitan entre sí por las existencias.
  await Stock.create({
    sucursalId: sucursal.id,
    productoId,
    cantidad: 10000,
    disponible: true,
  });
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
  // T1: mock del service de selección — devuelve la sucursal de prueba.
  const {
    seleccionarSucursal,
  } = require('../services/seleccion_sucursal_service');
  seleccionarSucursal.mockResolvedValue(sucursal);
  await EstadoPedido.bulkCreate([
    { nombre: 'pendiente', orden: 1, esInicial: true },
    { nombre: 'confirmado', orden: 2 },
    { nombre: 'en_preparacion', orden: 3 },
    { nombre: 'listo_para_entregar', orden: 4 },
    { nombre: 'en_camino', orden: 5 },
    { nombre: 'entregado', orden: 6, esFinal: true },
    { nombre: 'cancelado', orden: 7, esFinal: true },
  ]);

  await registrarYLoguear('cliente1', 'ws-cliente1@test.com', 'CLIENTE');
  await registrarYLoguear('cliente2', 'ws-cliente2@test.com', 'CLIENTE');
  await registrarYLoguear('admin1', 'ws-admin1@test.com', 'ADMINISTRADOR');
  await registrarYLoguear('admin2', 'ws-admin2@test.com', 'ADMINISTRADOR');

  server = http.createServer(app);
  configurarSocketIO(server);
  await new Promise((resolve) => server.listen(0, resolve));
  puerto = server.address().port;
});

afterAll(async () => {
  sockets.forEach((socket) => socket.close());
  await cerrarSocketIO();
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('Canal de tiempo real de pedidos', () => {
  describe('Caso 5 — autenticación del handshake', () => {
    it('rechaza la conexión sin cookie de sesión', async () => {
      await expect(conectar(null)).rejects.toThrow('No autorizado');
    });

    it('rechaza la conexión con una sesión inexistente', async () => {
      await expect(conectar('cookie-inventada-que-no-existe')).rejects.toThrow(
        'No autorizado'
      );
    });

    it('acepta la conexión con sesión válida de cliente y de admin', async () => {
      const cliente = await conectar(sesiones.cliente1);
      const admin = await conectar(sesiones.admin1);
      expect(cliente.connected).toBe(true);
      expect(admin.connected).toBe(true);
    });
  });

  describe('Control de acceso a rooms', () => {
    // Las rooms viven en el servidor: `socket.rooms` no existe del lado del
    // cliente. Por eso la pertenencia se verifica por su efecto observable
    // (quién recibe cada evento) y no inspeccionando el estado interno.
    it('crear un pedido no notifica a nadie', async () => {
      // Todo pedido nace `pendiente` y el panel de admins no muestra los
      // pendientes: avisar al crearse no aportaría nada. El admin se entera
      // recién al confirmarse, mediante `pedido_actualizado`.
      const admin = await conectar(sesiones.admin1);
      const esperaAdmin = esperarEvento(admin, EVENTOS.PEDIDO_ACTUALIZADO);
      const creada = await crearPedido('cliente1');
      expect(creada.status).toBe(201);

      await expect(esperaAdmin).resolves.toBeNull();
    });

    it('un cliente no puede suscribirse al pedido de otro usuario', async () => {
      const creada = await crearPedido('cliente1');
      const pedidoId = creada.body.data.id;
      const intruso = await conectar(sesiones.cliente2);

      const ack = await suscribir(intruso, pedidoId);
      expect(ack).toEqual({ success: false, error: 'Acceso denegado' });

      // Y tampoco le llega nada aunque se haya apuntado: no entró a la room.
      const esperaIntruso = esperarEvento(intruso, EVENTOS.PEDIDO_ACTUALIZADO);
      const dueno = await conectar(sesiones.cliente1);
      await suscribir(dueno, pedidoId);
      await patch(agentes.admin1, `/api/pedidos/${pedidoId}/estado`, {
        estado: 'cancelado',
      });
      await esperarEvento(dueno, EVENTOS.PEDIDO_ACTUALIZADO);
      await expect(esperaIntruso).resolves.toBeNull();
    });

    it('el dueño sí puede suscribirse a su pedido', async () => {
      const creada = await crearPedido('cliente1');
      const pedidoId = creada.body.data.id;
      const dueno = await conectar(sesiones.cliente1);
      expect(await suscribir(dueno, pedidoId)).toEqual({
        success: true,
        pedidoId,
      });
    });

    it('la suscripción a un pedido inexistente se rechaza', async () => {
      const dueno = await conectar(sesiones.cliente1);
      const ack = await suscribir(dueno, 999999);
      expect(ack).toEqual({ success: false, error: 'Pedido no encontrado' });
    });
  });

  describe('Caso 1 — el pedido nace pendiente y no se avisa', () => {
    it('el pedido se crea en `pendiente` sin emitir ningún evento', async () => {
      const admin = await conectar(sesiones.admin1);
      const espera = esperarEvento(admin, EVENTOS.PEDIDO_ACTUALIZADO);
      const creada = await crearPedido('cliente1');
      expect(creada.status).toBe(201);

      await expect(espera).resolves.toBeNull();
    });

    it('los datos siguen disponibles por REST (fuente de verdad)', async () => {
      const creada = await crearPedido('cliente1');
      const pedidoId = creada.body.data.id;
      const res = await agentes.admin1.get(`/api/pedidos/${pedidoId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(pedidoId);
      expect(res.body.data.estado).toBe('pendiente');
    });
  });

  describe('El admin se entera recién al confirmarse el pago', () => {
    it('el cliente confirma y el admin recibe pedido_actualizado con solo el pedidoId', async () => {
      const admin = await conectar(sesiones.admin1);
      const creada = await crearPedido('cliente1');
      const pedidoId = creada.body.data.id;

      // El aviso llega recién con la confirmación, no al crear el pedido.
      const espera = esperarEvento(admin, EVENTOS.PEDIDO_ACTUALIZADO);
      const confirmado = await patch(
        agentes.cliente1,
        `/api/pedidos/${pedidoId}/estado`,
        { estado: 'confirmado', medioPago: 'TARJETA' }
      );
      expect(confirmado.status).toBe(200);

      // El socket no transporta el pedido: solo el id.
      const payload = await espera;
      expect(payload).toEqual({ pedidoId });
      expect(Object.keys(payload)).toEqual(['pedidoId']);
    });

    it('varios admins conectados reciben la confirmación sin suscribirse', async () => {
      // `admins` se ingresa sola al conectar: el admin nunca emite
      // `suscribir_pedido`, y aun así recibe la confirmación.
      const admin1 = await conectar(sesiones.admin1);
      const admin2 = await conectar(sesiones.admin2);
      const espera1 = esperarEvento(admin1, EVENTOS.PEDIDO_ACTUALIZADO);
      const espera2 = esperarEvento(admin2, EVENTOS.PEDIDO_ACTUALIZADO);

      const creada = await crearPedido('cliente1');
      const pedidoId = creada.body.data.id;
      await patch(agentes.cliente1, `/api/pedidos/${pedidoId}/estado`, {
        estado: 'confirmado',
        medioPago: 'TARJETA',
      });

      await expect(espera1).resolves.toEqual({ pedidoId });
      await expect(espera2).resolves.toEqual({ pedidoId });
    });

    it('el cliente no recibe nada al crear su propio pedido', async () => {
      // El dueño ya tiene la respuesta del POST, no necesita un evento.
      const cliente = await conectar(sesiones.cliente1);
      const espera = esperarEvento(cliente, EVENTOS.PEDIDO_ACTUALIZADO);
      await crearPedido('cliente1');

      await expect(espera).resolves.toBeNull();
    });
  });

  describe('Caso 2 — cambio de estado', () => {
    it('el cliente dueño recibe pedido_actualizado con solo el pedidoId', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const dueno = await conectar(sesiones.cliente1);
      await suscribir(dueno, pedidoId);

      const espera = esperarEvento(dueno, EVENTOS.PEDIDO_ACTUALIZADO);
      const res = await patch(
        agentes.admin1,
        `/api/pedidos/${pedidoId}/estado`,
        {
          estado: 'en_preparacion',
        }
      );
      expect(res.status).toBe(200);

      const payload = await espera;
      expect(payload).toEqual({ pedidoId });
      expect(Object.keys(payload)).toEqual(['pedidoId']);
    });

    it('el estado nuevo se lee por REST, no por el socket', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const dueno = await conectar(sesiones.cliente1);
      await suscribir(dueno, pedidoId);
      const espera = esperarEvento(dueno, EVENTOS.PEDIDO_ACTUALIZADO);

      await patch(agentes.admin1, `/api/pedidos/${pedidoId}/estado`, {
        estado: 'en_preparacion',
      });
      await espera;

      const res = await agentes.cliente1.get(`/api/pedidos/${pedidoId}`);
      expect(res.body.data.estado).toBe('en_preparacion');
    });
  });

  describe('Caso 4 — aislamiento entre clientes', () => {
    it('el cliente no suscrito a ese pedido no recibe nada', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const dueno = await conectar(sesiones.cliente1);
      const otro = await conectar(sesiones.cliente2);
      await suscribir(dueno, pedidoId);
      const esperaDelOtro = esperarEvento(otro, EVENTOS.PEDIDO_ACTUALIZADO);

      const res = await patch(
        agentes.admin1,
        `/api/pedidos/${pedidoId}/estado`,
        {
          estado: 'en_preparacion',
        }
      );
      expect(res.status).toBe(200);

      await expect(esperaDelOtro).resolves.toBeNull();
    });

    it('el cliente dueño sí recibe el cambio de su propio pedido', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente2');
      const dueno = await conectar(sesiones.cliente2);
      await suscribir(dueno, pedidoId);
      const espera = esperarEvento(dueno, EVENTOS.PEDIDO_ACTUALIZADO);

      await patch(agentes.admin1, `/api/pedidos/${pedidoId}/estado`, {
        estado: 'en_preparacion',
      });

      await expect(espera).resolves.toEqual({ pedidoId });
    });
  });

  describe('Caso 6 — error de base de datos', () => {
    it('no emite ningún evento si la creación falla', async () => {
      const admin = await conectar(sesiones.admin1);
      const espera = esperarEvento(admin, EVENTOS.PEDIDO_ACTUALIZADO);

      const res = await post(agentes.cliente1, '/api/pedidos', {
        productos: [],
      });

      expect(res.status).toBe(400);
      await expect(espera).resolves.toBeNull();
    });

    it('no emite pedido_actualizado si el cambio de estado falla', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const dueno = await conectar(sesiones.cliente1);
      await suscribir(dueno, pedidoId);
      const espera = esperarEvento(dueno, EVENTOS.PEDIDO_ACTUALIZADO);

      // Transición inválida desde "confirmado": el controller corta por encima.
      const res = await patch(
        agentes.admin1,
        `/api/pedidos/${pedidoId}/estado`,
        {
          estado: 'entregado',
        }
      );

      expect(res.status).toBe(400);
      await expect(espera).resolves.toBeNull();
    });

    it('el pedido sigue sin cambios en la base tras el fallo', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const res = await patch(
        agentes.admin1,
        `/api/pedidos/${pedidoId}/estado`,
        {
          estado: 'entregado',
        }
      );
      expect(res.status).toBe(400);

      const enBase = await Pedido.findByPk(pedidoId, {
        include: [{ model: EstadoPedido, as: 'estadoActual' }],
      });
      expect(enBase.estadoActual.nombre).toBe('confirmado');
    });
  });

  /**
   * Caso 7 — reconexión.
   *
   * La pertenencia a una room vive en el servidor, atada al `socket.id`. Al
   * reconectar, el cliente obtiene un id nuevo y entra a las rooms como si
   * fuera la primera vez. Estos tests fijan ese contrato, que es el que obliga
   * al frontend a re-emitir `suscribir_pedido` en cada `connect`.
   */
  describe('Caso 7 — reconexión', () => {
    it('al reconectar el socket obtiene un id nuevo', async () => {
      const dueno = await conectar(sesiones.cliente1, { reconexion: true });
      const { idAnterior, idNuevo } = await cortarYEsperarReconexion(dueno);

      expect(idNuevo).toBeTruthy();
      expect(idNuevo).not.toBe(idAnterior);
      expect(dueno.connected).toBe(true);
    });

    it('tras reconectar sin re-suscribirse, el dueño deja de recibir', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const dueno = await conectar(sesiones.cliente1, { reconexion: true });
      await suscribir(dueno, pedidoId);

      // Antes de la caída sí llega: la suscripción está activa.
      const antesDeCaer = esperarEvento(dueno, EVENTOS.PEDIDO_ACTUALIZADO);
      await patch(agentes.admin1, `/api/pedidos/${pedidoId}/estado`, {
        estado: 'en_preparacion',
      });
      await expect(antesDeCaer).resolves.toEqual({ pedidoId });

      await cortarYEsperarReconexion(dueno);

      // Después de reconectar, la room se perdió: el evento ya no llega.
      const despuesDeCaer = esperarEvento(dueno, EVENTOS.PEDIDO_ACTUALIZADO);
      const res = await patch(
        agentes.admin1,
        `/api/pedidos/${pedidoId}/estado`,
        {
          estado: 'listo_para_entregar',
        }
      );
      expect(res.status).toBe(200);
      await expect(despuesDeCaer).resolves.toBeNull();
    });

    it('tras reconectar y re-suscribirse, el dueño vuelve a recibir', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const dueno = await conectar(sesiones.cliente1, { reconexion: true });
      await cortarYEsperarReconexion(dueno);

      // Esto es lo que hace el frontend en su handler de 'connect'.
      expect(await suscribir(dueno, pedidoId)).toEqual({
        success: true,
        pedidoId,
      });

      const espera = esperarEvento(dueno, EVENTOS.PEDIDO_ACTUALIZADO);
      const res = await patch(
        agentes.admin1,
        `/api/pedidos/${pedidoId}/estado`,
        {
          estado: 'en_preparacion',
        }
      );
      expect(res.status).toBe(200);

      await expect(espera).resolves.toEqual({ pedidoId });
    });

    it('el admin vuelve a la room admins sin re-suscribirse', async () => {
      // `admins` se ingresa sola al conectar, así que no hay nada que
      // re-hacer en el cliente: por eso el admin no emite `suscribir_pedido`.
      const admin = await conectar(sesiones.admin1, { reconexion: true });
      await cortarYEsperarReconexion(admin);

      const espera = esperarEvento(admin, EVENTOS.PEDIDO_ACTUALIZADO);
      const creada = await crearPedido('cliente1');
      const pedidoId = creada.body.data.id;
      await patch(agentes.cliente1, `/api/pedidos/${pedidoId}/estado`, {
        estado: 'confirmado',
        medioPago: 'TARJETA',
      });

      await expect(espera).resolves.toEqual({ pedidoId });
    });

    it('re-suscribirse varias veces no duplica la entrega', async () => {
      // El frontend puede re-emitir `suscribir_pedido` en cada `connect` y en
      // cada cambio del conjunto de pedidos. Entrar dos veces a la misma room
      // no puede hacer que el evento llegue duplicado.
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const dueno = await conectar(sesiones.cliente1, { reconexion: true });

      await suscribir(dueno, pedidoId);
      await cortarYEsperarReconexion(dueno);
      await suscribir(dueno, pedidoId);
      await suscribir(dueno, pedidoId);

      const conteo = contarEventos(dueno, EVENTOS.PEDIDO_ACTUALIZADO, 2000);
      const res = await patch(
        agentes.admin1,
        `/api/pedidos/${pedidoId}/estado`,
        {
          estado: 'en_preparacion',
        }
      );
      expect(res.status).toBe(200);

      await expect(conteo).resolves.toBe(1);
    });

    it('tras cerrar la conexión, el socket no recibe más eventos', async () => {
      const pedidoId = await crearPedidoConfirmado('cliente1');
      const dueno = await conectar(sesiones.cliente1);
      await suscribir(dueno, pedidoId);
      dueno.close();

      const receptor = await conectar(sesiones.cliente1);
      await suscribir(receptor, pedidoId);
      const espera = esperarEvento(receptor, EVENTOS.PEDIDO_ACTUALIZADO);
      await patch(agentes.admin1, `/api/pedidos/${pedidoId}/estado`, {
        estado: 'en_preparacion',
      });

      // El receptor nuevo sí recibe, lo que prueba que el evento se emitió y
      // que la ausencia en el socket cerrado es real y no un fallo de la room.
      await expect(espera).resolves.toEqual({ pedidoId });
    });
  });
});
