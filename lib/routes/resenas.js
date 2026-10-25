import express from 'express';
import {
  create,
  destroy,
  elegibles,
  mias,
  update,
} from '../controllers/resena_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

// Todas las rutas de acá son del CLIENTE: el listado público de reseñas de un
// producto vive en `/api/productos/:id/resenas` (ver `productos.js`).
router.get(
  '/elegibles',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(elegibles)
);
router.get(
  '/mias',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(mias)
);
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
