'use strict';

// Clientes demo que compran en volumen + reseñas de todo el catálogo.
//
// Objetivo doble:
//   1. Dar volumen real a las estadísticas del admin (reportes de los últimos
//      30 días) y del superadmin (totales históricos + serie de 30 días).
//   2. Dejar 3 reseñas por producto (una de cada cliente) para que la ficha de
//      producto no arranque vacía.
//
// Los clientes se llaman exactamente Elmesia, Tetia y Cassie (sin apellido: la
// lista de clientes muestra `nombre + apellido`, así que un apellido inventado
// las mostraría como "Elmesia Demo"). Usan `@demo.com` y no `@test.com` a
// propósito: `scripts/limpiar-pedidos-de-prueba.js` borra los pedidos de
// cualquier `@test.com` y se llevaría puesto este volumen.
//
// Pedidos: 12 por cliente (36), repartidos en los últimos 10 días para que
// entren en el rango por defecto de los reportes (30 días) y muevan la serie
// diaria. Todos `entregado` salvo 2 `cancelado` (5,5 %), como pidió el
// enunciado de la demo. Cada pedido lleva 5 productos distintos con 1-3
// unidades, así que además del total mueve el ranking de más vendidos.
//
// Reseñas: 3 por producto (una por cliente), sobre un pedido entregado real de
// ese cliente que contenga el producto. No se reseña cada compra: cada cliente
// deja UNA reseña por producto, que es lo que permite el modelo.
//
// Idempotente: borra las reseñas de los 3 clientes y los pedidos con
// observacion = 'SEED-RESENA' antes de recrearlos. Los usuarios se reutilizan
// por email (upsert), así los ids no cambian entre corridas.

const argon2 = require('argon2');

const MARCA = 'SEED-RESENA';
const MIN = 60 * 1000;
const DIA = 24 * 60 * MIN;

const PEDIDOS_POR_CLIENTE = 12;
const DIAS_VENTANA = 10;
const PRODUCTOS_POR_PEDIDO = 5;

/** Pares cliente-pedido que salen cancelados (índice de cliente - índice de pedido). */
const CANCELADOS = new Set(['0-5', '2-8']);

const CLIENTES = [
  {
    nombre: 'Elmesia',
    apellido: null,
    email: 'elmesia@demo.com',
    telefono: '11-5555-1001',
  },
  {
    nombre: 'Tetia',
    apellido: null,
    email: 'tetia@demo.com',
    telefono: '11-5555-1002',
  },
  {
    nombre: 'Cassie',
    apellido: null,
    email: 'cassie@demo.com',
    telefono: '11-5555-1003',
  },
];

/**
 * Direcciones de entrega de los pedidos demo, una por sucursal.
 *
 * Son snapshots (columnas sueltas en `Pedidos`), no filas de `Direcciones`: no
 * hace falta geocodificarlas porque el seeder no pasa por el checkout. Están
 * cerca de cada sucursal para que los pedidos sean coherentes si alguien los
 * abre en el detalle.
 */
const DIRECCIONES = {
  'Sucursal Oeste': {
    calle: 'Av. Rivadavia',
    altura: 22000,
    ciudad: 'Morón',
    codigoPostal: '1708',
    referencia: 'Pedido de demostración',
    latitud: -34.6534,
    longitud: -58.619,
  },
  'Sucursal Palermo': {
    calle: 'Av. Santa Fe',
    altura: 3700,
    ciudad: 'Palermo',
    codigoPostal: '1425',
    referencia: 'Pedido de demostración',
    latitud: -34.5885,
    longitud: -58.41,
  },
  'Sucursal Vergara': {
    calle: 'Av. Vergara',
    altura: 2500,
    ciudad: 'Hurlingham',
    codigoPostal: '1688',
    referencia: 'Pedido de demostración',
    latitud: -34.63,
    longitud: -58.64,
  },
};

const DIRECCION_GENERICA = {
  calle: 'Av. Santa Fe',
  altura: 3253,
  ciudad: 'Palermo',
  codigoPostal: '1425',
  referencia: 'Pedido de demostración',
  latitud: -34.5885,
  longitud: -58.41,
};

/**
 * Comentarios por categoría. Cada producto recibe uno distinto según el
 * cliente, para que las 3 reseñas no sean el mismo texto copiado.
 */
