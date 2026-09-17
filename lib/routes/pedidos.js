import express from 'express';
import {
  cambiarEstado,
  create,
  index,
  show,
} from '../controllers/pedido_controller';
import { permitirRoles, verificarSesion } from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

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

export default router;
