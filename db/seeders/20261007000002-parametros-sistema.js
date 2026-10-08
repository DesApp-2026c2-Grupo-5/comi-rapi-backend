'use strict';

// Valores iniciales de los parámetros de negocio (ver
// lib/services/parametros_service.js, que define el catálogo y es la fuente de
// verdad de claves, tipos y valores por defecto).
//
// Se cargan explícitamente para que el SUPERADMINISTRADOR los vea y pueda
// editarlos desde el panel. Si una fila faltara, el servicio cae al valor por
// defecto del catálogo, así que este seeder y el catálogo deben coincidir
// (incluida la `descripcion`).
//
// down(): borra todas las filas (la tabla es solo de configuración).

const parametros = [
  {
    clave: 'montoMinimoEnvioGratis',
    valor: '10000',
    descripcion: 'Subtotal a partir del cual el envío no se cobra.',
  },
  {
    clave: 'costoEnvioFijo',
    valor: '350',
    descripcion:
      'Costo de envío que se suma cuando el subtotal es menor al mínimo de envío gratis.',
  },
  {
    clave: 'radioCoberturaKm',
    valor: '5',
    descripcion:
      'Distancia máxima por ruta entre la sucursal y la dirección de entrega.',
  },
  {
    clave: 'cantidadMaximaProductoCarrito',
    valor: '20',
    descripcion:
      'Máximo de unidades del mismo producto que se pueden agregar al carrito.',
  },
  {
    clave: 'minimoComponentesCombo',
    valor: '2',
    descripcion:
      'Cantidad mínima de productos distintos que debe tener la receta de un combo.',
  },
  {
    clave: 'montoMinimoPedido',
    valor: '2000',
    descripcion:
      'Subtotal mínimo (antes de descuentos y envío) para poder confirmar un pedido.',
  },
  {
    clave: 'montoMaximoPedido',
    valor: '500000',
    descripcion:
      'Subtotal máximo (antes de descuentos y envío) que admite un pedido.',
  },
  {
    clave: 'cantidadMaximaItemsPedido',
    valor: '50',
    descripcion:
      'Cantidad total de unidades (sumando todos los productos) que admite un pedido.',
  },
  {
    clave: 'cantidadMaximaUnidadesProducto',
    valor: '20',
    descripcion: 'Máximo de unidades de un mismo producto dentro de un pedido.',
  },
  {
    clave: 'porcentajeMaximoDescuento',
    valor: '50',
    descripcion:
      'Porcentaje máximo que puede descontar una promoción de tipo porcentual.',
  },
  {
    clave: 'cantidadMaximaPromocionesAplicables',
    valor: '3',
    descripcion:
      'Máximo de promociones que se pueden aplicar sobre un pedido. Reservado: el motor actual aplica automáticamente el mejor descuento por línea, sin acumular.',
  },
];

module.exports = {
  up: async (queryInterface) => {
    const ahora = new Date();
    await queryInterface.bulkInsert(
      'ParametrosSistema',
      parametros.map((parametro) => ({
        clave: parametro.clave,
        valor: parametro.valor,
        descripcion: parametro.descripcion,
        createdAt: ahora,
        updatedAt: ahora,
      }))
    );
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('ParametrosSistema', null, {});
  },
};
