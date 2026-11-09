import {
  actualizarParametros,
  obtenerParametros,
} from '../services/parametros_service';
import { emitirParametrosActualizados } from '../realtime';

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
  const cambios = req.body;
  const parametrosModificados = await actualizarParametros(cambios);
  // Si hubo cambios reales, emitimos evento con solo los parámetros que cambiaron
  if (parametrosModificados.length > 0) {
    emitirParametrosActualizados({ parametros: parametrosModificados });
  }
  // Devolver la lista completa para la respuesta HTTP (el frontend la usa para actualizar la UI del editor)
  const data = await obtenerParametros();
  return res.json({ success: true, data });
};

export default { index, actualizar };
