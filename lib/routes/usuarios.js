import express from 'express';

import { index, show } from '../controllers/usuario_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

router.use(verificarSesion, permitirRoles('ADMINISTRADOR'));

router.get('/', withErrorHandling(index));
router.get('/:id', withErrorHandling(show));

export default router;
