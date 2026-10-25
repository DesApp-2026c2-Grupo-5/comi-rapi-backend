import db from '../models';
import {
  borrarComponentes,
  guardarComponentes,
  obtenerComponentesDeCombos,
} from '../services/combo';
import {
  inicializarStockDeCombo,
  sincronizarCantidadDeCombos,
} from '../services/stock';
import { obtenerMasVendidosDelDia } from '../services/mas_vendidos';
import { copiarPlantillasAProducto } from '../services/personalizacion_categorias';
import {
  normalizarIngredientes,
  reemplazarIngredientes,
} from '../services/ingredientes';
import { resumenDeProducto } from '../services/resenas';
import { sucursalDeSesion } from '../middlewares/auth';
import { emitirCatalogoActualizado, emitirStockActualizado } from '../realtime';

const { Categoria, PersonalizacionElemento, Producto } = db;

const TIPOS_VALIDOS = ['PRODUCTO', 'COMBO'];

const serializar = (producto, componentes, personalizacion) => ({
  id: producto.id,
  nombre: producto.nombre,
  precio: Number(producto.precio),
  categoria: producto.Categoria ? producto.Categoria.nombre : null,
  categoriaId: producto.categoriaId,
  imagen: producto.imagen,
  descripcion: producto.descripcion,
  activo: producto.activo,
  tipo: producto.tipo,
  ...(componentes ? { componentes } : {}),
  ...(personalizacion ? { personalizacion } : {}),
});

const withCategoria = {
  model: Categoria,
  as: 'Categoria',
};

async function resolverCategoria(categoriaId, categoriaNombre) {
  if (categoriaId) {
    const categoria = await Categoria.findByPk(categoriaId);
    if (!categoria) {
      throw new Error('Categoría no encontrada');
    }
    return { id: categoria.id, nombre: categoria.nombre };
  }
  if (categoriaNombre) {
    const categoria = await Categoria.findOne({
      where: { nombre: String(categoriaNombre) },
    });
    if (!categoria) {
      throw new Error(`Categoría "${categoriaNombre}" no encontrada`);
    }
    return { id: categoria.id, nombre: categoria.nombre };
  }
  throw new Error('La categoría es obligatoria');
}

/** Nombre de la categoría donde viven los combos. */
const CATEGORIA_COMBOS = 'Combos';

/**
 * Categoría obligatoria de un combo.
 *
 * Un combo siempre se categoriza como "Combos": es lo que espera el catálogo,
 * donde las pestañas son por categoría. Aceptar otra categoría dejaría el combo
 * oculto de la pestaña correcta, así que la API la impone en vez de confiar en
 * lo que manda el cliente.
 */
async function resolverCategoriaDeCombo({ transaction } = {}) {
  const categoria = await Categoria.findOne({
    where: { nombre: CATEGORIA_COMBOS },
    transaction,
  });
  if (!categoria) {
    throw new Error(
      `No se encontró la categoría "${CATEGORIA_COMBOS}", necesaria para los combos`
    );
  }
  return categoria;
}

export const index = async (req, res) => {
  const productos = await Producto.findAll({
    where: { activo: true },
    include: [withCategoria],
    order: [['nombre', 'ASC']],
  });
  const recetas = await obtenerComponentesDeCombos(
    productos.filter((p) => p.tipo === 'COMBO').map((p) => p.id)
  );
  res.json({
    success: true,
    data: productos.map((producto) =>
      producto.tipo === 'COMBO'
        ? serializar(producto, recetas.get(producto.id) ?? [])
        : serializar(producto)
    ),
  });
};

/**
 * Productos más vendidos del día, para la sección de la portada.
 *
 * Es público a propósito: la portada se ve sin iniciar sesión. Devuelve el mismo
 * formato que el catálogo, más `vendidos`, para que el cliente pueda ordenar y
 * completar los huecos sin pedir los productos sueltos.
 */
