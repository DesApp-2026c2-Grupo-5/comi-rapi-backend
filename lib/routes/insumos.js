import express from 'express';
import {
  create,
  destroy,
  index,
  show,
  update,
} from '../controllers/insumo_controller';
import {
  permitirRoles,
  sesionOpcional,
  verificarSesion,
} from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

// Catálogo de extras y condimentos con stock propio. La lectura es pública
// porque el modal del cliente y el formulario de personalización necesitan el
// nombre/precio; la escritura es del SUPERADMINISTRADOR, como el resto del
// catálogo corporativo.
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
