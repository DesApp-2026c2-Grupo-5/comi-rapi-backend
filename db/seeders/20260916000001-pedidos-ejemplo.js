'use strict';

// Seeder de pedidos de ejemplo (etapa pedidos, opción A).
// Usa los clientes, productos, sucursales y estados que ya existen en la base.
// Idempotente: marca los pedidos con observacion='SEED-EJEMPLO' y borra los
// anteriores con esa marca antes de insertar, así se puede re-ejecutar.
//
// Semántica T0: cada pedido copia el snapshot de ENTREGA con coordenadas de la
// Dirección real del cliente (latitud/longitud), como hace la app al pedir.
// Coherencia con cobertura: los pedidos de Oeste entregan en la dirección
// "Casa" (AV GDOR VERGARA 1593, a 1,6 km de Oeste y 2,7 km de Vergara) y los
// de Palermo en "Trabajo" (Av. Santa Fe 3700, a 588 m). Los estados con ETA
// visible (confirmado, en_camino) llevan etaMinutos/etaCalculadoEn.

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

/**
 * Dirección activa del cliente por alias, para usarla como snapshot de entrega.
 *
 * Los pedidos guardan una COPIA de la dirección en el momento del pedido
 * (columnas sueltas en `Pedidos`), no una referencia a `Direcciones`. Por eso
 * los pedidos usan las que tiene el cliente cargadas, que es lo que hace la app
 * al elegir una dirección en el carrito. Incluye latitud/longitud (T0).
 *
 * Ojo con los nombres: `Direcciones` tiene `provincia`/`localidad` y el snapshot
 * tiene `ciudad`. Se mapea `localidad` -> `ciudad`, igual que `payloadBackend` en
 * el frontend.
 */
async function buscarDireccionCliente(queryInterface, usuarioId, alias) {
  const [filas] = await queryInterface.sequelize.query(
    `SELECT "calle", "altura", "localidad", "codigoPostal", "referencia",
            "latitud", "longitud"
       FROM "Direcciones"
      WHERE "usuarioId" = :usuarioId AND "activa" = TRUE AND "alias" = :alias
      LIMIT 1`,
    { replacements: { usuarioId, alias } }
  );
  if (!filas.length) {
    throw new Error(
      `Seeder de pedidos: el cliente no tiene la dirección "${alias}". ` +
        'Ejecutar antes 20260915000002-direccion-cliente-demo.'
    );
  }
  const d = filas[0];
  return {
    calle: d.calle,
    altura: d.altura,
    ciudad: d.localidad,
    codigoPostal: d.codigoPostal,
    referencia: d.referencia,
    latitud: d.latitud,
    longitud: d.longitud,
  };
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
        "referencia","latitud","longitud","etaMinutos","etaCalculadoEn",
        "createdAt","updatedAt")
     VALUES
       (:usuarioId,:sucursalId,:fechaHora,:estadoId,:costoEnvio,:total,
        :medioPago,:observacion,:calle,:altura,:ciudad,:codigoPostal,
        :referencia,:latitud,:longitud,:etaMinutos,:etaCalculadoEn,NOW(),NOW())
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
        latitud: datos.latitud || null,
        longitud: datos.longitud || null,
        etaMinutos: datos.etaMinutos || null,
        etaCalculadoEn: datos.etaCalculadoEn || null,
      },
    }
  );
  return filas[0].id;
}

module.exports = {
  up: async (queryInterface) => {
    // Nota: `borrarSeedPrevio` va DESPUÉS de resolver los datos que necesita el
    // seeder. Si faltara alguno (usuario, sucursal, dirección) y se borrara
    // primero, un fallo dejaría la base sin los pedidos de ejemplo.
    const usuarioId = await buscarId(
      queryInterface,
      'Usuarios',
      'email',
      'cliente@test.com'
    );
    const sucursal = {
      oeste: await buscarId(
        queryInterface,
        'Sucursales',
        'nombre',
        'Sucursal Oeste'
      ),
      palermo: await buscarId(
        queryInterface,
        'Sucursales',
        'nombre',
        'Sucursal Palermo'
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
    const casa = await buscarDireccionCliente(
      queryInterface,
      usuarioId,
      'Casa'
    );
    const trabajo = await buscarDireccionCliente(
      queryInterface,
      usuarioId,
      'Trabajo'
    );

    // Recién ahora, con todo resuelto, se limpia la corrida anterior.
    await borrarSeedPrevio(queryInterface);

    const pedidos = [
      {
        // 1. Entregado con historial completo. Oeste entrega en "Casa"
        //    (Vergara 1593, a 1,6 km por ruta).
        sucursalId: sucursal.oeste,
        estadoId: estado.entregado,
        fechaHora: new Date(ahora - 2 * 24 * 60 * MIN),
        costoEnvio: 0,
        medioPago: 'MERCADO_PAGO',
        direccion: casa,
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
        // 2. En camino (Palermo entrega en "Trabajo", Av. Santa Fe 3700, a
        //    588 m). ETA visible: 30 de cocina + 1 de viaje ≈ 31 min,
        //    calculado al pasar a en_camino (hace 35 min).
        sucursalId: sucursal.palermo,
        estadoId: estado.en_camino,
        fechaHora: new Date(ahora - 5 * 60 * MIN),
        costoEnvio: 500,
        medioPago: 'TARJETA',
        direccion: trabajo,
        etaMinutos: 31,
        etaCalculadoEn: new Date(ahora - 35 * MIN),
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
        // 3. Pendiente en Oeste hacia "Casa": es el pedido listo para probar
        //    la reasignación manual o automática hacia Sucursal Vergara
        //    (2,7 km, también en cobertura).
        sucursalId: sucursal.oeste,
        estadoId: estado.pendiente,
        fechaHora: new Date(ahora - 30 * MIN),
        costoEnvio: 500,
        medioPago: null,
        direccion: casa,
        items: [linea('Combo Doble', 1)],
        historial: [{ estado: 'pendiente', minutos: 0 }],
      },
      {
        // 4. Confirmado en Palermo hacia "Trabajo". ETA visible desde la
        //    confirmación (hace 5 min).
        sucursalId: sucursal.palermo,
        estadoId: estado.confirmado,
        fechaHora: new Date(ahora - 60 * MIN),
        costoEnvio: 0,
        medioPago: null,
        direccion: trabajo,
        etaMinutos: 31,
        etaCalculadoEn: new Date(ahora - 55 * MIN),
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
        calle: pedido.direccion.calle,
        altura: pedido.direccion.altura,
        ciudad: pedido.direccion.ciudad,
        codigoPostal: pedido.direccion.codigoPostal,
        referencia: pedido.direccion.referencia,
        latitud: pedido.direccion.latitud,
        longitud: pedido.direccion.longitud,
        etaMinutos: pedido.etaMinutos,
        etaCalculadoEn: pedido.etaCalculadoEn,
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