const COMENTARIOS = {
  Hamburguesas: [
    'La carne estaba jugosa y en su punto. Muy completa.',
    'Muy rica, aunque la esperaba un poco más grande.',
    'Se nota que usan carne fresca. La volvería a pedir.',
  ],
  Pizzas: [
    'La masa quedó crocante y el queso abundante.',
    'Rica, pero le faltaba un poco de sal.',
    'Ideal para compartir. Muy recomendable.',
  ],
  Combos: [
    'Rinde bien y sale más barato que pedir todo suelto.',
    'Las papas llegaron calientes y la bebida bien fría.',
    'Buena opción para una cena completa.',
  ],
  Papas: [
    'Llegaron crocantes, no como otras veces.',
    'La porción es enorme, alcanza para dos.',
    'Muy ricas, aunque un poco aceitosas.',
  ],
  Bebidas: [
    'Llegó bien fría, tal como la pedí.',
    'Todo correcto, sin demoras.',
    'Rica y en el tamaño justo.',
  ],
  Postres: [
    'El centro fundido es lo mejor.',
    'Dulce pero no empalaga.',
    'Porción generosa, ideal para cerrar el pedido.',
  ],
};

const COMENTARIO_GENERICO = [
  'Muy buena experiencia, llegó en tiempo.',
  'Cumplió con lo esperado.',
  'Recomendable, volvería a pedir.',
];

const ESTADOS_ENTREGADO = [
  { nombre: 'pendiente', minutos: 0 },
  { nombre: 'confirmado', minutos: 2 },
  { nombre: 'en_preparacion', minutos: 5 },
  { nombre: 'listo_para_entregar', minutos: 20 },
  { nombre: 'en_camino', minutos: 30 },
  { nombre: 'entregado', minutos: 50 },
];

const ESTADOS_CANCELADO = [
  { nombre: 'pendiente', minutos: 0 },
  { nombre: 'confirmado', minutos: 3 },
  { nombre: 'cancelado', minutos: 12 },
];

const comentarioDe = (categoria, semilla) => {
  const textos = COMENTARIOS[categoria] || COMENTARIO_GENERICO;
  return textos[semilla % textos.length];
};

async function upsertCliente(queryInterface, cliente, password) {
  const [filas] = await queryInterface.sequelize.query(
    `INSERT INTO "Usuarios"
       ("nombre","apellido","email","password","telefono","fechaNacimiento",
        "rol","activo","createdAt","updatedAt")
     VALUES
       (:nombre,:apellido,:email,:password,:telefono,NULL,'CLIENTE',TRUE,NOW(),NOW())
     ON CONFLICT (email) DO UPDATE SET
       "nombre" = EXCLUDED."nombre",
       "apellido" = EXCLUDED."apellido",
       "password" = EXCLUDED."password",
       "telefono" = EXCLUDED."telefono",
       "rol" = 'CLIENTE',
       "activo" = TRUE,
       "updatedAt" = NOW()
     RETURNING id`,
    { replacements: { ...cliente, password } }
  );
  return filas[0].id;
}

