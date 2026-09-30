/**
 * Middleware de subida de imágenes (multipart, campo "imagen").
 *
 * Centraliza la configuración de multer (memoria, límite de 5 MB, solo
 * JPG/PNG/WEBP) y la traducción de sus errores a respuestas 400 con el
 * formato uniforme del proyecto ({ success, error }), sin dejarlos caer al
 * error handler global (500).
 *
 * Se reutiliza para las imágenes de productos/categorías (admin) y para la
 * foto de perfil del cliente.
 */
import multer from 'multer';

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
 * Devuelve el middleware de multer envuelto: single('imagen') con errores
 * traducidos a 400.
 */
export function subirImagenUnica() {
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
