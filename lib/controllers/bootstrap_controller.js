/**
 * Propósito: Controller del snapshot público inicial.
 * Traduce HTTP↔dominio; la lectura y el armado viven en services/bootstrap.js.
 */

import { obtenerBootstrap } from '../services/bootstrap';

/**
 * GET /api/public/bootstrap
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const show = async (req, res) => {
  const data = await obtenerBootstrap();
  return res.json({ success: true, data });
};

export default { show };