async function borrarSeedPrevio(queryInterface, emails) {
  const [
    pedidos,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "Pedidos" WHERE observacion = :marca`,
    { replacements: { marca: MARCA } }
  );
  const ids = pedidos.map((p) => p.id);

  // Las reseñas de los clientes demo se borran siempre (no sólo las de los
  // pedidos marcados): si una corrida anterior reseñó sobre otro pedido, la
  // nueva tiene que reemplazarla sin chocar con el UNIQUE.
  await queryInterface.sequelize.query(
    `DELETE FROM "Resenas"
      WHERE "usuarioId" IN (SELECT id FROM "Usuarios" WHERE email IN (:emails))`,
    { replacements: { emails } }
  );

  if (!ids.length) return;
  const lista = ids.join(',');
  await queryInterface.sequelize.query(
    `DELETE FROM "Resenas" WHERE "pedidoId" IN (${lista})`
  );
  await queryInterface.sequelize.query(
    `DELETE FROM "PedidoPromociones" WHERE "pedidoId" IN (${lista})`
  );
  await queryInterface.sequelize.query(
    `DELETE FROM "PedidoEstadoHistorials" WHERE "pedidoId" IN (${lista})`
  );
  await queryInterface.sequelize.query(
    `DELETE FROM "PedidoItems" WHERE "pedidoId" IN (${lista})`
  );
  await queryInterface.sequelize.query(
    `DELETE FROM "Pedidos" WHERE id IN (${lista})`
  );
}

async function crearPedido(queryInterface, datos) {
  const [filas] = await queryInterface.sequelize.query(
    `INSERT INTO "Pedidos"
       ("usuarioId","sucursalId","fechaHora","estadoId","costoEnvio","total",
        "medioPago","observacion","calle","altura","ciudad","codigoPostal",
        "referencia","latitud","longitud","etaMinutos","etaCalculadoEn",
        "horaEstimadaLlegada","createdAt","updatedAt")
     VALUES
       (:usuarioId,:sucursalId,:fechaHora,:estadoId,:costoEnvio,:total,
        :medioPago,:observacion,:calle,:altura,:ciudad,:codigoPostal,
        :referencia,:latitud,:longitud,NULL,NULL,NULL,:fechaHora,:fechaHora)
     RETURNING id`,
    {
      replacements: {
        usuarioId: datos.usuarioId,
        sucursalId: datos.sucursalId,
        fechaHora: datos.fechaHora,
        estadoId: datos.estadoId,
        costoEnvio: datos.costoEnvio,
        total: datos.total,
        medioPago: datos.medioPago,
        observacion: MARCA,
        calle: datos.direccion.calle,
        altura: datos.direccion.altura,
        ciudad: datos.direccion.ciudad,
        codigoPostal: datos.direccion.codigoPostal,
        referencia: datos.direccion.referencia,
        latitud: datos.direccion.latitud,
        longitud: datos.direccion.longitud,
      },
    }
  );
  return filas[0].id;
}

module.exports = {
  up: async (queryInterface) => {
    const emails = CLIENTES.map((cliente) => cliente.email);

    // Datos que ya tienen que existir (seeders previos).
    const [sucursales] = await queryInterface.sequelize.query(
      `SELECT id, nombre FROM "Sucursales" WHERE activa = TRUE ORDER BY id`
    );
    if (!sucursales.length) {
      throw new Error(
        'Seeder de clientes demo: no hay sucursales activas. Ejecutar los seeders previos.'
      );
    }

    const [estados] = await queryInterface.sequelize.query(
      `SELECT id, nombre FROM "EstadoPedidos" WHERE nombre IN
        ('entregado','cancelado','pendiente','confirmado','en_preparacion',
         'listo_para_entregar','en_camino')`
    );
    const idEstado = new Map(estados.map((e) => [e.nombre, e.id]));
    for (const nombre of [
      'entregado',
      'cancelado',
      'pendiente',
      'confirmado',
      'en_preparacion',
      'listo_para_entregar',
      'en_camino',
    ]) {
      if (!idEstado.has(nombre)) {
        throw new Error(
          `Seeder de clientes demo: falta el estado "${nombre}". Ejecutar 20260915000001.`
        );
      }
    }

    const [productos] = await queryInterface.sequelize.query(
      `SELECT p.id, p.nombre, p.precio, p.tipo, c.nombre AS categoria
         FROM "Productos" p
         JOIN "Categorias" c ON c.id = p."categoriaId"
        WHERE p.activo = TRUE
        ORDER BY p.id`
    );
    if (!productos.length) {
      throw new Error(
        'Seeder de clientes demo: no hay productos activos. Ejecutar los seeders previos.'
      );
    }
    productos.forEach((producto) => {
      producto.precio = Number(producto.precio);
    });

    // Recién con todo resuelto se limpia la corrida anterior.
    await borrarSeedPrevio(queryInterface, emails);

    const password = await argon2.hash('123456', { timeCost: 2 });
    const clientes = [];
    for (const cliente of CLIENTES) {
      const id = await upsertCliente(queryInterface, cliente, password);
      clientes.push({ ...cliente, id });
    }

    const ahora = Date.now();
    // usuarioId -> Map(productoId -> { pedidoId, fechaHora }) de entregados.
    const entregadosPorCliente = new Map();

    for (let c = 0; c < clientes.length; c += 1) {
      const cliente = clientes[c];
      entregadosPorCliente.set(cliente.id, new Map());

      for (let i = 0; i < PEDIDOS_POR_CLIENTE; i += 1) {
        const sucursal = sucursales[(i + c) % sucursales.length];
        const esCancelado = CANCELADOS.has(`${c}-${i}`);
        // 2 a 3,5 horas atrás como mínimo: el historial de un entregado suma
        // 50 minutos y no queremos estados en el futuro.
        const minutosAtras = 120 + ((i * 7) % 90);
        const fechaHora = new Date(
          ahora - ((i + c) % DIAS_VENTANA) * DIA - minutosAtras * MIN
        );

        const cantidadItems = Math.min(PRODUCTOS_POR_PEDIDO, productos.length);
        const inicio = (i * PRODUCTOS_POR_PEDIDO + c * 2) % productos.length;
        const items = [];
        for (let k = 0; k < cantidadItems; k += 1) {
          const producto = productos[(inicio + k) % productos.length];
          const cantidad = 1 + ((i + k) % 3);
          items.push({
            productoId: producto.id,
            nombreProducto: producto.nombre,
            precioUnitario: producto.precio,
            cantidad,
            subtotal: producto.precio * cantidad,
          });
        }

        const costoEnvio = (i + c) % 2 === 0 ? 0 : 500;
        const total =
          items.reduce((acc, item) => acc + item.subtotal, 0) + costoEnvio;

        const pedidoId = await crearPedido(queryInterface, {
          usuarioId: cliente.id,
          sucursalId: sucursal.id,
          fechaHora,
          estadoId: esCancelado
            ? idEstado.get('cancelado')
            : idEstado.get('entregado'),
          costoEnvio,
          total,
          medioPago: (i + c) % 2 === 0 ? 'MERCADO_PAGO' : 'TARJETA',
          direccion: DIRECCIONES[sucursal.nombre] || DIRECCION_GENERICA,
        });

        await queryInterface.bulkInsert(
          'PedidoItems',
          items.map((item) => ({
            ...item,
            pedidoId,
            observacion: null,
            createdAt: fechaHora,
            updatedAt: fechaHora,
          }))
        );

        const historial = esCancelado ? ESTADOS_CANCELADO : ESTADOS_ENTREGADO;
        await queryInterface.bulkInsert(
          'PedidoEstadoHistorials',
          historial.map((paso) => ({
            pedidoId,
            estadoId: idEstado.get(paso.nombre),
            usuarioId: cliente.id,
            fechaHora: new Date(fechaHora.getTime() + paso.minutos * MIN),
            observacion: MARCA,
            createdAt: fechaHora,
            updatedAt: fechaHora,
          }))
        );

        if (!esCancelado) {
          const mapa = entregadosPorCliente.get(cliente.id);
          for (const item of items) {
            if (!mapa.has(item.productoId)) {
              mapa.set(item.productoId, { pedidoId, fechaHora });
            }
          }
        }
      }
    }

    // 3 reseñas por producto: una por cliente, sobre un pedido entregado real
    // de ese cliente que contenga el producto.
    //
    // Las notas salen de una bolsa con más 5 que 4 y algún 3: así los promedios
    // por producto varían (4,0 / 4,3 / 4,7) en vez de dar todos 4,0, que es lo
    // que pasa si cada producto recibe exactamente un 3, un 4 y un 5.
    const notas = [5, 4, 5, 5, 3, 4, 5, 4];
    const resenas = [];
    for (const producto of productos) {
      for (let c = 0; c < clientes.length; c += 1) {
        const origen = entregadosPorCliente
          .get(clientes[c].id)
          .get(producto.id);
        if (!origen) continue; // no debería pasar: los pedidos cubren el catálogo

        const creadaEn = new Date(
          Math.min(ahora - MIN, origen.fechaHora.getTime() + 2 * 60 * MIN)
        );
        resenas.push({
          usuarioId: clientes[c].id,
          productoId: producto.id,
          pedidoId: origen.pedidoId,
          puntuacion: notas[(producto.id * 3 + c) % notas.length],
          comentario: comentarioDe(producto.categoria, producto.id + c),
          createdAt: creadaEn,
          updatedAt: creadaEn,
        });
      }
    }

    if (resenas.length) {
      await queryInterface.bulkInsert('Resenas', resenas);
    }

    console.log(
      `Clientes demo: ${clientes.length} clientes, ${
        clientes.length * PEDIDOS_POR_CLIENTE
      } pedidos (${CANCELADOS.size} cancelados) y ${resenas.length} reseñas.`
    );
  },

  down: async (queryInterface) => {
    const emails = CLIENTES.map((cliente) => cliente.email);
    await borrarSeedPrevio(queryInterface, emails);
    await queryInterface.sequelize.query(
      `DELETE FROM "Usuarios" WHERE email IN (:emails)`,
      { replacements: { emails } }
    );
  },
};
