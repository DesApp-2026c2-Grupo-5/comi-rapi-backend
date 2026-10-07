import express from 'express';
import {
  cambiarEstado,
  create,
  index,
  show,
} from '../controllers/pedido_controller';
import {
  permitirRoles,
  requiereSucursal,
  verificarSesion,
} from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

// Repetir pedido (80): reutiliza POST /pedidos, sin endpoint dedicado.
// El frontend rearma { productos: [{ productoId, cantidad, personalizacion }], direccionEntrega }
// desde un pedido propio en estado final (entregado/cancelado) y crea un pedido nuevo en pendiente.
// La propiedad se garantiza con show/index (403 si no es dueño); el total se recalcula en create.
// Un ADMINISTRADOR sin sucursal no puede operar pedidos (requiereSucursal).
// La lectura (index/show) alcanza al SUPERADMINISTRADOR para ver el detalle de un cliente.
router.post(
  '/',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(create)
);
router.get(
  '/',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR', 'SUPERADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(index)
);
router.get(
  '/:id',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR', 'SUPERADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(show)
);
router.patch(
  '/:id/estado',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(cambiarEstado)
);

export default router;
