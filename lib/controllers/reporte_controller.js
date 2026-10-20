import {
  obtenerReportes,
  validarPeriodo,
  PeriodoInvalidoError,
  SucursalInexistenteError,
} from '../services/reportes_service';

/**
 * Reportes agregados del negocio.
 *
 * El alcance por sucursal se resuelve SIEMPRE en el backend: un ADMINISTRADOR
 * queda atado a `req.usuario.sucursalId` e ignora cualquier `?sucursalId=` del
 * request. El SUPERADMINISTRADOR puede filtrar por sucursal o ver todo.
 */
export const reportes = async (req, res) => {
  let periodo;
  try {
    periodo = validarPeriodo(req.query.desde, req.query.hasta);
  } catch (error) {
    if (error instanceof PeriodoInvalidoError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    throw error;
  }

  let sucursalId = null;
  if (req.usuario.rol === 'ADMINISTRADOR') {
    sucursalId = Number(req.usuario.sucursalId);
    if (!sucursalId) {
      return res.status(403).json({
        success: false,
        error: 'El administrador no tiene una sucursal asignada',
      });
    }
  } else if (
    req.query.sucursalId !== undefined &&
    req.query.sucursalId !== ''
  ) {
    sucursalId = Number(req.query.sucursalId);
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'El sucursalId indicado no es válido',
      });
    }
  }

  try {
    const data = await obtenerReportes({ periodo, sucursalId });
    return res.json({ success: true, data });
  } catch (error) {
    if (error instanceof SucursalInexistenteError) {
      return res.status(404).json({ success: false, error: error.message });
    }
    throw error;
  }
};

export default { reportes };
