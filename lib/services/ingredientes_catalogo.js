/**
 * Service: ingredientes
 *
 * Catálogo corporativo de materias primas que forman la receta de los
 * productos (modelo-dominio §5.8.2). El controller traduce HTTP; acá viven las
 * validaciones y el alta de las filas de stock en 0.
 *
 * Reglas:
 * - `nombre` obligatorio y único sin distinguir mayúsculas.
 * - `unidadMedida` en `unidad`, `g`, `kg`, `ml` o `l`, sin conversión.
 * - La unidad no se puede cambiar si el ingrediente ya tiene stock positivo o
 *   recetas cargadas: las cantidades existentes quedarían mal interpretadas.
 * - La baja es lógica (`activo = false`); no se borra físicamente.
 */
import { Op, fn, col } from 'sequelize';
import db from '../models';

const { Ingrediente, IngredienteStock, ProductoIngrediente, Sucursal } = db;

export const UNIDADES_VALIDAS = ['unidad', 'g', 'kg', 'ml', 'l'];

export class IngredienteInvalidoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'IngredienteInvalidoError';
    this.status = status;
  }
}

/** Valida y normaliza los datos de un ingrediente. */
export function normalizarDatosIngrediente({ nombre, unidadMedida, activo }) {
  const nombreLimpio = String(nombre || '').trim();
  if (!nombreLimpio) {
    throw new IngredienteInvalidoError('El nombre es obligatorio');
  }

  const unidad = String(unidadMedida || '').toLowerCase();
  if (!UNIDADES_VALIDAS.includes(unidad)) {
    throw new IngredienteInvalidoError(
      'La unidad de medida debe ser unidad, g, kg, ml o l'
    );
  }

  return {
    nombre: nombreLimpio,
    unidadMedida: unidad,
    ...(activo !== undefined ? { activo: Boolean(activo) } : {}),
  };
}

/** Busca un ingrediente con el mismo nombre, sin distinguir mayúsculas. */
async function buscarDuplicado(nombre, idExcluir = null, transaction) {
  const where = { nombre: { [Op.iLike]: nombre } };
  if (idExcluir) where.id = { [Op.ne]: idExcluir };
  return Ingrediente.findOne({ where, transaction });
}

/**
 * Da de alta un ingrediente y sus filas de stock en 0 en todas las sucursales
 * activas. Las sucursales nuevas se completan al listar su stock.
 */
export async function crearIngrediente(datos, { transaction } = {}) {
  const normalizado = normalizarDatosIngrediente(datos);
  const duplicado = await buscarDuplicado(
    normalizado.nombre,
    null,
    transaction
  );
  if (duplicado) {
    throw new IngredienteInvalidoError(
      'Ya existe un ingrediente con ese nombre',
      409
    );
  }

  const ejecutar = async (t) => {
    const ingrediente = await Ingrediente.create(
      { ...normalizado, activo: normalizado.activo ?? true },
      { transaction: t }
    );

    const sucursales = await Sucursal.findAll({
      where: { activa: true },
      attributes: ['id'],
      transaction: t,
    });
    if (sucursales.length > 0) {
      await IngredienteStock.bulkCreate(
        sucursales.map((sucursal) => ({
          sucursalId: sucursal.id,
          ingredienteId: ingrediente.id,
          cantidad: 0,
          disponible: true,
        })),
        { transaction: t, ignoreDuplicates: true }
      );
    }
    return ingrediente;
  };

  if (transaction) return ejecutar(transaction);
  return db.sequelize.transaction(ejecutar);
}

/**
 * Actualiza un ingrediente existente. Bloquea el cambio de unidad si ya hay
 * stock positivo o recetas cargadas.
 */
