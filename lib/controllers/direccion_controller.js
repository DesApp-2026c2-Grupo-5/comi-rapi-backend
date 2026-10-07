import db from '../models';
import {
  crearDireccionDeUsuario,
  actualizarDireccionDeUsuario,
} from '../services/direccion_service';
import { evaluarCoberturaCoordenadas } from '../services/cobertura_service';
const { Direccion } = db;

const esAdministrador = (req) => {
  const rol = req.usuario && req.usuario.rol;
  // El admin consulta direcciones de clientes en su detalle; el SUPERADMIN,
  // por visión global, también.
  return rol === 'ADMINISTRADOR' || rol === 'SUPERADMINISTRADOR';
};

const serializar = (direccion) => {
  const datos = direccion.toJSON();
  datos.latitud = datos.latitud !== null ? Number(datos.latitud) : null;
  datos.longitud = datos.longitud !== null ? Number(datos.longitud) : null;
  datos.altura = datos.altura !== null ? Number(datos.altura) : null;
  return datos;
};

/**
 * Adjunta a cada dirección su cobertura vigente, evaluada desde las
 * coordenadas persistidas (sin re-geocodificar). Si la dirección no tiene
 * coordenadas o la evaluación falla, informa sin cobertura sin romper
 * la respuesta.
 */
async function adjuntarCobertura(direcciones) {
  return Promise.all(
    direcciones.map(async (direccion) => {
      const datos = serializar(direccion);
      if (datos.latitud === null || datos.longitud === null) {
        return { ...datos, cobertura: { disponible: false, sucursal: null } };
      }
      try {
        const resultado = await evaluarCoberturaCoordenadas({
          coordenadas: { latitud: datos.latitud, longitud: datos.longitud },
          normalizada: {
            calle: direccion.calle,
            provincia: direccion.provincia,
            departamento: direccion.departamento,
            localidad: direccion.localidad,
          },
        });
        return {
          ...datos,
          cobertura: {
            disponible: resultado.coberturaDisponible,
            sucursal: resultado.sucursal,
          },
        };
      } catch {
        return { ...datos, cobertura: { disponible: false, sucursal: null } };
      }
    })
  );
}

export const index = async (req, res) => {
  const esAdmin = esAdministrador(req);
  const where = {};
  if (esAdmin) {
    if (req.query.usuarioId) {
      where.usuarioId = Number(req.query.usuarioId);
    }
    if (req.query.sucursalId) {
      where.sucursalId = Number(req.query.sucursalId);
    }
    if (req.query.activa !== 'false') {
      where.activa = true;
    }
  } else {
    where.usuarioId = req.usuario.id;
    where.activa = true;
  }
  const direcciones = await Direccion.findAll({
    where,
    order: [['id', 'ASC']],
  });
  // ?cobertura=true es opt-in: sin el flag la respuesta es exactamente
  // la de antes (compatibilidad con los consumidores actuales).
  const data =
    req.query.cobertura === 'true'
      ? await adjuntarCobertura(direcciones)
      : direcciones.map(serializar);
  res.json({ success: true, data });
};

export const show = async (req, res) => {
  const direccion = await Direccion.findByPk(req.params.id);
  if (!direccion) {
    return res
      .status(404)
      .json({ success: false, error: 'Dirección no encontrada' });
  }
  if (!esAdministrador(req) && direccion.usuarioId !== req.usuario.id) {
    return res
      .status(404)
      .json({ success: false, error: 'Dirección no encontrada' });
  }
  return res.json({ success: true, data: serializar(direccion) });
};

export const create = async (req, res) => {
  if (req.body.sucursalId !== undefined) {
    return res.status(400).json({
      success: false,
      error: 'sucursalId no está permitido en este endpoint',
    });
  }
  // El service valida, geocodifica (Georef), valida cobertura y persiste solo
  // si la dirección es válida para delivery. Los errores tipados se traducen
  // en el error handler (400/422/503).
  const direccion = await crearDireccionDeUsuario({
    usuarioId: req.usuario.id,
    datos: req.body,
  });
  return res.status(201).json({ success: true, data: serializar(direccion) });
};

export const update = async (req, res) => {
  const direccion = await Direccion.findByPk(req.params.id);
  if (!direccion) {
    return res
      .status(404)
      .json({ success: false, error: 'Dirección no encontrada' });
  }
  if (direccion.usuarioId !== req.usuario.id) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  // El service detecta cambios reales: si cambió un campo de ubicación,
  // re-geocodifica y re-valida cobertura; si solo cambiaron alias/referencia,
  // actualiza sin llamar a proveedores.
  await actualizarDireccionDeUsuario({ direccion, datos: req.body });
  return res.json({ success: true, data: serializar(direccion) });
};

export const destroy = async (req, res) => {
  const direccion = await Direccion.findByPk(req.params.id);
  if (!direccion) {
    return res
      .status(404)
      .json({ success: false, error: 'Dirección no encontrada' });
  }
  if (direccion.usuarioId !== req.usuario.id) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  await direccion.update({ activa: false });
  return res.json({ success: true });
};
