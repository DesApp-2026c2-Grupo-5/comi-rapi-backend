'use strict';

// Historial de compras que hace elegible a `cliente@test.com` para las dos
// emisiones de prueba sembradas en `20261124000002-demo-emisiones-cupones-prueba.js`.
//
// Las emisiones reales se configuraron el 2026-11-24 con `tiposCliente:
// ['ACTIVO']`, períodos de 30 y 20 días y mínimo 2 y 1 unidades de los productos
// de la categoría "Pizzas" (`productoIdsResueltos`). Los pedidos de ejemplo de
// `20260916000001-pedidos-ejemplo.js` dejan la pizza en `en_camino`/`confirmado`,
// y ésos NO son pedidos ENTREGADOS: no cuentan para el mínimo. Por eso acá se
// cargan dos entregas de una pizza cada una, fechadas dentro de AMBOS períodos
// evaluados respecto de `MOMENTO_EMISION`. No se toca ninguna regla de
// elegibilidad: se agregan compras reales al historial.
//
// Idempotente: borra las filas con `observacion = MARCA` antes de insertarlas,
// igual que hacen los seeders de pedidos existentes.

const MARCA = 'SEED-CUPON-ELEGIBILIDAD';
const DIA = 24 * 60 * 60 * 1000;
const MOMENTO_EMISION = new Date('2026-11-24T20:14:23.871Z');

async function buscarId(queryInterface, tabla, columna, valor) {
  const [
    filas,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "${tabla}" WHERE "${columna}" = :valor LIMIT 1`,
    { replacements: { valor } }
  );
  if (!filas.length) {
    throw new Error(
      `Seeder de elegibilidad: no se encontró ${tabla} con ${columna}='${valor}'. Ejecutar los seeders previos.`
    );
  }
  return filas[0].id;
}

async function borrarPrevios(queryInterface) {
  const [
    pedidos,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "Pedidos" WHERE "observacion" = :marca`,
    { replacements: { marca: MARCA } }
  );
  const ids = pedidos.map((pedido) => pedido.id);
  if (ids.length === 0) return;
  const lista = ids.join(',');
  await queryInterface.sequelize.query(
    `DELETE FROM "PedidoCupones" WHERE "pedidoId" IN (${lista})`
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

module.exports = {
  up: async (queryInterface) => {
    const usuarioId = await buscarId(
      queryInterface,
      'Usuarios',
      'email',
      'cliente@test.com'
    );
    const sucursalId = await buscarId(
      queryInterface,
      'Sucursales',
      'nombre',
      'Sucursal Oeste'
    );
    const estadoId = await buscarId(
      queryInterface,
      'EstadoPedidos',
      'nombre',
      'entregado'
    );
    const [
      productos,
    ] = await queryInterface.sequelize.query(
      `SELECT id, nombre, precio FROM "Productos" WHERE nombre = :nombre LIMIT 1`,
      { replacements: { nombre: 'Pizza Muzzarella' } }
    );
    if (!productos.length) {
      throw new Error(
        'Seeder de elegibilidad: no se encontró "Pizza Muzzarella". Ejecutar los seeders previos.'
      );
    }
    const producto = productos[0];
    const precio = Number(producto.precio);

    const [direcciones] = await queryInterface.sequelize.query(
      `SELECT "calle", "altura", "localidad" AS ciudad, "codigoPostal",
              "referencia", "latitud", "longitud"
         FROM "Direcciones"
        WHERE "usuarioId" = :usuarioId AND "activa" = TRUE AND "alias" = 'Casa'
        LIMIT 1`,
      { replacements: { usuarioId } }
    );
    if (!direcciones.length) {
      throw new Error(
        'Seeder de elegibilidad: el cliente no tiene la dirección "Casa". Ejecutar antes 20260915000002-direccion-cliente-demo.'
      );
    }
    const direccion = direcciones[0];

    // Se resuelve todo antes de borrar: si falta una dependencia, la corrida
    // anterior sigue intacta (mismo criterio que 20260916000001).
    await borrarPrevios(queryInterface);

    for (const diasAtras of [1, 2]) {
      const fechaHora = new Date(MOMENTO_EMISION.getTime() - diasAtras * DIA);
      const [filas] = await queryInterface.sequelize.query(
        `INSERT INTO "Pedidos"
           ("usuarioId","sucursalId","fechaHora","estadoId","costoEnvio",
            "total","medioPago","observacion","calle","altura","ciudad",
            "codigoPostal","referencia","latitud","longitud",
            "createdAt","updatedAt")
         VALUES
           (:usuarioId,:sucursalId,:fechaHora,:estadoId,0,:total,
            'MERCADO_PAGO',:marca,:calle,:altura,:ciudad,
            :codigoPostal,:referencia,:latitud,:longitud,NOW(),NOW())
         RETURNING id`,
        {
          replacements: {
            usuarioId,
            sucursalId,
            fechaHora,
            estadoId,
            total: precio,
            marca: MARCA,
            calle: direccion.calle,
            altura: direccion.altura,
            ciudad: direccion.ciudad,
            codigoPostal: direccion.codigoPostal,
            referencia: direccion.referencia,
            latitud: direccion.latitud,
            longitud: direccion.longitud,
          },
        }
      );
      const pedidoId = filas[0].id;
      await queryInterface.bulkInsert('PedidoItems', [
        {
          pedidoId,
          productoId: producto.id,
          nombreProducto: producto.nombre,
          precioUnitario: precio,
          cantidad: 1,
          subtotal: precio,
          observacion: null,
          nota: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      await queryInterface.bulkInsert('PedidoEstadoHistorials', [
        {
          pedidoId,
          estadoId,
          usuarioId,
          fechaHora,
          observacion: MARCA,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    }
  },

  down: async (queryInterface) => {
    await borrarPrevios(queryInterface);
  },
};
