/**
 * Service: insumos
 *
 * Reglas del catálogo corporativo de extras y condimentos y de su stock por
 * sucursal. El controller traduce HTTP; acá viven las validaciones y el alta
 * de filas de stock.
 *
 * El catálogo lo administra el SUPERADMINISTRADOR. El ADMINISTRADOR sólo
 * actualiza `cantidad`/`disponible` de su sucursal operativa.
 */
import { Op } from 'sequelize';
import db from '../models';

const {
  Insumo,
  InsumoStock,
  PersonalizacionCategoria,
  PersonalizacionElemento,
  Sucursal,
} = db;

export const TIPOS_VALIDOS = ['extra', 'condimento'];

export const normalizarTipo = (tipo) => String(tipo || '').toLowerCase();

export class InsumoInvalidoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InsumoInvalidoError';
    this.status = status;
  }
}

/**
 * Valida y normaliza los datos de un insumo.
 *
 * - `extra`: precio obligatorio, numérico y >= 0.
 * - `condimento`: gratis; cualquier precio recibido se ignora y se guarda null.
 *
 * @returns {{nombre: string, tipo: string, precio: number|null}}
 */
export function normalizarDatosInsumo({ nombre, tipo, precio }) {
  const nombreLimpio = String(nombre || '').trim();
  if (!nombreLimpio) {
    throw new InsumoInvalidoError('El nombre es obligatorio');
  }

  const tipoNormalizado = normalizarTipo(tipo);
  if (!TIPOS_VALIDOS.includes(tipoNormalizado)) {
    throw new InsumoInvalidoError('El tipo debe ser extra o condimento');
  }

  let precioFinal = null;
  if (tipoNormalizado === 'extra') {
    if (precio === null || precio === undefined || precio === '') {
      throw new InsumoInvalidoError('El precio es obligatorio para un extra');
    }
    precioFinal = Number(precio);
    if (!Number.isFinite(precioFinal) || precioFinal < 0) {
      throw new InsumoInvalidoError(
        'El precio debe ser un número mayor o igual a 0'
      );
    }
    precioFinal = Math.round(precioFinal * 100) / 100;
  }

  return { nombre: nombreLimpio, tipo: tipoNormalizado, precio: precioFinal };
}

/** Busca un insumo con el mismo nombre dentro del tipo, sin distinguir mayúsculas. */
async function buscarDuplicado(nombre, tipo, idExcluir = null, transaction) {
  const where = {
    tipo,
    nombre: { [Op.iLike]: nombre },
  };
  if (idExcluir) where.id = { [Op.ne]: idExcluir };
  return Insumo.findOne({ where, transaction });
}

/**
 * Da de alta un insumo y sus filas de stock en 0 en todas las sucursales
 * activas. Los insumos nuevos arrancan sin stock: el admin lo carga desde
 * Stock, no se regala mercadería.
 */
export async function crearInsumo(datos, { transaction } = {}) {
  const normalizado = normalizarDatosInsumo(datos);
  const duplicado = await buscarDuplicado(
    normalizado.nombre,
    normalizado.tipo,
    null,
    transaction
  );
  if (duplicado) {
    throw new InsumoInvalidoError(
      'Ya existe un insumo con ese nombre y tipo',
      409
    );
  }

  const ejecutar = async (t) => {
    const insumo = await Insumo.create(
      {
        nombre: normalizado.nombre,
        tipo: normalizado.tipo,
        precio: normalizado.precio,
        activo: datos.activo !== undefined ? Boolean(datos.activo) : true,
      },
      { transaction: t }
    );

    const sucursales = await Sucursal.findAll({
      where: { activa: true },
      attributes: ['id'],
      transaction: t,
    });
    if (sucursales.length > 0) {
      await InsumoStock.bulkCreate(
        sucursales.map((sucursal) => ({
          sucursalId: sucursal.id,
          insumoId: insumo.id,
          cantidad: 0,
          disponible: true,
        })),
        { transaction: t, ignoreDuplicates: true }
      );
    }
    return insumo;
  };

  if (transaction) return ejecutar(transaction);
  return db.sequelize.transaction(ejecutar);
}

/**
 * Actualiza un insumo existente. No permite cambiar el tipo si ya está
 * vinculado a elementos o plantillas: el vínculo quedaría apuntando a un tipo
 * distinto y el modal lo mostraría en la lista equivocada.
 */
export async function actualizarInsumo(insumo, datos, { transaction } = {}) {
  const tipoFinal =
    datos.tipo !== undefined ? normalizarTipo(datos.tipo) : insumo.tipo;
  const normalizado = normalizarDatosInsumo({
    nombre: datos.nombre !== undefined ? datos.nombre : insumo.nombre,
    tipo: tipoFinal,
    precio:
      datos.precio !== undefined
        ? datos.precio
        : tipoFinal === insumo.tipo
        ? insumo.precio
        : null,
  });

  if (normalizado.tipo !== insumo.tipo) {
    const [elementos, plantillas] = await Promise.all([
      PersonalizacionElemento.count({
        where: { insumoId: insumo.id },
        transaction,
      }),
      PersonalizacionCategoria.count({
        where: { insumoId: insumo.id },
        transaction,
      }),
    ]);
    if (elementos > 0 || plantillas > 0) {
      throw new InsumoInvalidoError(
        'No se puede cambiar el tipo de un insumo que ya está en uso',
        409
      );
    }
  }

  const duplicado = await buscarDuplicado(
    normalizado.nombre,
    normalizado.tipo,
    insumo.id,
    transaction
  );
  if (duplicado) {
    throw new InsumoInvalidoError(
      'Ya existe un insumo con ese nombre y tipo',
      409
    );
  }

  await insumo.update(
    {
      nombre: normalizado.nombre,
      tipo: normalizado.tipo,
      precio: normalizado.precio,
      ...(datos.activo !== undefined ? { activo: Boolean(datos.activo) } : {}),
    },
    { transaction }
  );
  return insumo;
}

