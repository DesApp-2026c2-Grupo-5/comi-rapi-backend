import express from 'express';
import {
  index,
  masVendidos,
  show,
  create,
  update,
  destroy,
} from '../controllers/producto_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

router.get('/', withErrorHandling(index));
// OJO: va antes que `/:id` a propósito. Express prueba las rutas en orden, así
// que si `/:id` estuviera primero se comería "mas-vendidos" como si fuera un id
// y respondería 404 "Producto no encontrado".
router.get('/mas-vendidos', withErrorHandling(masVendidos));
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
