/**
 * Propósito: rutas públicas del snapshot inicial.
 * GET /api/public/bootstrap: catálogo base + parámetros en una sola respuesta.
 */

import express from 'express';
import { show } from '../controllers/bootstrap_controller';
import { withErrorHandling } from './utils';

const router = express.Router();

router.get('/bootstrap', withErrorHandling(show));

export default router;
