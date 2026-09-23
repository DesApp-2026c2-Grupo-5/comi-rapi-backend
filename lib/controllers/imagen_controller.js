/**
 * Controller de imágenes.
 *
 * Handlers: traducen la petición multipart (req.file) al service que
 * guarda la imagen en el repo y devuelve la ruta relativa. No contienen
 * reglas de negocio.
 */
import {
  guardarImagenCategoria,
  guardarImagenProducto,
} from '../services/imagen_upload_service';

async function procesarSubida(req, res, guardar) {
  const archivo = req.file;
  if (!archivo) {
    return res
      .status(400)
      .json({ success: false, error: 'No se recibió ninguna imagen' });
  }
  let resultado;
  try {
    resultado = await guardar({
      buffer: archivo.buffer,
      nombreOriginal: archivo.originalname,
      mimetype: archivo.mimetype,
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  return res.status(201).json({ success: true, data: { url: resultado.url } });
}

export const subir = async (req, res) =>
  procesarSubida(req, res, guardarImagenProducto);

export const subirCategoria = async (req, res) =>
  procesarSubida(req, res, guardarImagenCategoria);
