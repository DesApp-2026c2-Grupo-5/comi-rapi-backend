import express from 'express';
import {
  index,
  show,
  create,
  update,
  destroy,
} from '../controllers/categoria_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

router.get('/', withErrorHandling(index));
router.get('/:id', withErrorHandling(show));
router.post(
  '/',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  withErrorHandling(create)
);
router.put(
  '/:id',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  withErrorHandling(update)
);
router.delete(
  '/:id',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  withErrorHandling(destroy)
);

export default router;
