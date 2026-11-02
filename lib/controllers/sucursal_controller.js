import db from '../models';
import {
  prepararDireccion,
  persistirDireccionSucursal,
} from '../services/direccion_service';
import { obtenerValor } from '../services/parametros_service';
import {
  agruparHorarios,
  formatearHorarios,
  franjaVigente,
  HorarioInvalidoError,
  normalizarHorarios,
  proximaApertura,
} from '../services/horarios_service';
import { reprogramarVigiaHorarios } from '../services/horarios_vigia';
import { emitirSucursalEstado } from '../realtime';

const { Sucursal, Direccion, HorarioSucursal } = db;

// Horario por defecto al crear una sucursal sin horarios explícitos: no se
// deja una sucursal recién creada cerrada las 24 h por omisión.
const HORARIO_POR_DEFECTO = Array.from({ length: 7 }, (_, indice) => ({
  diaSemana: indice + 1,
  apertura: '10:00',
  cierre: '23:00',
}));

const includeSucursal = [
  'direccion',
  { model: HorarioSucursal, as: 'horarios', required: false },
];

const esStaff = (req) =>
  req.usuario &&
  (req.usuario.rol === 'ADMINISTRADOR' ||
    req.usuario.rol === 'SUPERADMINISTRADOR');

/**
 * Serializa una sucursal con su horario estructurado.
 *
 * `horarios` se expone agrupado por día (siempre los siete) para el editor del
 * superadmin y la página pública; `horariosTexto` es el resumen legible.
 * `abiertaAhora` / `cierrePedidos` / `segundosRestantes` / `proximaApertura`
 * permiten que el frontend muestre el estado sin replicar la regla del margen.
 */
const serializar = (
  sucursal,
  { margenMinutos = 0, ahora = new Date() } = {}
) => {
  const datos = sucursal.toJSON();
  if (datos.direccion) {
    const dir = datos.direccion;
    dir.altura = dir.altura !== null ? Number(dir.altura) : null;
    dir.latitud = dir.latitud !== null ? Number(dir.latitud) : null;
    dir.longitud = dir.longitud !== null ? Number(dir.longitud) : null;
    datos.latitud = dir.latitud;
    datos.longitud = dir.longitud;
  } else {
    datos.latitud = null;
    datos.longitud = null;
  }

  const horarios = datos.horarios || [];
  const franja = franjaVigente(horarios, { ahora, margenMinutos });
  return {
    ...datos,
    horarios: agruparHorarios(horarios),
    horariosTexto: formatearHorarios(horarios),
    abiertaAhora: franja !== null,
    cierrePedidos: franja ? franja.cierrePedidos : null,
    segundosRestantes: franja ? franja.segundosRestantes : 0,
    proximaApertura: franja ? null : proximaApertura(horarios, { ahora }),
  };
};

/**
 * Normaliza el payload de horarios. Devuelve `null` cuando la clave no vino
 * (para no tocar lo persistido en un PUT parcial).
 * @throws {HorarioInvalidoError}
 */
function leerHorarios(horarios) {
  if (horarios === undefined) return null;
  return normalizarHorarios(horarios);
}

export const index = async (req, res) => {
  // `?activa=false` (ver también las inactivas) es para el staff que gestiona
  // sucursales: el ADMINISTRADOR (su panel de trabajo) y el SUPERADMINISTRADOR
  // (dueño del CRUD y de las bajas lógicas). El resto siempre ve solo activas.
  const soloActivas = req.query.activa !== 'false' || !esStaff(req);
  const where = soloActivas ? { activa: true } : {};
  const [sucursales, margenMinutos] = await Promise.all([
    Sucursal.findAll({
      where,
      include: includeSucursal,
      order: [['nombre', 'ASC']],
    }),
    obtenerValor('margenCierreMinutos'),
  ]);
  const ahora = new Date();
  res.json({
    success: true,
    data: sucursales.map((sucursal) =>
      serializar(sucursal, { margenMinutos, ahora })
    ),
  });
};

export const show = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id, {
    include: includeSucursal,
  });
  if (!sucursal) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  // Una sucursal inactiva solo la ve el staff que la gestiona (el público
  // recibe 404: para el catálogo no existe).
  if (!sucursal.activa && !esStaff(req)) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  const margenMinutos = await obtenerValor('margenCierreMinutos');
  return res.json({
    success: true,
    data: serializar(sucursal, { margenMinutos, ahora: new Date() }),
  });
};

