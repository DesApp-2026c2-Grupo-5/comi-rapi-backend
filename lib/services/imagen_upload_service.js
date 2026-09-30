/**
 * Servicio de guardado de imágenes en el repo del frontend.
 *
 * La imagen se escribe como archivo dentro de `public/imagenes/<carpeta>`
 * del frontend y se devuelve la ruta relativa (que Vite sirve en la raíz).
 * Así, al commitear el archivo, el resto del equipo lo ve tras un pull,
 * sin depender de servidores ni credenciales externos.
 */
import fs from 'fs';
import path from 'path';
import config from '../config/config';

const EXTENSIONES_VALIDAS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function nombreArchivoUnico(nombreOriginal, mimetype) {
  const base = (nombreOriginal || 'imagen')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const extension = EXTENSIONES_VALIDAS[mimetype] || 'png';
  return `${base || 'imagen'}-${Date.now()}.${extension}`;
}

/**
 * Valida y guarda una imagen como archivo local dentro de la carpeta y
 * base de URL indicadas.
 * @param {object} parametros - { carpeta, urlBase, buffer, nombreOriginal, mimetype }.
 * @returns {Promise<{url: string}>} Ruta relativa (sirve al frontend).
 */
function guardarImagenEnCarpeta({
  carpeta,
  urlBase,
  buffer,
  nombreOriginal,
  mimetype,
}) {
  if (!buffer || buffer.length === 0) {
    throw new Error('No se recibió ninguna imagen');
  }
  if (!EXTENSIONES_VALIDAS[mimetype]) {
    throw new Error('El archivo debe ser una imagen (JPG, PNG o WEBP)');
  }
  fs.mkdirSync(carpeta, { recursive: true });
  const nombre = nombreArchivoUnico(nombreOriginal, mimetype);
  fs.writeFileSync(path.join(carpeta, nombre), buffer);
  return { url: `${urlBase}/${encodeURIComponent(nombre)}` };
}

export function guardarImagenProducto(configuracion) {
  return guardarImagenEnCarpeta({
    carpeta: config.imagenes.dir,
    urlBase: config.imagenes.urlBase,
    ...configuracion,
  });
}

export function guardarImagenCategoria(configuracion) {
  return guardarImagenEnCarpeta({
    carpeta: config.imagenes.categoriasDir,
    urlBase: config.imagenes.categoriasUrlBase,
    ...configuracion,
  });
}

export function guardarImagenPerfil(configuracion) {
  return guardarImagenEnCarpeta({
    carpeta: config.imagenes.perfilesDir,
    urlBase: config.imagenes.perfilesUrlBase,
    ...configuracion,
  });
}

/**
 * Elimina el archivo de imagen correspondiente a una ruta relativa servida por
 * el frontend (p. ej. "/imagenes/perfiles/avatar-123.png").
 *
 * El nombre se valida contra un patrón estricto (solo las extensiones que este
 * servicio genera) para no permitir borrar archivos fuera de la carpeta por
 * manipulación de la URL.
 *
 * @param {string} carpeta - Carpeta absoluta donde está el archivo.
 * @param {string} url - Ruta relativa del archivo (formato son las urlBase).
 * @param {object} [opciones]
 * @param {boolean} [opciones.eliminarSiNoExiste] - No lanzar si el archivo no existe.
 * @returns {boolean} true si se eliminó el archivo, false si no existía.
 */
export function eliminarImagenEnCarpeta(carpeta, url) {
  if (!url) return false;
  const nombre = path.basename(url);
  if (!/^[a-z0-9-]+\.(jpg|png|webp)$/i.test(nombre)) return false;
  const ruta = path.join(carpeta, nombre);
  if (!fs.existsSync(ruta)) return false;
  fs.unlinkSync(ruta);
  return true;
}
