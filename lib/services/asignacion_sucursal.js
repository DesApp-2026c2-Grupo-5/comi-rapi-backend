/**
 * Service: asignacion_sucursal
 *
 * Asigna automáticamente la sucursal óptima según la menor carga de pedidos pendientes
 * (espejo del frontend src/services/asignacionSucursal.js). Se ejecuta al crear un pedido
 * cuando el cliente no eligió sucursal por geolocalización.
 *
 * Función esperada:
 *   - asignarSucursalOptima(sucursales, pedidosPendientes)
 *       * Filtra sucursales ACTIVAS.
 *       * Ordena por id ascendente (empates a favor de menor id).
 *       * Cuenta pedidos pendientes por 'sucursalId' (o 'sucursal.id').
 *       * Devuelve la sucursal con MENOS pedidos pendientes, o null si no hay.
 *
 * En el backend los "pendientes" son Pedidos con estado en
 * ('pendiente', 'confirmado', 'en_preparacion') agrupados por sucursalId.
 */
