/**
 * Utilidades para la verificación end-to-end del canal de tiempo real.
 *
 * A diferencia de `lib/realtime/conexion.test.js` (que levanta su propio
 * servidor en un puerto efímero), esto habla contra el backend de desarrollo
 * tal como lo ve un navegador: cookie de sesión real, CSRF real y sockets
 * reales. Por eso los servidores tienen que estar levantados.
 *
 * Uso: `npm run test:tiempo-real`
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { io } = require('socket.io-client');

const BASE = process.env.WS_TEST_API || 'http://localhost:3000';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf-token';
const COOKIE_SESION = 'comirapi.sid';

/**
 * Emails fijos: si el usuario ya existe, se reutiliza iniciando sesión.
 * `cliente2` existe para poder probar el aislamiento entre dos clientes de
 * verdad: con dos sockets del mismo usuario la autorización no se ejercita.
 */
const USUARIOS = {
  admin: { email: 'ws-e2e-admin@test.com', rol: 'ADMINISTRADOR' },
  cliente: { email: 'ws-e2e-cliente@test.com', rol: 'CLIENTE' },
  cliente2: { email: 'ws-e2e-cliente2@test.com', rol: 'CLIENTE' },
};

/**
 * Las sesiones se cachean en un archivo (ignorado por git) porque el
 * rate limiter de auth permite 20 requests cada 15 minutos: registrar y
 * loguear usuarios en cada corrida lo vuelve a disparar enseguida.
 */
const ARCHIVO_SESIONES = path.join(__dirname, '.sesiones.json');

/**
 * Dirección de los usuarios de prueba.
 *
 * `POST /api/direcciones` solo lo acepta un CLIENTE, así que el admin de prueba
 * no tiene (ni puede tener) una. Es idempotente: si el usuario ya tiene
 * direcciones de corridas anteriores, se reutiliza la primera.
 */
const DIRECCION = {
  calle: 'Av. Corrientes',
  altura: 1234,
  provincia: 'Buenos Aires',
  localidad: 'CABA',
  codigoPostal: 'C1043',
  referencia: 'Puerta 2, timbre 3',
  alias: 'Casa',
};

const leerCache = () => {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_SESIONES, 'utf8'));
  } catch {
    return {};
  }
};

const guardarCache = (cache) => {
  fs.writeFileSync(ARCHIVO_SESIONES, JSON.stringify(cache, null, 2));
};

/**
 * Cliente REST con tarro de cookies propio.
 *
 * El CSRF del backend es double-submit: el header tiene que coincidir con la
 * cookie vigente, así que el token se relee de cada `Set-Cookie` antes de
 * armar la siguiente petición.
 */
