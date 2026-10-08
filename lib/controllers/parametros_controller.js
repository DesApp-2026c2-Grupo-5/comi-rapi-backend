import {
  actualizarParametros,
  obtenerParametros,
} from '../services/parametros_service';

/**
 * Listado de parámetros de negocio con su valor vigente.
 *
 * Es de lectura pública: el catálogo no tiene datos sensibles y el frontend lo
 * necesita para no duplicar reglas (límites del carrito, envío, etc.). La
 * edición sí es exclusiva del SUPERADMINISTRADOR (ver ruta).
 */
export const index = async (req, res) => {
  const data = await obtenerParametros();
  return res.json({ success: true, data });
};

/**
 * Actualiza uno o varios parámetros de negocio. Solo llega acá el
 * SUPERADMINISTRADOR (lo garantiza el middleware de la ruta).
 *
 * El body es el mapa `{ clave: valor }` de los parámetros a cambiar; las claves
 * que no se envían conservan su valor.
 */
export const actualizar = async (req, res) => {
  const data = await actualizarParametros(req.body);
  return res.json({ success: true, data });
};

export default { index, actualizar };
