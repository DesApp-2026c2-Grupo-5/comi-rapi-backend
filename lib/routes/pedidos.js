import express from 'express';
import {
  cambiarEstado,
  create,
  index,
  reasignarSucursal,
  show,
} from '../controllers/pedido_controller';
import { permitirRoles, verificarSesion } from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

// Repetir pedido (80): reutiliza POST /pedidos, sin endpoint dedicado.
// El frontend rearma { productos: [{ productoId, cantidad, personalizacion }], direccionEntrega }
// desde un pedido propio en estado final (entregado/cancelado) y crea un pedido nuevo en pendiente.
// La propiedad se garantiza con show/index (403 si no es dueño); el total se recalcula en create.
router.post(
  '/',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR'),
  withErrorHandling(create)
);
router.get(
  '/',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR'),
  withErrorHandling(index)
);
router.get(
  '/:id',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR'),
  withErrorHandling(show)
);
router.patch(
  '/:id/estado',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR'),
  withErrorHandling(cambiarEstado)
);
// T4: reasignación manual de sucursal (solo ADMIN).
router.patch(
  '/:id/sucursal',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  withErrorHandling(reasignarSucursal)
);

export default router;
