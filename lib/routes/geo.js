/**
 * Rutas: geo
 *
 * Iteración 3: catálogo territorial (proxy con cache de Georef Argentina)
 * para los selects en cascada del frontend, el autocompletado de calles, el
 * aviso de cobertura por provincia y el preview de direcciones.
 *
 * Público (sin sesión): no expone datos sensibles y los formularios de
 * registro/dirección lo consumen antes de autenticarse en algunos flujos.
 * La validación de cobertura REAL sigue siendo responsabilidad del backend
 * al guardar la dirección (POST /api/direcciones); estos endpoints son
 * informativos, excepto el preview, que resuelve la ambigüedad ANTES de
 * guardar (requisito de la iteración: primero la selección, después la
 * cobertura).
 */

import express from 'express';
import {
  obtenerDepartamentos,
  obtenerLocalidades,
  buscarCalles,
  obtenerZonas,
} from '../services/geo_catalogo_service';
import { resolverDireccion } from '../services/geolocation_service';

const router = express.Router();

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// Partidos (Buenos Aires) / comunas (CABA) / departamentos (resto).
router.get('/departamentos', async (req, res, next) => {
  try {
    const provincia = texto(req.query.provincia);
    if (!provincia) {
      return res
        .status(400)
        .json({ success: false, error: 'La provincia es obligatoria' });
    }
    res.json({ success: true, data: await obtenerDepartamentos(provincia) });
  } catch (error) {
    next(error);
  }
});

// Localidades (BAHRA; en CABA son los barrios) de una provincia/partido.
router.get('/localidades', async (req, res, next) => {
  try {
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
  } catch (error) {
    next(error);
  }
});

// Autocompletado de calles por nombre parcial.
router.get('/calles', async (req, res, next) => {
  try {
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
    const calles = await buscarCalles({
      provincia,
      departamento: texto(req.query.departamento) || undefined,
      localidad: texto(req.query.localidad) || undefined,
      nombre,
    });
    res.json({ success: true, data: calles });
  } catch (error) {
    next(error);
  }
});

// Zonas de operación (para el aviso al seleccionar la provincia).
router.get('/zonas', (req, res) => {
  res.json({ success: true, data: obtenerZonas() });
});

// Preview de dirección: geocodifica sin persistir ni validar cobertura.
// Siempre 200 con el estado ('unica' | 'ambigua' | 'no_encontrada'); la
// ambigüedad se responde con `opciones` para que el usuario elija y vuelva
// a previsualizar antes de guardar.
router.post('/preview', async (req, res, next) => {
  try {
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
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
