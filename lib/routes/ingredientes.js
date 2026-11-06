import express from 'express';
import {
  create,
  destroy,
  index,
  show,
  update,
} from '../controllers/ingrediente_controller';
import {
  permitirRoles,
  sesionOpcional,
  verificarSesion,
} from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

// Catálogo de materias primas para recetas. La lectura es pública porque el
// formulario de producto y el detalle del cliente necesitan nombre y unidad;
// la escritura es del SUPERADMINISTRADOR, como el resto del catálogo.
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
