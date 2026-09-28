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
router.get(
  '/:id/productos',
  sesionOpcional,
  withErrorHandling(listarProductos)
);
router.post(
  '/:id/productos',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  withErrorHandling(asignarProducto)
);
router.delete(
  '/:id/productos/:productoId',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  withErrorHandling(quitarProducto)
);

export default router;
