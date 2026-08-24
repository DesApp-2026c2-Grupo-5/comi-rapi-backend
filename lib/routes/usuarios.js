import express from 'express';
import { index } from '../controllers/usuario_controller';
import { withErrorHandling } from './utils';

const router = express.Router();

/* GET all users */
router.get('/', withErrorHandling(index));

export default router;
