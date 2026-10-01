/**
 * Service: stock
 *
 * El stock es por sucursal (DER §2.10): la PK compuesta (sucursalId,
 * productoId) hace que cada sucursal tenga su propia cantidad de cada producto.
 *
 * Decisión de dominio (cierra el pendiente de docs/modelo-dominio §7.2 y
 * docs/DER.md §8): la disponibilidad de un combo se deriva del stock de sus
 * componentes. Un combo se ofrece hasta donde da la receta:
 *
 *     max = min( floor(cantidad del componente / cantidad que lleva la receta) )
 *
 * El combo tiene fila propia en `Stocks`, pero su `cantidad` es un tope que
 * puso el admin, no la garantía de que se pueda armar. Lo que se vende de verdad
 * es `min(cantidad cargada del combo, max derivado de los componentes)`. Así,
 * si a un componente se le baja el stock o se da de baja, el combo se limita
 * solo, sin scripts de reparación.
 *
 * Un combo en venta descuenta las dos cosas: su propia unidad y las unidades de
 * cada componente de la receta. Los descuentos son atómicos
 * (`UPDATE ... WHERE cantidad >= n`) para que dos pedidos simultáneos sobre la
 * última unidad no sobrevendan.
 */

import db from '../models';
import { Op, literal } from 'sequelize';

const { Stock, Producto, Sucursal } = db;

/** Unidades que la sucursal ofrece de un producto: si no lo ofrece, 0. */
function cantidadOfrecida(stock) {
  if (!stock) return 0;
  return stock.disponible ? stock.cantidad : 0;
}

/**
 * Máximo de combos que sale del stock dado para una receta.
 * Función pura: no toca la base, se puede testear sola.
 *
 * @param {Array<{productoId: number, cantidad: number}>} componentes
 * @param {Map<number, number>|Object<number, number>} cantidades
 */
export function maximoDeCombosDeReceta(componentes, cantidades) {
  if (!Array.isArray(componentes) || componentes.length === 0) return 0;
  const leer = (productoId) => {
    if (cantidades instanceof Map) {
      return Number(cantidades.get(Number(productoId)) ?? 0);
    }
    return Number(cantidades?.[productoId] ?? 0);
  };
  return componentes.reduce((minimo, componente) => {
    const porEste = Math.floor(
      leer(componente.productoId) / componente.cantidad
    );
    return Math.min(minimo, porEste);
  }, Infinity);
}

/** Receta de un combo como `[{productoId, cantidad}]`, o `null` si no es combo. */
async function recetaDe(comboId, transaction) {
  const combo = await Producto.findByPk(comboId, { transaction });
  if (!combo || combo.tipo !== 'COMBO') return null;
  const componentes = await combo.getComponentes({ transaction });
  if (componentes.length === 0) return null;
  return componentes.map((c) => ({
    productoId: c.productoId,
    cantidad: c.cantidad,
  }));
}

/** Cantidades que la sucursal ofrece de los productos de una receta. */
async function cantidadesDeRecetaEnSucursal(receta, sucursalId, transaction) {
  const stocks = await Stock.findAll({
    where: {
      sucursalId: Number(sucursalId),
      productoId: receta.map((c) => c.productoId),
    },
    transaction,
  });
  const cantidades = new Map();
  stocks.forEach((stock) =>
    cantidades.set(stock.productoId, cantidadOfrecida(stock))
  );
  return cantidades;
}

/**
 * Máximo de combos que una sucursal puede armar con su stock actual.
 * Si al combo le falta un componente en esa sucursal, el máximo es 0.
 */
export async function maximoDeCombosPorSucursal(
  comboId,
  sucursalId,
  { transaction } = {}
) {
  const receta = await recetaDe(comboId, transaction);
  if (!receta) return 0;
  const cantidades = await cantidadesDeRecetaEnSucursal(
    receta,
    sucursalId,
    transaction
  );
  return maximoDeCombosDeReceta(receta, cantidades);
}

