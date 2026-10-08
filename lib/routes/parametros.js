import express from 'express';

import { index } from '../controllers/parametros_controller';
import { withErrorHandling } from './utils';

const router = express.Router();

// Lectura pública del catálogo de parámetros: el frontend la usa para no
// duplicar reglas de negocio. La edición es exclusiva del SUPERADMINISTRADOR
// (ver `routes/superadmin.js`).
router.get('/', withErrorHandling(index));

export default router;
