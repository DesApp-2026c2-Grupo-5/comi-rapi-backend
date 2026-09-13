import { ValidationError, UniqueConstraintError } from 'sequelize';

/* eslint-disable no-unused-vars */
const errorHandler = (err, req, res, next) => {
  if (err instanceof UniqueConstraintError || err instanceof ValidationError) {
    const mensaje =
      err.errors && err.errors.length
        ? err.errors[0].message
        : 'Datos inválidos';
    return res.status(400).json({ success: false, error: mensaje });
  }

  console.error(err);
  return res
    .status(500)
    .json({ success: false, error: 'Error interno del servidor' });
};

export default errorHandler;