/**
 * Máximo de combos por cada sucursal activa a partir de una receta suelta (sin
 * combo guardado todavía), con el detalle de qué frena a cada sucursal. Es lo
 * que necesita el formulario mientras el admin elige cuántos combos ofrece.
 *
 * @param {Array<{productoId: number, cantidad: number}>} componentes
 * @param {{transaction?: object}} [opciones]
 * @returns {Promise<Array<{sucursalId, sucursal, maximo, detalle}>>}
 */
export async function maximosDeRecetaPorSucursal(
  componentes,
  { transaction } = {}
) {
  const receta = (componentes || [])
    .map((c) => ({
      productoId: Number(c?.productoId),
      cantidad: Number(c?.cantidad ?? 1),
    }))
    .filter(
      (c) =>
        Number.isInteger(c.productoId) && c.productoId > 0 && c.cantidad > 0
    );
  if (receta.length === 0) return [];

  const sucursales = await Sucursal.findAll({
    where: { activa: true },
    order: [['id', 'ASC']],
    transaction,
  });
  const productos = await Producto.findAll({
    where: { id: receta.map((c) => c.productoId) },
    attributes: ['id', 'nombre'],
    transaction,
  });
  const nombres = new Map(productos.map((p) => [p.id, p.nombre]));
  const stocks = await Stock.findAll({
    where: { productoId: receta.map((c) => c.productoId) },
    transaction,
  });
  const porSucursal = new Map();
  stocks.forEach((stock) => {
    if (!porSucursal.has(stock.sucursalId)) {
      porSucursal.set(stock.sucursalId, new Map());
    }
    porSucursal
      .get(stock.sucursalId)
      .set(stock.productoId, cantidadOfrecida(stock));
  });

  return sucursales.map((sucursal) => {
    const cantidades = porSucursal.get(sucursal.id) ?? new Map();
    return {
      sucursalId: sucursal.id,
      sucursal: sucursal.nombre,
      maximo: maximoDeCombosDeReceta(receta, cantidades),
      detalle: receta.map((componente) => ({
        productoId: componente.productoId,
        producto:
          nombres.get(componente.productoId) ??
          `producto ${componente.productoId}`,
        seNecesitan: componente.cantidad,
        hay: cantidades.get(componente.productoId) ?? 0,
      })),
    };
  });
}

/**
 * Cuántos combos se pueden vender realmente en una sucursal: lo que el admin
 * cargó, acotado por lo que da el stock de los componentes.
 */
export async function combosOfrecidos(
  comboId,
  sucursalId,
  { transaction } = {}
) {
  const stock = await Stock.findOne({
    where: { sucursalId: Number(sucursalId), productoId: comboId },
    transaction,
  });
  if (!stock || !stock.disponible) return 0;
  const maximo = await maximoDeCombosPorSucursal(comboId, sucursalId, {
    transaction,
  });
  return Math.min(stock.cantidad, maximo);
}

/**
 * Valida la cantidad de combos que se pone en venta en cada sucursal contra el
 * stock de esa sucursal.
 *
 * @param {number} comboId
 * @param {Array<{sucursalId: number, cantidad: number}>} cantidades
 */
export async function validarCantidadDeCombosEnVenta(
  comboId,
  cantidades,
  { transaction } = {}
) {
  if (!Array.isArray(cantidades) || cantidades.length === 0) return [];
  const sucursales = await Sucursal.findAll({
    where: { id: cantidades.map((c) => Number(c.sucursalId)) },
    transaction,
  });
  const porId = new Map(sucursales.map((s) => [s.id, s]));
  const validadas = [];
  for (const entrada of cantidades) {
    const sucursalId = Number(entrada?.sucursalId);
    const cantidad = Number(entrada?.cantidad);
    const sucursal = porId.get(sucursalId);
    if (!sucursal) {
      throw new Error(`La sucursal ${sucursalId} no existe`);
    }
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      throw new Error(
        `La cantidad de combos de "${sucursal.nombre}" tiene que ser 0 o más`
      );
    }
    const maximo = await maximoDeCombosPorSucursal(comboId, sucursalId, {
      transaction,
    });
    if (cantidad > maximo) {
      throw new Error(
        `"${sucursal.nombre}" puede armar ${maximo} ${
          maximo === 1 ? 'combo' : 'combos'
        } con su stock actual, no ${cantidad}`
      );
    }
    validadas.push({ sucursalId, cantidad, maximo });
  }
  return validadas;
}