export const masVendidos = async (req, res) => {
  const ranked = await obtenerMasVendidosDelDia();
  const recetas = await obtenerComponentesDeCombos(
    ranked.map((item) => item.producto.id)
  );
  res.json({
    success: true,
    data: ranked.map(({ producto, vendidos }) => ({
      ...(producto.tipo === 'COMBO'
        ? serializar(producto, recetas.get(producto.id) ?? [])
        : serializar(producto)),
      vendidos,
    })),
  });
};

export const show = async (req, res) => {
  const producto = await Producto.findByPk(req.params.id, {
    include: [withCategoria],
  });
  if (!producto) {
    return res
      .status(404)
      .json({ success: false, error: 'Producto no encontrado' });
  }
  const recetas = await obtenerComponentesDeCombos([producto.id]);
  // Personalización activa del producto (extras, quitables, acompañamientos,
  // condimentos): el detalle la muestra sin otra llamada.
  const elementos = await PersonalizacionElemento.findAll({
    where: { productoId: producto.id, activo: true },
    order: [['id', 'ASC']],
  });
  const personalizacion = elementos.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    nombre: e.nombre,
    precio: e.precio !== null ? Number(e.precio) : null,
    productoReferenciaId: e.productoReferenciaId,
    minimo: e.minimo,
    maximo: e.maximo,
  }));
  // Resumen de reseñas para las estrellas de la ficha (el listado completo se
  // pide aparte a GET /api/productos/:id/resenas).
  const resenas = await resumenDeProducto(producto.id);
  const data =
    producto.tipo === 'COMBO'
      ? serializar(producto, recetas.get(producto.id) ?? [], personalizacion)
      : serializar(producto, undefined, personalizacion);
  return res.json({
    success: true,
    data: { ...data, resenas },
  });
};

