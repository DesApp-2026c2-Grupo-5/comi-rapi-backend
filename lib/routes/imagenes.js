/**
 * Rutas de imágenes.
 *
 * POST /api/imagenes/upload           — sube imagen de producto (multipart,
 *   campo "imagen") y la guarda en public/imagenes/productos.
 * POST /api/imagenes/upload/categoria — sube imagen de categoría y la
 *   guarda en public/imagenes/categorias.
 * Solo para SUPERADMINISTRADOR autenticado (el admin no edita el catálogo:
 * sólo activa/desactiva y ajusta stock en su sucursal).
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
  permitirRoles('SUPERADMINISTRADOR'),
  subirImagenUnica(),
  withErrorHandling(subir)
);

router.post(
  '/upload/categoria',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  subirImagenUnica(),
  withErrorHandling(subirCategoria)
);

export default router;