export async function actualizarIngrediente(
  ingrediente,
  datos,
  { transaction } = {}
) {
  const normalizado = normalizarDatosIngrediente({
    nombre: datos.nombre !== undefined ? datos.nombre : ingrediente.nombre,
    unidadMedida:
      datos.unidadMedida !== undefined
        ? datos.unidadMedida
        : ingrediente.unidadMedida,
    activo: datos.activo !== undefined ? datos.activo : ingrediente.activo,
  });

  if (normalizado.unidadMedida !== ingrediente.unidadMedida) {
    const [stock, recetas] = await Promise.all([
      IngredienteStock.count({
        where: { ingredienteId: ingrediente.id, cantidad: { [Op.gt]: 0 } },
        transaction,
      }),
      ProductoIngrediente.count({
        where: { ingredienteId: ingrediente.id },
        transaction,
      }),
    ]);
    if (stock > 0 || recetas > 0) {
      throw new IngredienteInvalidoError(
        'No se puede cambiar la unidad de un ingrediente con stock o recetas cargadas',
        409
      );
    }
  }

  const duplicado = await buscarDuplicado(
    normalizado.nombre,
    ingrediente.id,
    transaction
  );
  if (duplicado) {
    throw new IngredienteInvalidoError(
      'Ya existe un ingrediente con ese nombre',
      409
    );
  }

  await ingrediente.update(normalizado, { transaction });
  return ingrediente;
}

/** Baja lógica: el ingrediente deja de ofrecerse pero conserva recetas y stock. */
export async function darDeBajaIngrediente(ingrediente, { transaction } = {}) {
  await ingrediente.update({ activo: false }, { transaction });
  return ingrediente;
}

/**
 * Datos de uso que necesita el ABM: si tiene recetas y si tiene stock positivo
 * en alguna sucursal. Se agregan en una sola consulta para el listado.
 */
async function usosDeIngredientes(ids, transaction) {
  if (ids.length === 0) {
    return { recetas: new Map(), stock: new Map() };
  }

  const [recetas, stocks] = await Promise.all([
    ProductoIngrediente.findAll({
      attributes: ['ingredienteId', [fn('COUNT', col('productoId')), 'total']],
      where: { ingredienteId: { [Op.in]: ids } },
      group: ['ingredienteId'],
      raw: true,
      transaction,
    }),
    IngredienteStock.findAll({
      attributes: ['ingredienteId', [fn('SUM', col('cantidad')), 'total']],
      where: {
        ingredienteId: { [Op.in]: ids },
        cantidad: { [Op.gt]: 0 },
      },
      group: ['ingredienteId'],
      raw: true,
      transaction,
    }),
  ]);

  return {
    recetas: new Map(
      recetas.map((fila) => [Number(fila.ingredienteId), Number(fila.total)])
    ),
    stock: new Map(
      stocks.map((fila) => [
        Number(fila.ingredienteId),
        Number(fila.total ?? 0),
      ])
    ),
  };
}

/** Serializa un ingrediente con sus datos de uso. */
function serializarIngrediente(ingrediente, usos) {
  const id = Number(ingrediente.id);
  return {
    id,
    nombre: ingrediente.nombre,
    unidadMedida: ingrediente.unidadMedida,
    activo: Boolean(ingrediente.activo),
    enUso: (usos.recetas.get(id) || 0) > 0,
    recetas: usos.recetas.get(id) || 0,
    stockTotal: usos.stock.get(id) || 0,
  };
}

/** Lista ingredientes. El público sólo ve los activos. */
export async function listarIngredientes({ activo, transaction } = {}) {
  const where = {};
  if (activo !== undefined) where.activo = Boolean(activo);

  const ingredientes = await Ingrediente.findAll({
    where,
    order: [['nombre', 'ASC']],
    transaction,
  });
  const usos = await usosDeIngredientes(
    ingredientes.map((ingrediente) => Number(ingrediente.id)),
    transaction
  );
  return ingredientes.map((ingrediente) =>
    serializarIngrediente(ingrediente, usos)
  );
}

/** Devuelve un ingrediente con sus datos de uso o lanza 404. */
export async function obtenerIngrediente(id, { transaction } = {}) {
  const ingrediente = await Ingrediente.findByPk(id, { transaction });
  if (!ingrediente) {
    throw new IngredienteInvalidoError('Ingrediente no encontrado', 404);
  }
  const usos = await usosDeIngredientes([Number(ingrediente.id)], transaction);
  return serializarIngrediente(ingrediente, usos);
}