/** Baja lógica: el insumo deja de ofrecerse pero conserva el histórico. */
export async function darDeBajaInsumo(insumo, { transaction } = {}) {
  await insumo.update({ activo: false }, { transaction });
  return insumo;
}

/**
 * Serializa una fila de `InsumoStock` con los datos que consume la pantalla de
 * Stock: nombre y tipo del insumo, cantidad y disponibilidad.
 */
export function serializarStockInsumo(fila) {
  const insumo = fila.insumo;
  return {
    sucursalId: Number(fila.sucursalId),
    sucursal: fila.sucursal ? fila.sucursal.nombre : undefined,
    insumoId: Number(fila.insumoId),
    insumo: insumo ? insumo.nombre : undefined,
    tipo: insumo ? insumo.tipo : undefined,
    precio: insumo ? Number(insumo.precio ?? 0) : undefined,
    cantidad: Number(fila.cantidad),
    disponible: Boolean(fila.disponible),
  };
}

/**
 * Garantiza que la sucursal tenga una fila por cada insumo activo. Las
 * sucursales creadas después de un insumo no tienen fila; sin esto el admin no
 * podría cargarles cantidad.
 */
async function asegurarFilasDeLaSucursal(sucursalId, transaction) {
  await db.sequelize.query(
    `INSERT INTO "InsumoStocks" ("sucursalId", "insumoId", "cantidad", "disponible", "createdAt", "updatedAt")
     SELECT :sucursalId, i."id", 0, true, NOW(), NOW()
     FROM "Insumos" AS i
     WHERE i."activo" = true
     ON CONFLICT ("sucursalId", "insumoId") DO NOTHING`,
    { replacements: { sucursalId: Number(sucursalId) }, transaction }
  );
}

/** Stock de insumos de una sucursal, listo para la pantalla de Stock. */
export async function listarStockDeSucursal(
  sucursalId,
  { tipo, transaction } = {}
) {
  await asegurarFilasDeLaSucursal(sucursalId, transaction);

  const whereInsumo = { activo: true };
  if (tipo) {
    const tipoNormalizado = normalizarTipo(tipo);
    if (!TIPOS_VALIDOS.includes(tipoNormalizado)) {
      throw new InsumoInvalidoError('Tipo inválido');
    }
    whereInsumo.tipo = tipoNormalizado;
  }

  const filas = await InsumoStock.findAll({
    where: { sucursalId: Number(sucursalId) },
    include: [
      {
        model: Insumo,
        as: 'insumo',
        where: whereInsumo,
        required: true,
      },
      {
        model: Sucursal,
        as: 'sucursal',
        attributes: ['id', 'nombre'],
        required: true,
      },
    ],
    order: [
      [{ model: Insumo, as: 'insumo' }, 'tipo', 'ASC'],
      [{ model: Insumo, as: 'insumo' }, 'nombre', 'ASC'],
    ],
    transaction,
  });

  return filas.map(serializarStockInsumo);
}

/**
 * Actualiza cantidad y/o disponibilidad de un insumo en una sucursal.
 * La fila se crea si no existe (sucursal nueva, insumo recién creado).
 */
export async function actualizarStockDeInsumo(
  sucursalId,
  insumoId,
  cambios = {},
  { transaction } = {}
) {
  const insumo = await Insumo.findByPk(insumoId, { transaction });
  if (!insumo || !insumo.activo) {
    throw new InsumoInvalidoError('Insumo no encontrado', 404);
  }

  const tieneCantidad = cambios.cantidad !== undefined;
  const tieneDisponible = cambios.disponible !== undefined;
  if (!tieneCantidad && !tieneDisponible) {
    throw new InsumoInvalidoError('No hay cambios para aplicar');
  }

  let cantidad = null;
  if (tieneCantidad) {
    cantidad = Number(cambios.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      throw new InsumoInvalidoError(
        'La cantidad debe ser un entero mayor o igual a 0'
      );
    }
  }

  const [fila] = await InsumoStock.findOrCreate({
    where: {
      sucursalId: Number(sucursalId),
      insumoId: Number(insumoId),
    },
    defaults: { cantidad: 0, disponible: true },
    transaction,
  });

  await fila.update(
    {
      ...(tieneCantidad ? { cantidad } : {}),
      ...(tieneDisponible ? { disponible: Boolean(cambios.disponible) } : {}),
    },
    { transaction }
  );

  // Se relee con las asociaciones para devolver el mismo shape que el listado.
  const completa = await InsumoStock.findOne({
    where: {
      sucursalId: Number(sucursalId),
      insumoId: Number(insumoId),
    },
    include: [
      { model: Insumo, as: 'insumo', required: true },
      { model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] },
    ],
    transaction,
  });
  return serializarStockInsumo(completa);
}
