import express from 'express';
import {
  cerrar,
  create,
  index,
  mias,
  responder,
  update,
} from '../controllers/queja_controller';
import { withErrorHandling } from './utils';
import {
  permitirRoles,
  requiereSucursal,
  verificarSesion,
} from '../middlewares/auth';

const router = express.Router();

// El CLIENTE crea y consulta solo sus propios reclamos.
router.get(
  '/mias',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(mias)
);
router.post(
  '/',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(create)
);
router.post(
  '/:id/mensajes',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(responder)
);
router.post(
  '/:id/cerrar',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(cerrar)
);

// La bandeja es compartida: el ADMINISTRADOR queda acotado a su sucursal y el
// SUPERADMINISTRADOR ve todo (el service aplica el alcance).
router.get(
  '/',
  verificarSesion,
  permitirRoles('ADMINISTRADOR', 'SUPERADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(index)
);
router.put(
  '/:id',
  verificarSesion,
  permitirRoles('ADMINISTRADOR', 'SUPERADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(update)
);

export default router;