export const create = async (req, res) => {
  const {
    nombre,
    precio,
    imagen,
    descripcion,
    categoria,
    categoriaId,
    tipo,
    componentes,
    ingredientes,
  } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'El nombre es obligatorio' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({
      success: false,
      error: 'El tipo es obligatorio (PRODUCTO o COMBO)',
    });
  }
  if (tipo === 'PRODUCTO' && componentes !== undefined) {
    return res.status(400).json({
      success: false,
      error: 'Solo un combo puede tener componentes',
    });
  }
  if (
    precio === undefined ||
    Number.isNaN(Number(precio)) ||
    Number(precio) < 0
  ) {
    return res.status(400).json({
      success: false,
      error: 'El precio debe ser un número mayor o igual a 0',
    });
  }
  // Los ingredientes son una lista opcional de nombres. `null` = no se mandó
  // (cliente viejo); `[]` = el admin los dejó vacíos a propósito.
  let ingredientesNormalizados;
  try {
    ingredientesNormalizados = normalizarIngredientes(ingredientes);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  if (tipo === 'COMBO' && ingredientesNormalizados?.length) {
    return res.status(400).json({
      success: false,
      error: 'Un combo no lleva ingredientes: se compone de productos',
    });
  }
  let categoriaResuelta;
  try {
    // El combo no elige categoría: se fuerza "Combos".
    categoriaResuelta =
      tipo === 'COMBO'
        ? await resolverCategoriaDeCombo()
        : await resolverCategoria(categoriaId, categoria);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  // Producto y receta van juntos: si la receta es inválida no queda un combo
  // guardado a medias.
  let resultado;
  try {
    resultado = await db.sequelize.transaction(async (t) => {
      const producto = await Producto.create(
        {
          nombre: String(nombre).trim(),
          precio: Number(precio),
          imagen,
          descripcion,
          categoriaId: categoriaResuelta.id,
          activo: true,
          tipo,
        },
        { transaction: t }
      );
      let filasStock = [];
      if (tipo === 'COMBO') {
        const receta = await guardarComponentes(producto.id, componentes, {
          transaction: t,
        });
        // El combo entra en venta solo, con el tope que da el stock de sus
        // componentes en cada sucursal. Sin esto quedaba sin fila en `Stocks` y
        // no se podía comprar en ninguna.
        // Desde la aislación por sucursal, el admin lo da de alta solo en su
        // propio local: no escribe stock en sucursales que no son suyas.
        filasStock = await inicializarStockDeCombo(producto.id, receta, {
          transaction: t,
          sucursalId: sucursalDeSesion(req),
        });
      }
      // Plantillas por categoría: el producto nace con la personalización por
      // defecto configurada por el superadmin (extras, condimentos, etc.).
      await copiarPlantillasAProducto({
        productoId: producto.id,
        categoriaId: categoriaResuelta.id,
        transaction: t,
      });
      // Ingredientes propios del producto (opcionales), cargados en el alta.
      if (ingredientesNormalizados !== null) {
        await reemplazarIngredientes(producto.id, ingredientesNormalizados, {
          transaction: t,
        });
      }
      return { id: producto.id, filasStock };
    });
  } catch (error) {
    // Las reglas de la receta (mínimo de componentes, repetidos, producto
    // inexistente) y el CHECK de cantidad salen de acá. Sin este catch el
    // middleware de errores los respondía como 500 genérico y el admin veía
    // "Error interno del servidor" en vez de qué corregir.
    return res.status(400).json({ success: false, error: error.message });
  }
  const conCategoria = await Producto.findByPk(resultado.id, {
    include: [withCategoria],
  });
  const recetas = await obtenerComponentesDeCombos([resultado.id]);
  emitirCatalogoActualizado({
    tipo: 'producto',
    id: resultado.id,
    accion: 'creado',
  });
  // Las filas creadas son todas de la sucursal del admin que creó el combo
  // (aislación por sucursal): su admin se entera por stock_actualizado.
  if (resultado.filasStock.length > 0) {
    emitirStockActualizado(resultado.filasStock[0].sucursalId, {
      productoIds: [Number(resultado.id)],
    });
  }
  return res.status(201).json({
    success: true,
    data:
      tipo === 'COMBO'
        ? serializar(conCategoria, recetas.get(resultado.id) ?? [])
        : serializar(conCategoria),
  });
};

export const update = async (req, res) => {
  const {
    nombre,
    precio,
    imagen,
    descripcion,
    categoria,
    categoriaId,
    activo,
    tipo,
    componentes,
    ingredientes,
  } = req.body;
  const producto = await Producto.findByPk(req.params.id, {
    include: [withCategoria],
  });
  if (!producto) {
    return res
      .status(404)
      .json({ success: false, error: 'Producto no encontrado' });
  }
  const cambios = {};
  if (nombre !== undefined) {
    if (!String(nombre).trim()) {
      return res
        .status(400)
        .json({ success: false, error: 'El nombre no puede quedar vacío' });
    }
    cambios.nombre = String(nombre).trim();
  }
  if (precio !== undefined) {
    if (Number.isNaN(Number(precio)) || Number(precio) < 0) {
      return res.status(400).json({
        success: false,
        error: 'El precio debe ser un número mayor o igual a 0',
      });
    }
    cambios.precio = Number(precio);
  }
  if (imagen !== undefined) {
    cambios.imagen = imagen;
  }
  if (descripcion !== undefined) {
    cambios.descripcion = descripcion;
  }
  if (activo !== undefined) {
    cambios.activo = Boolean(activo);
  }
  const tipoFinal = tipo !== undefined ? tipo : producto.tipo;
  if (tipo !== undefined) {
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({
        success: false,
        error: 'El tipo debe ser PRODUCTO o COMBO',
      });
    }
    cambios.tipo = tipo;
  }
  if (tipoFinal === 'PRODUCTO' && componentes !== undefined) {
    return res.status(400).json({
      success: false,
      error: 'Solo un combo puede tener componentes',
    });
  }
  let ingredientesNormalizados;
  try {
    ingredientesNormalizados = normalizarIngredientes(ingredientes);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  if (tipoFinal === 'COMBO' && ingredientesNormalizados?.length) {
    return res.status(400).json({
      success: false,
      error: 'Un combo no lleva ingredientes: se compone de productos',
    });
  }
  // Pasar a COMBO exige receta: un combo sin componentes no se puede vender ni
  // calcular su disponibilidad.
  if (
    producto.tipo === 'PRODUCTO' &&
    tipoFinal === 'COMBO' &&
    componentes === undefined
  ) {
    return res.status(400).json({
      success: false,
      error:
        'Para convertir el producto en combo hay que pasar sus componentes',
    });
  }
  if (tipoFinal === 'COMBO') {
    // Se mantiene en "Combos" aunque el request mande otra categoría.
    try {
      const categoriaCombo = await resolverCategoriaDeCombo();
      cambios.categoriaId = categoriaCombo.id;
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  } else if (categoria !== undefined || categoriaId !== undefined) {
    const categoriaActual = producto.Categoria;
    let categoriaResuelta;
    try {
      categoriaResuelta = await resolverCategoria(
        categoriaId,
        categoria ?? (categoriaActual ? categoriaActual.nombre : undefined)
      );
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
    cambios.categoriaId = categoriaResuelta.id;
  }
  // Cambios de datos y receta en la misma transacción: un combo no queda con
  // datos nuevos y receta vieja (o al revés).
  let filasCombo = [];
  try {
    filasCombo = await db.sequelize.transaction(async (t) => {
      await producto.update(cambios, { transaction: t });
      if (ingredientesNormalizados !== null) {
        await reemplazarIngredientes(producto.id, ingredientesNormalizados, {
          transaction: t,
        });
      }
      if (tipoFinal === 'COMBO' && componentes !== undefined) {
        await guardarComponentes(producto.id, componentes, { transaction: t });
      } else if (tipoFinal === 'PRODUCTO') {
        // Dejó de ser combo: su receta ya no significa nada.
        await borrarComponentes(producto.id, { transaction: t });
      }
      // La cantidad de un combo se deriva de su receta, así que hay que
      // recalcular la de todas las sucursales: cambiar la receta cambia cuántos
      // combos se pueden armar. Devuelve las filas cuya cantidad cambió.
      return sincronizarCantidadDeCombos([producto.id], { transaction: t });
    });
  } catch (error) {
    // Mismo motivo que en `create`: los errores de la receta son del admin, no
    // una falla del servidor.
    return res.status(400).json({ success: false, error: error.message });
  }
  // Cambiar la receta puede bajar la cantidad del combo (o la de otros combos
  // que lo usan como componente) en varias sucursales: transacción commiteada,
  // recién ahora cada una recibe su aviso.
  const porSucursal = new Map();
  for (const fila of filasCombo) {
    if (!porSucursal.has(fila.sucursalId)) {
      porSucursal.set(fila.sucursalId, new Set());
    }
    porSucursal.get(fila.sucursalId).add(Number(fila.productoId));
  }
  for (const [sucursalId, ids] of porSucursal) {
    emitirStockActualizado(sucursalId, { productoIds: [...ids] });
  }
  const actualizado = await Producto.findByPk(producto.id, {
    include: [withCategoria],
  });
  const recetas = await obtenerComponentesDeCombos([producto.id]);
  emitirCatalogoActualizado({
    tipo: 'producto',
    id: producto.id,
    accion: 'actualizado',
  });
  return res.json({
    success: true,
    data:
      tipoFinal === 'COMBO'
        ? serializar(actualizado, recetas.get(producto.id) ?? [])
        : serializar(actualizado),
  });
};

export const destroy = async (req, res) => {
  const producto = await Producto.findByPk(req.params.id);
  if (!producto) {
    return res
      .status(404)
      .json({ success: false, error: 'Producto no encontrado' });
  }
  await producto.update({ activo: false });
  emitirCatalogoActualizado({
    tipo: 'producto',
    id: producto.id,
    accion: 'eliminado',
  });
  return res.json({ success: true });
};
