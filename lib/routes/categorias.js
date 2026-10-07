import express from 'express';
import {
  index,
  show,
  create,
  update,
  destroy,
} from '../controllers/categoria_controller';
import { withErrorHandling } from './utils';
import {
  permitirRoles,
  sesionOpcional,
  verificarSesion,
} from '../middlewares/auth';

const router = express.Router();

router.get('/', sesionOpcional, withErrorHandling(index));
router.get('/:id', sesionOpcional, withErrorHandling(show));
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
