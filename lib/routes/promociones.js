import express from 'express';
import {
  index,
  show,
  create,
  update,
  destroy,
  listarProductos,
  asignarProducto,
  quitarProducto,
} from '../controllers/promocion_controller';
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
router.get(
  '/:id/productos',
  sesionOpcional,
  withErrorHandling(listarProductos)
);
router.post(
  '/:id/productos',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  withErrorHandling(asignarProducto)
);
router.delete(
  '/:id/productos/:productoId',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  withErrorHandling(quitarProducto)
);

export default router;
