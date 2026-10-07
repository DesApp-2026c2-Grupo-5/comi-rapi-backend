import express from 'express';
import {
  index,
  show,
  create,
  update,
  destroy,
} from '../controllers/sucursal_controller';
import { withErrorHandling } from './utils';
import {
  permitirRoles,
  sesionOpcional,
  verificarSesion,
} from '../middlewares/auth';

const router = express.Router();

router.get('/', sesionOpcional, withErrorHandling(index));
router.get('/:id', sesionOpcional, withErrorHandling(show));
// El CRUD de sucursales es decisión corporativa: lo maneja el SUPERADMINISTRADOR
// (el ADMINISTRADOR solo opera su sucursal asignada, no la administra).
router.post(
  '/',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  withErrorHandling(create)
);
router.put(
  '/:id',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  withErrorHandling(update)
);
router.delete(
  '/:id',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  withErrorHandling(destroy)
);

export default router;
