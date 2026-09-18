import express from 'express';
import auth from './auth';
import usuarios from './usuarios';
import categorias from './categorias';
import productos from './productos';
import pedidos from './pedidos';
import sucursales from './sucursales';

const router = express.Router();

// Endpoint de salud: no toca la base de datos, sirve de "conexión mínima"
// para que el frontend verifique que la API está arriba.
router.get('/api/health', (req, res) => {
  res.json({
    success: true,
    servicio: 'comi-rapi-backend',
    timestamp: new Date().toISOString(),
  });
});

router.use('/api/auth', auth);
router.use('/api/usuarios', usuarios);
router.use('/api/categorias', categorias);
router.use('/api/productos', productos);
router.use('/api/pedidos', pedidos);
router.use('/api/sucursales', sucursales);

export default router;
