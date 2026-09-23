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
import multer from 'multer';
import { subir, subirCategoria } from '../controllers/imagen_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const MAXIMO_MB = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAXIMO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mimetypeValido =
      file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (mimetypeValido) {
      cb(null, true);
      return;
    }
    const error = new Error('El archivo debe ser una imagen (JPG, PNG o WEBP)');
    cb(error, false);
  },
});

/**
 * Devuelve el middleware de multer envuelto para traducir sus errores a
 * respuestas 400 con formato uniforme en vez de dejarlos caer al error
 * handler global (500).
 */
function subirUnaImagen() {
  return (req, res, next) => {
    upload.single('imagen')(req, res, (error) => {
      if (!error) {
        return next();
      }
      const mensaje =
        error.code === 'LIMIT_FILE_SIZE'
          ? `La imagen supera el tamaño máximo permitido (${MAXIMO_MB} MB)`
          : error.message || 'No se pudo procesar la imagen';
      return res.status(400).json({ success: false, error: mensaje });
    });
  };
}

const router = express.Router();

router.post(
  '/upload',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  subirUnaImagen(),
  withErrorHandling(subir)
);

router.post(
  '/upload/categoria',
  verificarSesion,
  permitirRoles('ADMINISTRADOR'),
  subirUnaImagen(),
  withErrorHandling(subirCategoria)
);

export default router;