export const create = async (req, res) => {
  const { nombre, direccion, telefono, horarios, activa } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'El nombre es obligatorio' });
  }
  if (!direccion || typeof direccion !== 'object' || Array.isArray(direccion)) {
    return res
      .status(400)
      .json({ success: false, error: 'La dirección es obligatoria' });
  }

  // El horario se valida ANTES de geocodificar y de abrir la transacción: un
  // payload inválido no debe gastar una llamada a Georef.
  let franjas;
  try {
    franjas = leerHorarios(
      horarios === undefined ? HORARIO_POR_DEFECTO : horarios
    );
  } catch (error) {
    if (error instanceof HorarioInvalidoError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    throw error;
  }
  if (franjas.length === 0) {
    return res.status(400).json({
      success: false,
      error:
        'Tenés que cargar al menos una franja de atención (para cerrar la sucursal usá el estado inactiva)',
    });
  }

  // Preparación (validación + geocodificación con Georef) ANTES de la
  // transacción: la dirección de sucursal exige coordenadas; los errores
  // tipados se traducen en el error handler (400/422/503).
  const { valores, coordenadas } = await prepararDireccion({
    datos: direccion,
  });
  // Toda la persistencia (sucursal + dirección + horarios) dentro de la misma
  // transacción: si falla, rollback y no queda nada parcial.
  const sucursal = await db.sequelize.transaction(async (t) => {
    const nueva = await Sucursal.create(
      {
        nombre: String(nombre).trim(),
        telefono: telefono ?? null,
        activa: activa !== undefined ? Boolean(activa) : true,
      },
      { transaction: t }
    );
    await persistirDireccionSucursal({
      sucursalId: nueva.id,
      valores,
      coordenadas,
      transaction: t,
    });
    await HorarioSucursal.bulkCreate(
      franjas.map((franja) => ({ ...franja, sucursalId: nueva.id })),
      { transaction: t }
    );
    return nueva;
  });
  const creada = await Sucursal.findByPk(sucursal.id, {
    include: includeSucursal,
  });
  const margenMinutos = await obtenerValor('margenCierreMinutos');
  // Post-commit: la sucursal nueva pudo abrir (o cerrar) el catálogo.
  emitirSucursalEstado({ sucursalId: Number(sucursal.id) });
  reprogramarVigiaHorarios();
  return res.status(201).json({
    success: true,
    data: serializar(creada, { margenMinutos, ahora: new Date() }),
  });
};

export const update = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id);
  if (!sucursal) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  const { nombre, direccion, telefono, horarios, activa } = req.body;

  let franjas;
  try {
    franjas = leerHorarios(horarios);
  } catch (error) {
    if (error instanceof HorarioInvalidoError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    throw error;
  }
  if (franjas !== null && franjas.length === 0) {
    return res.status(400).json({
      success: false,
      error:
        'Tenés que cargar al menos una franja de atención (para cerrar la sucursal usá el estado inactiva)',
    });
  }

  // Preparación ANTES de la transacción: validación parcial, detección de
  // cambios reales contra la dirección persistida y re-geocodificación solo si
  // cambió un campo de ubicación (cambios solo en alias/referencia o payload
  // idéntico no llaman a proveedores).
  let preparada = null;
  let existenteDireccion = null;
  if (direccion !== undefined) {
    if (
      !direccion ||
      typeof direccion !== 'object' ||
      Array.isArray(direccion)
    ) {
      return res
        .status(400)
        .json({ success: false, error: 'La dirección es obligatoria' });
    }
    existenteDireccion = await Direccion.findOne({
      where: { sucursalId: sucursal.id },
    });
    preparada = await prepararDireccion({
      datos: direccion,
      existente: existenteDireccion,
    });
  }
  const cambios = {};
  if (nombre !== undefined) {
    const nombreLimpio = String(nombre).trim();
    if (!nombreLimpio) {
      return res
        .status(400)
        .json({ success: false, error: 'El nombre no puede quedar vacío' });
    }
    cambios.nombre = nombreLimpio;
  }
  if (telefono !== undefined) {
    cambios.telefono = telefono ?? null;
  }
  if (activa !== undefined) {
    cambios.activa = Boolean(activa);
  }
  await db.sequelize.transaction(async (t) => {
    await sucursal.update(cambios, { transaction: t });
    if (preparada) {
      await persistirDireccionSucursal({
        sucursalId: sucursal.id,
        existente: existenteDireccion,
        valores: preparada.valores,
        coordenadas: preparada.coordenadas,
        transaction: t,
      });
    }
    // El horario se reemplaza completo: es más simple y seguro que diffear
    // franjas, y el payload del editor siempre manda el estado final del día.
    if (franjas !== null) {
      await HorarioSucursal.destroy({
        where: { sucursalId: sucursal.id },
        transaction: t,
      });
      await HorarioSucursal.bulkCreate(
        franjas.map((franja) => ({ ...franja, sucursalId: sucursal.id })),
        { transaction: t }
      );
    }
  });
  const actualizada = await Sucursal.findByPk(sucursal.id, {
    include: includeSucursal,
  });
  const margenMinutos = await obtenerValor('margenCierreMinutos');
  // Post-commit: pudo cambiar el horario o el estado activa/inactiva.
  emitirSucursalEstado({ sucursalId: Number(sucursal.id) });
  reprogramarVigiaHorarios();
  return res.json({
    success: true,
    data: serializar(actualizada, { margenMinutos, ahora: new Date() }),
  });
};

export const destroy = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id);
  if (!sucursal) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  await sucursal.update({ activa: false });
  // Baja lógica: deja de contar para el aviso de "todas cerradas".
  emitirSucursalEstado({ sucursalId: Number(sucursal.id) });
  reprogramarVigiaHorarios();
  return res.json({ success: true });
};