/**
 * Le da al combo su fila de stock en las sucursales activas, con el tope que
 * sale del stock actual de sus componentes.
 *
 * Se llama al crear un combo. Un producto nace sin fila en `Stocks`: hasta que
 * la sucursal lo agrega a su catálogo no se puede pedir. Para un combo eso lo
 * dejaba vendido en ninguna parte apenas se creaba, porque su disponibilidad es
 * `min(fila del combo, stock de los componentes)` y sin fila el mínimo da 0. El
 * cliente armaba el pedido y se enteraba con un "stock insuficiente" al pagar.
 *
 * La cantidad inicial es el máximo que da el stock de los componentes en cada
 * sucursal, así el combo entra en venta solo. Si más adelante sube el stock de
 * los componentes, el tope no sube solo: lo sube el admin desde la pantalla de
 * Stock.
 *
 * Las filas que ya existen no se tocan: si el admin cargó un tope, se respeta.
 *
 * @param {number} comboId
 * @param {Array<{productoId: number, cantidad: number}>} componentes
 * @returns {Promise<Array<{sucursalId, productoId, cantidad}>>} filas creadas
 */
export async function inicializarStockDeCombo(
  comboId,
  componentes,
  { transaction } = {}
) {
  const porSucursal = await maximosDeRecetaPorSucursal(componentes, {
    transaction,
  });
  if (porSucursal.length === 0) return [];

  const existentes = await Stock.findAll({
    attributes: ['sucursalId'],
    where: { productoId: Number(comboId) },
    transaction,
  });
  const yaTieneFila = new Set(existentes.map((stock) => stock.sucursalId));

  const nuevas = porSucursal
    .filter((fila) => !yaTieneFila.has(fila.sucursalId))
    .map((fila) => ({
      productoId: Number(comboId),
      sucursalId: fila.sucursalId,
      cantidad: fila.maximo,
      disponible: true,
    }));
  if (nuevas.length > 0) {
    await Stock.bulkCreate(nuevas, { transaction });
  }
  return nuevas;
}

/**
 * Ajuste manual del stock de un producto en una sucursal (pantalla de Stock).
 * En un combo la cantidad es "combos que ofrece la sucursal" y no puede superar
 * el máximo que da el stock de sus componentes.
 */
export async function ajustarStock(
  productoId,
  sucursalId,
  { cantidad, disponible },
  { transaction } = {}
) {
  const id = Number(productoId);
  const stock = await Stock.findOne({
    where: { productoId: id, sucursalId: Number(sucursalId) },
    transaction,
  });
  if (!stock) {
    throw new Error('El producto no tiene stock cargado en esa sucursal');
  }
  const cambios = {};
  if (cantidad !== undefined) {
    const valor = Number(cantidad);
    if (!Number.isInteger(valor) || valor < 0) {
      throw new Error('La cantidad tiene que ser 0 o más');
    }
    const producto = await Producto.findByPk(id, {
      attributes: ['id', 'nombre', 'tipo'],
      transaction,
    });
    if (producto?.tipo === 'COMBO') {
      const maximo = await maximoDeCombosPorSucursal(id, sucursalId, {
        transaction,
      });
      if (valor > maximo) {
        const sucursal = await Sucursal.findByPk(Number(sucursalId), {
          transaction,
        });
        throw new Error(
          `"${sucursal?.nombre ?? 'La sucursal'}" puede armar ${maximo} ${
            maximo === 1 ? 'combo' : 'combos'
          } con su stock actual, no ${valor}`
        );
      }
    }
    cambios.cantidad = valor;
  }
  if (disponible !== undefined) {
    cambios.disponible = Boolean(disponible);
  }
  return stock.update(cambios, { transaction });
}

/**
 * Stock que hace falta para un pedido en una sucursal. Un combo necesita su
 * propia unidad y, además, la de cada producto de su receta.
 *
 * @returns {Promise<Array<{sucursalId: number, productoId: number, cantidad: number}>>}
 */
