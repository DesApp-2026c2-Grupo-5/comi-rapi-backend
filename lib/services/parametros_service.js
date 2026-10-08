import db from '../models';

/**
 * Service: parámetros de negocio.
 *
 * Fuente de verdad de los valores que antes estaban hardcodeados en el backend
 * y el frontend. El catálogo de abajo es el contrato: fija qué claves existen,
 * de qué tipo son, su rango válido y su valor por defecto. La tabla
 * `ParametrosSistema` guarda solo los valores elegidos por el
 * SUPERADMINISTRADOR; si una clave todavía no tiene fila, se usa el valor por
 * defecto del catálogo.
 *
 * El catálogo es cerrado: `actualizarParametros` rechaza cualquier clave que no
 * esté acá, así una tabla nunca puede quedar con claves colgadas que el código
 * no lee.
 */

/**
 * Catálogo de parámetros. `entero` distingue los contadores (no admiten
 * decimales) de los importes/kilómetros. `minimo`/`maximo` acotan el rango
 * aceptable al editarlos.
 */
export const PARAMETROS = {
  montoMinimoEnvioGratis: {
    tipo: 'decimal',
    valorPorDefecto: 10000,
    grupo: 'envio',
    unidad: '$',
    descripcion: 'Subtotal a partir del cual el envío no se cobra.',
    minimo: 0,
  },
  costoEnvioFijo: {
    tipo: 'decimal',
    valorPorDefecto: 350,
    grupo: 'envio',
    unidad: '$',
    descripcion:
      'Costo de envío que se suma cuando el subtotal es menor al mínimo de envío gratis.',
    minimo: 0,
  },
  radioCoberturaKm: {
    tipo: 'decimal',
    valorPorDefecto: 5,
    grupo: 'cobertura',
    unidad: 'km',
    descripcion:
      'Distancia máxima por ruta entre la sucursal y la dirección de entrega.',
    minimo: 0,
  },
  cantidadMaximaProductoCarrito: {
    tipo: 'entero',
    valorPorDefecto: 20,
    grupo: 'carrito',
    unidad: 'unidades',
    descripcion:
      'Máximo de unidades del mismo producto que se pueden agregar al carrito.',
    minimo: 1,
  },
  minimoComponentesCombo: {
    tipo: 'entero',
    valorPorDefecto: 2,
    grupo: 'catalogo',
    unidad: 'productos',
    descripcion:
      'Cantidad mínima de productos distintos que debe tener la receta de un combo.',
    minimo: 2,
  },
  montoMinimoPedido: {
    tipo: 'decimal',
    valorPorDefecto: 2000,
    grupo: 'pedido',
    unidad: '$',
    descripcion:
      'Subtotal mínimo (antes de descuentos y envío) para poder confirmar un pedido.',
    minimo: 0,
  },
  montoMaximoPedido: {
    tipo: 'decimal',
    valorPorDefecto: 500000,
    grupo: 'pedido',
    unidad: '$',
    descripcion:
      'Subtotal máximo (antes de descuentos y envío) que admite un pedido.',
    minimo: 0,
  },
  cantidadMaximaItemsPedido: {
    tipo: 'entero',
    valorPorDefecto: 50,
    grupo: 'pedido',
    unidad: 'unidades',
    descripcion:
      'Cantidad total de unidades (sumando todos los productos) que admite un pedido.',
    minimo: 1,
  },
  cantidadMaximaUnidadesProducto: {
    tipo: 'entero',
    valorPorDefecto: 20,
    grupo: 'pedido',
    unidad: 'unidades',
    descripcion: 'Máximo de unidades de un mismo producto dentro de un pedido.',
    minimo: 1,
  },
  porcentajeMaximoDescuento: {
    tipo: 'decimal',
    valorPorDefecto: 50,
    grupo: 'promociones',
    unidad: '%',
    descripcion:
      'Porcentaje máximo que puede descontar una promoción de tipo porcentual.',
    minimo: 0,
    maximo: 100,
  },
  cantidadMaximaPromocionesAplicables: {
    tipo: 'entero',
    valorPorDefecto: 3,
    grupo: 'promociones',
    unidad: 'promociones',
    descripcion:
      'Máximo de promociones que se pueden aplicar sobre un pedido. Reservado: el motor actual aplica automáticamente el mejor descuento por línea, sin acumular.',
    minimo: 1,
  },
};

/** Claves de solo lectura del catálogo (para no reasignar el objeto exportado). */
export const CLAVES = Object.keys(PARAMETROS);

/** La clave pedida no existe en el catálogo. */
export class ParametroDesconocidoError extends Error {
  constructor(clave) {
    super(`Parámetro desconocido: ${clave}`);
    this.name = 'ParametroDesconocidoError';
    this.clave = clave;
  }
}