const crearClienteREST = (cookieInicial = {}) => {
  const tarro = { ...cookieInicial };
  const cabeceraCookie = () =>
    Object.entries(tarro)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  const pedir = async (metodo, ruta, cuerpo) => {
    const headers = {
      'Content-Type': 'application/json',
      Cookie: cabeceraCookie(),
    };
    if (tarro[CSRF_COOKIE]) headers[CSRF_HEADER] = tarro[CSRF_COOKIE];

    const res = await fetch(BASE + ruta, {
      method: metodo,
      headers,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });

    for (const cookie of res.headers.getSetCookie()) {
      const match = cookie.match(/^([^=]+)=([^;]*)/);
      if (match) tarro[match[1]] = match[2];
    }
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  return {
    pedir,
    get: (ruta) => pedir('GET', ruta),
    post: (ruta, cuerpo) => pedir('POST', ruta, cuerpo),
    patch: (ruta, cuerpo) => pedir('PATCH', ruta, cuerpo),
    /** Valor de la cookie de sesión, ya firmado por el servidor. */
    get sid() {
      return tarro[COOKIE_SESION] || null;
    },
  };
};

/** Devuelve el cliente REST del rol indicado, con una sesión válida. */
const sesionDe = async (rol) => {
  const cache = leerCache();
  if (cache[rol]?.sid) {
    const cliente = crearClienteREST({
      [COOKIE_SESION]: cache[rol].sid,
      [CSRF_COOKIE]: crypto.randomBytes(32).toString('hex'),
    });
    // La sesión puede haber vencido: se comprueba antes de confiar en la cache.
    const prueba = await cliente.get('/api/productos');
    if (prueba.status === 200) return cliente;
  }

  const { email, rol: rolUsuario } = USUARIOS[rol];
  const cliente = crearClienteREST({
    [CSRF_COOKIE]: crypto.randomBytes(32).toString('hex'),
  });

  const registro = await cliente.post('/api/auth/registro', {
    nombre: 'Verificacion WS',
    email,
    password: '123456',
    rol: rolUsuario,
  });

  // El registro ya deja sesión iniciada. Si el usuario existía de una corrida
  // anterior, hay que iniciar sesión explícitamente.
  if (!cliente.sid) {
    const login = await cliente.post('/api/auth/login', {
      email,
      password: '123456',
    });
    if (!cliente.sid) {
      const detalle =
        registro.status === 429 || login.status === 429
          ? 'Se trippedó el rate limiter de auth (20 req / 15 min). Esperá ' +
            'unos minutos o borrá test/tiempo-real/.sesiones.json.'
          : `registro ${registro.status} / login ${login.status}`;
      throw new Error(`No se pudo obtener una sesión de ${rol}: ${detalle}`);
    }
  }

  const guardado = { ...cache, [rol]: { sid: cliente.sid, email } };
  guardarCache(guardado);
  return cliente;
};

/**
 * Devuelve la dirección guardada del cliente, creándola si no tiene ninguna.
 *
 * El usuario de prueba existe para poder crear pedidos como lo haría la app, y
 * el pedido guarda un snapshot de la dirección de entrega.
 *
 * La entidad `Direccion` tiene `provincia`/`localidad` y el snapshot
 * `Pedido.direccionEntrega` tiene `ciudad`: el mapeo entre ambos lo hace
 * `payloadBackend` en el frontend, y los tests lo replican al armar el pedido.
 */
const asegurarDireccion = async (cliente) => {
  const existentes = await cliente.get('/api/direcciones');
  if (existentes.status === 200 && Array.isArray(existentes.body.data)) {
    if (existentes.body.data.length > 0) return existentes.body.data[0];
  }

  const creada = await cliente.post('/api/direcciones', DIRECCION);
  if (creada.status !== 201) {
    throw new Error(
      `No se pudo crear la dirección del usuario de prueba: HTTP ${creada.status}`
    );
  }
  return creada.body.data;
};

/** Conecta un socket con la misma cookie de sesión que usa la API REST. */ const conectar = (
  sid,
  opciones = {}
) =>
  new Promise((resolve, reject) => {
    const socket = io(BASE, {
      transports: ['websocket'],
      reconnection: opciones.reconexion === true,
      reconnectionAttempts: 5,
      reconnectionDelay: 50,
      extraHeaders: sid ? { Cookie: `${COOKIE_SESION}=${sid}` } : {},
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });

/** Espera un evento; resuelve `null` si no llega antes del timeout. */
const esperar = (socket, evento, ms = 4000) =>
  new Promise((resolve) => {
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(evento, handler);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(evento, handler);
      resolve(null);
    }, ms);
    socket.on(evento, handler);
  });

/** Cuenta las entregas de un evento, para detectar duplicados. */
const contar = (socket, evento, ms) =>
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

const suscribir = (socket, pedidoId) =>
  new Promise((resolve) => {
    socket.emit('suscribir_pedido', { pedidoId }, (respuesta) =>
      resolve(respuesta || { success: false, error: 'Sin respuesta' })
    );
  });

/**
 * Simula una caída de red y espera la reconexión.
 *
 * Se cierra el engine TCP en vez de llamar `socket.close()`: si el socket se
 * cerrara desde el cliente no habría reconexión y el test no probaría nada.
 */
const cortarYEsperarReconexion = (socket, ms = 8000) =>
  new Promise((resolve, reject) => {
    const idAnterior = socket.id;
    const timer = setTimeout(
      () => reject(new Error('El socket no se reconectó a tiempo')),
      ms
    );
    // Se espera al `connect` del Socket y no al `reconnect` del Manager: el
    // Manager avisa antes de que el Socket reprocese el CONNECT, y en ese
    // instante `socket.id` todavía es undefined.
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve({ idAnterior, idNuevo: socket.id });
    });
    socket.io.engine.close();
  });

/**
 * Borra los pedidos que dejó esta corrida.
 *
 * Los tests hablan con la API como un navegador, así que no pueden borrar lo que
 * crean (no hay `DELETE /api/pedidos`) y el listado del admin los muestra todos.
 * Por eso se delega a un script que sí accede a la base.
 *
 * Se puede desactivar con `WS_TEST_LIMPIAR=0`, útil para depurar una corrida
 * fallida sin perder los datos.
 */
const limpiarPedidosDePrueba = () => {
  if (process.env.WS_TEST_LIMPIAR === '0') {
    console.log('\n(Limpieza desactivada con WS_TEST_LIMPIAR=0)');
    return;
  }
  const script = path.join(
    __dirname,
    '..',
    '..',
    'scripts',
    'limpiar-pedidos-de-prueba.js'
  );
  try {
    const salida = execFileSync(process.execPath, [script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(salida.trim());
  } catch (error) {
    // No debe tumbar la corrida: los checks ya seCorrieron.
    console.log(`\n(No se pudo limpiar: ${error.message})`);
  }
};

/** Reporter mínimo con conteo de fallas y salida con código 1 si hubo alguna. */
const crearReporte = (titulo) => {
  let fallas = 0;
  console.log(`\n${titulo}`);
  console.log('='.repeat(titulo.length));
  return {
    check(nombre, condicion, razon) {
      if (condicion) {
        console.log(`  OK     ${nombre}`);
      } else {
        console.log(`  FALLA  ${nombre}${razon ? ` -> ${razon}` : ''}`);
        fallas += 1;
      }
    },
    seccion(nombre) {
      console.log(`\n${nombre}`);
    },
    resumen() {
      console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`}`);
      return fallas;
    },
  };
};

module.exports = {
  BASE,
  COOKIE_SESION,
  DIRECCION,
  USUARIOS,
  asegurarDireccion,
  conectar,
  contar,
  cortarYEsperarReconexion,
  crearClienteREST,
  crearReporte,
  esperar,
  limpiarPedidosDePrueba,
  sesionDe,
  suscribir,
};
