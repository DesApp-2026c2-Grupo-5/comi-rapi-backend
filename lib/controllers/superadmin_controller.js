import { obtenerResumen } from '../services/metricas_service';

/**
 * Resumen agregado del negocio para el panel del SUPERADMINISTRADOR.
 *
 * No expone pedidos individuales: solo agregados (COUNT/SUM/GROUP BY) que
 * calcula el service directamente contra la base.
 */
export const resumen = async (req, res) => {
  const data = await obtenerResumen();
  return res.json({ success: true, data });
};

export default { resumen };
