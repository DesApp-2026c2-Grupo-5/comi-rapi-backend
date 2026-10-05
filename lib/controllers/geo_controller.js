/**
 * Controller: geo_controller
 *
 * Endpoints del catálogo territorial (iteración 3) y del preview de
 * direcciones (iteraciones 3/5). Traduce HTTP↔dominio y valida los
 * parámetros de entrada (400); delega en los services:
 *   - geo_catalogo_service: departamentos, localidades (BAHRA), calles y
 *     zonas — proxy con cache en memoria de Georef Argentina.
 *   - geolocation_service.resolverDireccion: resuelve la identidad de la
 *     dirección SIN persistir (preview) y sin lanzar errores por reglas de
 *     negocio.
 *   - cobertura_service.evaluarCoberturaCoordenadas: evaluación NO lanzante
 *     de la cobertura (flag opt-in `cobertura`; misma lógica que la
 *     validación real del alta).
 *
 * Público (sin sesión): el catálogo no expone datos sensibles y los
 * formularios de registro/dirección lo consumen antes de autenticarse en
 * algunos flujos. La validación de cobertura REAL sigue siendo
 * responsabilidad del backend al guardar la dirección (POST
 * /api/direcciones); estos endpoints son informativos, excepto el preview,
 * que resuelve la ambigüedad ANTES de guardar.
 *
 * Refactor (post-Tarea 7): la lógica HTTP vivía en el archivo de rutas; se
 * mueve a este controller para respetar la arquitectura del proyecto
 * (Routes → Middlewares → Controllers → Services → Models) sin cambios de
 * contrato: mismos endpoints, códigos y respuestas.
 */

import {
  obtenerDepartamentos,
  obtenerLocalidades,
  buscarCalles,
  obtenerZonas,
} from '../services/geo_catalogo_service';
import { resolverDireccion } from '../services/geolocation_service';
import { evaluarCoberturaCoordenadas } from '../services/cobertura_service';

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** Partidos (Buenos Aires) / comunas (CABA) / departamentos (resto). */
export async function departamentos(req, res) {
  const provincia = texto(req.query.provincia);
  if (!provincia) {
    return res
      .status(400)
      .json({ success: false, error: 'La provincia es obligatoria' });
  }
  res.json({ success: true, data: await obtenerDepartamentos(provincia) });
}

/** Localidades (BAHRA; en CABA son los barrios) de una provincia/partido. */
export async function localidades(req, res) {
  const provincia = texto(req.query.provincia);
  if (!provincia) {
    return res
      .status(400)
      .json({ success: false, error: 'La provincia es obligatoria' });
  }
  const departamento = texto(req.query.departamento) || undefined;
  res.json({
    success: true,
    data: await obtenerLocalidades({ provincia, departamento }),
  });
}

/** Autocompletado de calles por nombre parcial (mínimo 3 letras). */
export async function calles(req, res) {
  const provincia = texto(req.query.provincia);
  const nombre = texto(req.query.nombre);
  if (!provincia) {
    return res
      .status(400)
      .json({ success: false, error: 'La provincia es obligatoria' });
  }
  if (nombre.length < 3) {
    // Evita llamadas a Georef por cada tecla: se busca a partir de 3 letras.
    return res.json({ success: true, data: [] });
  }
  const resultado = await buscarCalles({
    provincia,
    departamento: texto(req.query.departamento) || undefined,
    localidad: texto(req.query.localidad) || undefined,
    nombre,
  });
  res.json({ success: true, data: resultado });
}

/** Zonas de operación (para el aviso al seleccionar la provincia). */
export function zonas(req, res) {
  res.json({ success: true, data: obtenerZonas() });
}

/**
 * Preview de dirección: geocodifica sin persistir. Siempre 200 con el
 * estado ('unica' | 'ambigua' | 'no_encontrada'); la ambigüedad se responde
 * con `opciones` para que el usuario elija y vuelva a previsualizar antes
 * de guardar.
 *
 * Iteración 5: flag opt-in `cobertura` (solo el formulario del cliente lo
 * envía). Con cobertura=true y resultado único, se agrega al `data` el
 * resultado NO lanzante de `evaluarCoberturaCoordenadas`: dentroZona →
 * zona → sucursal más cercana → coberturaDisponible. Sin el flag,
 * comportamiento exacto de antes (el administrador no valida cobertura
 * comercial: 0 llamadas a ORS). El alta (POST /api/direcciones) sigue
 * siendo la validación definitiva: nunca se confía en el preview.
 */
export async function preview(req, res) {
  const datos = req.body || {};
  const calle = texto(datos.calle);
  const provincia = texto(datos.provincia);
  const alturaVacia =
    datos.altura === undefined ||
    datos.altura === null ||
    String(datos.altura).trim() === '';
  if (!calle || !provincia || alturaVacia) {
    return res.status(400).json({
      success: false,
      error: 'La calle, la altura y la provincia son obligatorias',
    });
  }
  const data = await resolverDireccion({
    calle,
    altura: datos.altura,
    provincia,
    departamento: texto(datos.departamento) || undefined,
    localidad: texto(datos.localidad) || undefined,
  });
  if (datos.cobertura === true && data.estado === 'unica') {
    const resultado = data.resultado;
    data.cobertura = await evaluarCoberturaCoordenadas({
      coordenadas: {
        latitud: resultado.latitud,
        longitud: resultado.longitud,
      },
      normalizada: resultado.normalizada,
    });
  }
  res.json({ success: true, data });
}