export async function requerimientosDeStock(
  items,
  sucursalId,
  { transaction } = {}
) {
  const pedido = [];
  for (const item of items) {
    const unidades = Number(item.cantidad);
    const producto = await Producto.findByPk(item.productoId, { transaction });
    if (!producto) {
      throw new Error(`El producto ${item.productoId} no existe`);
    }
    pedido.push({
      sucursalId,
      productoId: producto.id,
      cantidad: unidades,
    });
    if (producto.tipo !== 'COMBO') continue;
    const componentes = await producto.getComponentes({ transaction });
    for (const componente of componentes) {
      pedido.push({
        sucursalId,
        productoId: componente.productoId,
        cantidad: componente.cantidad * unidades,
      });
    }
  }
  return pedido;
}

/** Requerimientos agrupados por producto. */
async function agrupar(items, sucursalId, transaction) {
  const pedido = await requerimientosDeStock(items, sucursalId, {
    transaction,
  });
  const agrupado = new Map();
  pedido.forEach((necesidad) => {
    agrupado.set(
      necesidad.productoId,
      (agrupado.get(necesidad.productoId) ?? 0) + necesidad.cantidad
    );
  });
  return agrupado;
}

/**
 * Faltantes de stock de un pedido, para rechazarlo antes de crearlo.
 * Un producto sin fila de stock, o no ofrecido en esa sucursal, cuenta como 0.
 *
 * @returns {Promise<Array<string>>} descripciones legibles de cada faltante
 */
export async function faltantesDeStock(
  items,
  sucursalId,
  { transaction } = {}
) {
  const agrupado = await agrupar(items, sucursalId, transaction);
  if (agrupado.size === 0) return [];
  const productos = await Producto.findAll({
    where: { id: [...agrupado.keys()] },
    transaction,
  });
  const nombres = new Map(productos.map((p) => [p.id, p.nombre]));
  const stocks = await Stock.findAll({
    where: { sucursalId: Number(sucursalId), productoId: [...agrupado.keys()] },
    transaction,
  });
  const porProducto = new Map(stocks.map((stock) => [stock.productoId, stock]));

  const faltantes = [];
  agrupado.forEach((necesario, productoId) => {
    const nombre = nombres.get(productoId) ?? `producto ${productoId}`;
    const hay = cantidadOfrecida(porProducto.get(productoId));
    if (hay < necesario) {
      faltantes.push(`${nombre} (hay ${hay}, se necesitan ${necesario})`);
    }
  });
  return faltantes;
}

