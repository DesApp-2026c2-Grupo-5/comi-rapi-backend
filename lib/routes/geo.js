/**
 * Rutas: geo
 *
 * Catálogo territorial (proxy con cache de Georef Argentina) para los
 * selects en cascada del frontend, el autocompletado de calles, el aviso de
 * cobertura por provincia y el preview de direcciones.
 *
 * Público (sin sesión): no expone datos sensibles y los formularios de
 * registro/dirección lo consumen antes de autenticarse en algunos flujos.
 *
 * Refactor (post-Tarea 7): rutas delgadas al estilo del resto del proyecto
 * — la lógica HTTP (validaciones, llamadas a services, shapeo de
 * respuestas) vive en `lib/controllers/geo_controller.js`; este archivo
 * solo declara endpoints.
 */

import express from 'express';
import {
  departamentos,
  localidades,
  calles,
  zonas,
  preview,
} from '../controllers/geo_controller';
import { withErrorHandling } from './utils';

const router = express.Router();

router.get('/departamentos', withErrorHandling(departamentos));
router.get('/localidades', withErrorHandling(localidades));
router.get('/calles', withErrorHandling(calles));
router.get('/zonas', withErrorHandling(zonas));
router.post('/preview', withErrorHandling(preview));

export default router;
