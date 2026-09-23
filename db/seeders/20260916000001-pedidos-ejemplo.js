'use strict';

// Seeder de pedidos de ejemplo (etapa pedidos, opción A).
// Usa los clientes, productos, sucursales y estados que ya existen en la base.
// Idempotente: marca los pedidos con observacion='SEED-EJEMPLO' y borra los
// anteriores con esa marca antes de insertar, así se puede re-ejecutar.

const MARCA = 'SEED-EJEMPLO';
const MIN = 60 * 1000;

async function buscarId(queryInterface, tabla, columna, valor) {
  const [
    filas,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "${tabla}" WHERE "${columna}" = :valor LIMIT 1`,
    { replacements: { valor } }
  );
  if (!filas.length) {
    throw new Error(
      `Seeder de pedidos: no se encontró ${tabla} con ${columna}='${valor}'. Ejecutar los seeders previos.`
    );
  }
  return filas[0].id;
}

async function borrarSeedPrevio(queryInterface) {
  const [pedidos] = await queryInterface.sequelize.query(
    `SELECT id FROM "Pedidos" WHERE observacion = '${MARCA}'`
  );
  const ids = pedidos.map((p) => p.id);
  if (!ids.length) return;
  const lista = ids.join(',');
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
        "referencia","createdAt","updatedAt")
     VALUES
       (:usuarioId,:sucursalId,:fechaHora,:estadoId,:costoEnvio,:total,
        :medioPago,:observacion,:calle,:altura,:ciudad,:codigoPostal,
        :referencia,NOW(),NOW())
     RETURNING id`,
    {
      replacements: {
        usuarioId: datos.usuarioId,
        sucursalId: datos.sucursalId,
        fechaHora: datos.fechaHora,
        estadoId: datos.estadoId,
        costoEnvio: datos.costoEnvio,
        total: datos.total,
        medioPago: datos.medioPago || null,
        observacion: MARCA,
        calle: datos.calle || null,
        altura: datos.altura || null,
        ciudad: datos.ciudad || null,
        codigoPostal: datos.codigoPostal || null,
        referencia: datos.referencia || null,
      },
    }
  );
  return filas[0].id;
}

module.exports = {
  up: async (queryInterface) => {
    await borrarSeedPrevio(queryInterface);

    const usuarioId = await buscarId(
      queryInterface,
      'Usuarios',
      'email',
      'cliente@test.com'
    );
    const sucursal = {
      centro: await buscarId(
        queryInterface,
        'Sucursales',
        'nombre',
        'Sucursal Centro'
      ),
      norte: await buscarId(
        queryInterface,
        'Sucursales',
        'nombre',
        'Sucursal Norte'
      ),
      sur: await buscarId(
        queryInterface,
        'Sucursales',
        'nombre',
        'Sucursal Sur'
      ),
    };
    const estado = {};
    for (const nombre of [
      'pendiente',
      'confirmado',
      'en_preparacion',
      'listo_para_entregar',
      'en_camino',
      'entregado',
    ]) {
      estado[nombre] = await buscarId(
        queryInterface,
        'EstadoPedidos',
        'nombre',
        nombre
      );
    }
    const [productos] = await queryInterface.sequelize.query(
      `SELECT id, nombre, precio FROM "Productos"
        WHERE nombre IN
          ('Hamburguesa Clásica','Papas Fritas Grandes','Pizza Muzzarella','Combo Doble')`
    );
    const porNombre = Object.fromEntries(productos.map((p) => [p.nombre, p]));
    for (const nombre of Object.keys(porNombre)) {
      porNombre[nombre].precio = Number(porNombre[nombre].precio);
    }

    const linea = (nombre, cantidad) => ({
      productoId: porNombre[nombre].id,
      nombreProducto: nombre,
      precioUnitario: porNombre[nombre].precio,
      cantidad,
      subtotal: porNombre[nombre].precio * cantidad,
      observacion: null,
    });

    const ahora = Date.now();
    const pedidos = [
      {
        // 1. Entregado con historial completo
        sucursalId: sucursal.centro,
        estadoId: estado.entregado,
        fechaHora: new Date(ahora - 2 * 24 * 60 * MIN),
        costoEnvio: 0,
        medioPago: 'MERCADO_PAGO',
        items: [
          linea('Hamburguesa Clásica', 2),
          linea('Papas Fritas Grandes', 1),
        ],
        historial: [
          'pendiente',
          'confirmado',
          'en_preparacion',
          'listo_para_entregar',
          'en_camino',
          'entregado',
        ].map((nombre, i) => ({
          estado: nombre,
          minutos: [0, 2, 5, 20, 30, 50][i],
        })),
      },
      {
        // 2. En camino
        sucursalId: sucursal.norte,
        estadoId: estado.en_camino,
        fechaHora: new Date(ahora - 5 * 60 * MIN),
        costoEnvio: 500,
        medioPago: 'TARJETA',
        items: [linea('Pizza Muzzarella', 1)],
        historial: [
          'pendiente',
          'confirmado',
          'en_preparacion',
          'listo_para_entregar',
          'en_camino',
        ].map((nombre, i) => ({
          estado: nombre,
          minutos: [0, 2, 5, 25, 35][i],
        })),
      },
      {
        // 3. Pendiente con snapshot de dirección
        sucursalId: sucursal.centro,
        estadoId: estado.pendiente,
        fechaHora: new Date(ahora - 30 * MIN),
        costoEnvio: 500,
        medioPago: null,
        calle: 'Av. Siempreviva',
        altura: 1234,
        ciudad: 'Capital Federal',
        codigoPostal: '1406',
        referencia: 'Casa verde',
        items: [linea('Combo Doble', 1)],
        historial: [{ estado: 'pendiente', minutos: 0 }],
      },
      {
        // 4. Confirmado
        sucursalId: sucursal.sur,
        estadoId: estado.confirmado,
        fechaHora: new Date(ahora - 60 * MIN),
        costoEnvio: 0,
        medioPago: null,
        items: [linea('Pizza Muzzarella', 1), linea('Papas Fritas Grandes', 2)],
        historial: [
          { estado: 'pendiente', minutos: 0 },
          { estado: 'confirmado', minutos: 5 },
        ],
      },
    ];

    for (const pedido of pedidos) {
      const totalItems = pedido.items.reduce((acc, i) => acc + i.subtotal, 0);
      const pedidoId = await crearPedido(queryInterface, {
        usuarioId,
        sucursalId: pedido.sucursalId,
        fechaHora: pedido.fechaHora,
        estadoId: pedido.estadoId,
        costoEnvio: pedido.costoEnvio,
        total: totalItems + pedido.costoEnvio,
        medioPago: pedido.medioPago,
        calle: pedido.calle,
        altura: pedido.altura,
        ciudad: pedido.ciudad,
        codigoPostal: pedido.codigoPostal,
        referencia: pedido.referencia,
      });
      await queryInterface.bulkInsert(
        'PedidoItems',
        pedido.items.map((item) => ({
          ...item,
          pedidoId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
      await queryInterface.bulkInsert(
        'PedidoEstadoHistorials',
        pedido.historial.map((h) => ({
          pedidoId,
          estadoId: estado[h.estado],
          usuarioId,
          fechaHora: new Date(pedido.fechaHora.getTime() + h.minutos * MIN),
          observacion: MARCA,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
    }
  },

  down: async (queryInterface) => {
    await borrarSeedPrevio(queryInterface);
  },
};
