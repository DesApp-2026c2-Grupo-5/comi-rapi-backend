/**
 * Rutas de imágenes.
 *
 * POST /api/imagenes/upload           — sube imagen de producto (multipart,
 *   campo "imagen") y la guarda en public/imagenes/productos.
 * POST /api/imagenes/upload/categoria — sube imagen de categoría y la
 *   guarda en public/imagenes/categorias.
 * Solo para ADMINISTRADOR autenticado.
 */
import express from 'express';
import { subir, subirCategoria } from '../controllers/imagen_controller';
import { subirImagenUnica } from '../middlewares/upload';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

router.post(
  '/upload',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  subirImagenUnica(),
  withErrorHandling(subir)
);

router.post(
  '/upload/categoria',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  subirImagenUnica(),
  withErrorHandling(subirCategoria)
);

export default router;
