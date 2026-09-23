import express from 'express';
import {
  index,
  show,
  create,
  update,
  destroy,
} from '../controllers/direccion_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

router.get('/', verificarSesion, withErrorHandling(index));
router.get('/:id', verificarSesion, withErrorHandling(show));
router.post(
  '/',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(create)
);
router.put(
  '/:id',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(update)
);
router.delete(
  '/:id',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(destroy)
);

export default router;