/** Une nombres para un mensaje: "Papa", "Papa y Papa", "Papa, Papa y Papa". */
function enLista(nombres) {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * Traduce los faltantes a un mensaje que se entienda sin ver la base: nada de
 * "Stock insuficiente" ni de los componentes de un combo, porque el cliente no
 * los pidió por separado. Función pura: se testea sola.
 *
 * @param {Array<{nombre: string, hay: number, necesario: number}>} faltantes
 */
export function mensajeDeFaltantes(faltantes) {
  if (!Array.isArray(faltantes) || faltantes.length === 0) {
    return 'No hay stock de tu pedido. Actualizá el carrito para confirmar de nuevo.';
  }
  const sinStock = faltantes.filter((f) => f.hay <= 0).map((f) => f.nombre);
  const parciales = faltantes.filter((f) => f.hay > 0);

  const partes = [];
  if (sinStock.length > 0) {
    partes.push(`No nos queda stock de ${enLista(sinStock)}.`);
  }
  parciales.forEach((f) => {
    partes.push(
      `De ${f.nombre} sólo ${f.hay === 1 ? 'queda' : 'quedan'} ${
        f.hay
      } y pediste ${f.necesario}.`
    );
  });
  partes.push('Actualizá el carrito para confirmar el pedido.');
  return partes.join(' ');
}

/** Error de dominio: al pedido le falta stock. El mensaje ya es para el cliente. */
export class StockInsuficienteError extends Error {
  constructor(faltantes) {
    super(mensajeDeFaltantes(faltantes));
    this.name = 'StockInsuficienteError';
    this.faltantes = faltantes;
  }
}

/**
 * Faltantes de stock limitados a lo que el cliente pidió.
 *
 * `faltantesDeStock` también mira los componentes de un combo, y esos nombres
 * se verían raros en el mensaje final ("no hay Papa Cheddar" cuando en el
 * carrito figura un Combo Merienda). Para un combo, `hay` es lo que se puede
 * vender de verdad, no lo que el admin cargó en su fila: si de la receta sólo
 * alcanzan 2, el cliente no puede llevar 5 aunque la fila diga 10.
 *
 * @returns {Promise<Array<{productoId: number, nombre: string, hay: number, necesario: number}>>}
 */
export async function faltantesDePedido(
  items,
  sucursalId,
  { transaction } = {}
) {
  const pedido = new Map();
  for (const item of items) {
    const productoId = Number(item.productoId);
    const unidades = Number(item.cantidad);
    pedido.set(productoId, (pedido.get(productoId) ?? 0) + unidades);
  }
  if (pedido.size === 0) return [];

  const productos = await Producto.findAll({
    where: { id: [...pedido.keys()] },
    transaction,
  });
  const stocks = await Stock.findAll({
    where: { sucursalId: Number(sucursalId), productoId: [...pedido.keys()] },
    transaction,
  });
  const porProducto = new Map(stocks.map((stock) => [stock.productoId, stock]));

  const faltantes = [];
  for (const [productoId, necesario] of pedido) {
    const producto = productos.find((p) => p.id === productoId);
    const hay =
      producto?.tipo === 'COMBO'
        ? await combosOfrecidos(productoId, sucursalId, { transaction })
        : cantidadOfrecida(porProducto.get(productoId));
    if (hay < necesario) {
      faltantes.push({
        productoId,
        nombre: producto?.nombre ?? `producto ${productoId}`,
        hay,
        necesario,
      });
    }
  }
  return faltantes;
}

/**
 * Texto para cuando un pedido pendiente ya no se puede preparar en ninguna
 * sucursal. Reasignarlo es responsabilidad del controller; acá sólo queda el
 * mensaje, por si se quiere usar suelto.
 * @param {Array<{nombre: string}>} reservas
 */
export function mensajeDeReservasVencidas(reservas) {
  const nombres = (reservas || []).map((r) => r.nombre);
  if (nombres.length === 0) {
    return 'No hay stock de tu pedido. Actualizá el carrito para confirmar de nuevo.';
  }
  const plural = nombres.length !== 1;
  return `Ya no se puede preparar el pedido: ${enLista(nombres)} ${
    plural ? 'ya no están disponibles' : 'ya no está disponible'
  } en ninguna sucursal.`;
}

/**
 * Reservas de un pedido pendiente que ya no siguen en la base.
 *
 * Un pedido descuenta su stock al crearse, así que `faltantesDeStock` no sirve
 * para controlarlo después: el mismo pedido ya consumió sus unidades y siempre
 * parecería faltante. Lo que hay que verificar es si la RESERVA sigue en pie:
 * que la fila exista, que la sucursal siga ofreciendo el producto y que la
 * cantidad no haya sido pisada por debajo de lo que el pedido reservó.
 *
 * Entre que el cliente arma el carrito y paga puede pasar cualquier cosa: el
 * admin desactiva el stock (`disponible = false`), baja la cantidad o apaga la
 * sucursal. Por eso hay que volver a mirarlo al confirmar el pago.
 *
 * Si lo que se rompe es un componente, la culpa se le carga al combo que lo usa:
 * el cliente nunca pidió ese componente por separado.
 *
 * @returns {Promise<Array<{productoId: number, nombre: string}>>}
 */
export async function reservasDeStockVencidas(
  items,
  sucursalId,
  { transaction } = {}
) {
  const pedido = new Map();
  for (const item of items) {
    const productoId = Number(item.productoId);
    pedido.set(
      productoId,
      (pedido.get(productoId) ?? 0) + Number(item.cantidad)
    );
  }
  if (pedido.size === 0) return [];

  const reservado = await agrupar(items, sucursalId, transaction);
  const stocks = await Stock.findAll({
    where: {
      sucursalId: Number(sucursalId),
      productoId: [...reservado.keys()],
    },
    transaction,
  });
  const porProducto = new Map(stocks.map((stock) => [stock.productoId, stock]));

  const rotos = new Set();
  reservado.forEach((unidades, productoId) => {
    const stock = porProducto.get(productoId);
    if (!stock || !stock.disponible || stock.cantidad < unidades) {
      rotos.add(productoId);
    }
  });

  // Al cliente sólo se le nombran cosas que estaban en su carrito: un
  // componente caído se reporta a través del combo que lo incluye.
  const vencidas = new Set(
    [...pedido.keys()].filter((productoId) => rotos.has(productoId))
  );
  for (const productoId of pedido.keys()) {
    const receta = await recetaDe(productoId, transaction);
    if (receta?.some((c) => rotos.has(c.productoId))) vencidas.add(productoId);
  }
  if (vencidas.size === 0) return [];

  const productos = await Producto.findAll({
    where: { id: [...vencidas] },
    transaction,
  });
  const nombres = new Map(productos.map((p) => [p.id, p.nombre]));
  return [...vencidas].map((productoId) => ({
    productoId,
    nombre: nombres.get(productoId) ?? `producto ${productoId}`,
  }));
}

/**
 * Descuenta el stock de un pedido: el del combo y el de cada producto de la
 * receta. El descuento es atómico, así dos pedidos simultáneos no sobrevenden.
 */
export async function descontarStock(items, sucursalId, { transaction } = {}) {
  const faltantes = await faltantesDeStock(items, sucursalId, { transaction });
  if (faltantes.length > 0) {
    // El error habla de los productos del pedido y no de sus componentes, porque
    // este mensaje termina en la pantalla del cliente.
    throw new StockInsuficienteError(
      await faltantesDePedido(items, sucursalId, { transaction })
    );
  }
  const agrupado = await agrupar(items, sucursalId, transaction);
  for (const [productoId, total] of agrupado) {
    const [afectadas] = await Stock.update(
      { cantidad: literal(`"cantidad" - ${Number(total)}`) },
      {
        where: {
          sucursalId: Number(sucursalId),
          productoId,
          disponible: true,
          cantidad: { [Op.gte]: total },
        },
        transaction,
      }
    );
    if (afectadas !== 1) {
      // Otro pedido se adelantó entre el chequeo y el descuento. Se relee la
      // fila y se responde con el mismo mensaje friendly del faltante.
      const releido = await Stock.findOne({
        where: { sucursalId: Number(sucursalId), productoId },
        transaction,
      });
      const producto = await Producto.findByPk(productoId, { transaction });
      const total = agrupado.get(productoId);
      throw new StockInsuficienteError([
        {
          productoId,
          nombre: producto?.nombre ?? `producto ${productoId}`,
          hay: cantidadOfrecida(releido),
          necesario: total,
        },
      ]);
    }
  }
}

/**
 * Repone el stock de un pedido cancelado: las cantidades vuelven tal cual.
 *
 * A diferencia del descuento, acá una fila que no existe no es un error: si el
 * producto se sacó del catálogo de la sucursal después del pedido, la
 * cancelación tiene que poder completarse igual. En ese caso la fila se crea
 * con la cantidad repuesta.
 */
export async function reponerStock(items, sucursalId, { transaction } = {}) {
  const agrupado = await agrupar(items, sucursalId, transaction);
  for (const [productoId, total] of agrupado) {
    const [, creado] = await Stock.findOrCreate({
      where: { sucursalId: Number(sucursalId), productoId },
      defaults: { cantidad: total, disponible: true },
      transaction,
    });
    // `creado` decide: una fila nueva ya nace con la cantidad repuesta, una
    // existente siempre hay que sumarle. Comparar contra `total` fallaría
    // cuando la fila ya vale justo lo que se repone y se perdería la reposición.
    if (!creado) {
      const [afectadas] = await Stock.update(
        { cantidad: literal(`"cantidad" + ${Number(total)}`) },
        { where: { sucursalId: Number(sucursalId), productoId }, transaction }
      );
      if (afectadas !== 1) {
        throw new Error(
          `No se pudo reponer el stock del producto ${productoId} en la sucursal ${sucursalId}`
        );
      }
    }
  }
}