/** El valor no respeta el tipo o el rango del parámetro. */
export class ParametroInvalidoError extends Error {
  constructor(clave, mensaje) {
    super(mensaje || `Valor inválido para el parámetro ${clave}`);
    this.name = 'ParametroInvalidoError';
    this.clave = clave;
  }
}

/**
 * Valida y normaliza un valor contra su definición del catálogo.
 * @param {string} clave
 * @param {*} valor
 * @returns {number} valor numérico normalizado.
 */
export function normalizarValor(clave, valor) {
  const definicion = PARAMETROS[clave];
  if (!definicion) {
    throw new ParametroDesconocidoError(clave);
  }
  if (valor === undefined || valor === null || valor === '') {
    throw new ParametroInvalidoError(
      clave,
      `El parámetro ${clave} es obligatorio`
    );
  }
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    throw new ParametroInvalidoError(
      clave,
      `El parámetro ${clave} tiene que ser numérico`
    );
  }
  if (definicion.tipo === 'entero' && !Number.isInteger(numero)) {
    throw new ParametroInvalidoError(
      clave,
      `El parámetro ${clave} tiene que ser un número entero`
    );
  }
  if (numero < definicion.minimo) {
    throw new ParametroInvalidoError(
      clave,
      `El parámetro ${clave} no puede ser menor a ${definicion.minimo}`
    );
  }
  if (definicion.maximo !== undefined && numero > definicion.maximo) {
    throw new ParametroInvalidoError(
      clave,
      `El parámetro ${clave} no puede ser mayor a ${definicion.maximo}`
    );
  }
  return numero;
}

/** Filas de la tabla como Map<clave, fila>. */
async function leerFilas() {
  const filas = await db.ParametroSistema.findAll();
  return new Map(filas.map((fila) => [fila.clave, fila]));
}

/**
 * Valor numérico vigente de un parámetro: el guardado en la base o, si todavía
 * no tiene fila, el valor por defecto del catálogo.
 * @param {string} clave
 * @returns {Promise<number>}
 */
export async function obtenerValor(clave) {
  const definicion = PARAMETROS[clave];
  if (!definicion) {
    throw new ParametroDesconocidoError(clave);
  }
  const fila = await db.ParametroSistema.findOne({ where: { clave } });
  const crudo = fila ? fila.valor : definicion.valorPorDefecto;
  return Number(crudo);
}

/**
 * Varios valores en una sola consulta.
 * @param {Array<string>} claves
 * @returns {Promise<Object>} { clave: number }
 */
export async function obtenerValores(claves) {
  const pedidas = claves || [];
  pedidas.forEach((clave) => {
    if (!PARAMETROS[clave]) throw new ParametroDesconocidoError(clave);
  });
  const filas = await leerFilas();
  const resultado = {};
  pedidas.forEach((clave) => {
    const definicion = PARAMETROS[clave];
    const crudo = filas.has(clave)
      ? filas.get(clave).valor
      : definicion.valorPorDefecto;
    resultado[clave] = Number(crudo);
  });
  return resultado;
}

/**
 * Catálogo completo con el valor vigente de cada parámetro, listo para el panel
 * del superadmin.
 * @returns {Promise<Array>} parámetros ordenados por grupo y clave.
 */
export async function obtenerParametros() {
  const filas = await leerFilas();
  return CLAVES.map((clave) => {
    const definicion = PARAMETROS[clave];
    const fila = filas.get(clave);
    const crudo = fila ? fila.valor : definicion.valorPorDefecto;
    return {
      clave,
      valor: Number(crudo),
      ...definicion,
      descripcion: (fila && fila.descripcion) || definicion.descripcion,
    };
  });
}

/**
 * Actualiza uno o varios parámetros. Valida TODO el lote antes de escribir: si
 * una clave o un valor es inválido, no se guarda nada.
 * @param {Object} cambios - { clave: valor }
 * @returns {Promise<Array>} catálogo actualizado.
 */
export async function actualizarParametros(cambios) {
  if (!cambios || typeof cambios !== 'object') {
    throw new ParametroInvalidoError(
      null,
      'Los parámetros tienen que venir en un objeto'
    );
  }
  const entradas = Object.entries(cambios);
  if (entradas.length === 0) {
    throw new ParametroInvalidoError(null, 'No se envió ningún parámetro');
  }
  const validados = entradas.map(([clave, valor]) => ({
    clave,
    valor: normalizarValor(clave, valor),
  }));

  await db.sequelize.transaction(async (t) => {
    for (const { clave, valor } of validados) {
      // `clave` es UNIQUE (no PK): se hace upsert por `clave` con findOrCreate.
      const [fila, creada] = await db.ParametroSistema.findOrCreate({
        where: { clave },
        defaults: {
          clave,
          valor: String(valor),
          descripcion: PARAMETROS[clave].descripcion,
        },
        transaction: t,
      });
      if (!creada && fila.valor !== String(valor)) {
        fila.valor = String(valor);
        await fila.save({ transaction: t });
      }
    }
  });

  return obtenerParametros();
}
