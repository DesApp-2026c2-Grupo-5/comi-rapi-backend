/**
 * Generador del recibo de pago en PDF sin dependencias externas.
 *
 * El backend no tiene librería PDF y el binario de Chromium del frontend no es
 * portátil en producción, así que se arma un PDF 1.4 mínimo con Node puro:
 * Helvetica/WinAnsi para el texto y el PNG del logo oficial como XObject. El PNG
 * se incrusta con su stream FlateDecode y el filtro PNG del propio archivo, sin
 * re-muestrear ni alterar la hamburguesa original.
 *
 * Todo lo que se dibuja viene de `construirDatosRecibo` (snapshots del pedido):
 * acá no se consulta catálogo, no se recalculan importes y no se incluye la
 * sucursal. El PDF se genera en memoria, bajo demanda.
 */

const ANCHO_PAGINA = 595.28;
const ALTO_PAGINA = 841.89;
const MARGEN = 48;
const MARGEN_INFERIOR = 56;

const rgb = (hex) => {
  const valor = Number.parseInt(hex.slice(1), 16);
  return [16, 8, 0]
    .map((desplazamiento) => ((valor >> desplazamiento) & 255) / 255)
    .map((componente) => componente.toFixed(3))
    .join(' ');
};

const MARRON = rgb('#4a2c17');
const NARANJA = rgb('#ff9f1c');
const GRIS = rgb('#6b4b32');
const CLARO = rgb('#ecdcc6');
const CREMA = rgb('#fff4e2');

/**
 * Medidas aproximadas de Helvetica en unidades de 1/1000. Alcanzan para partir
 * líneas largas sin desbordar columnas; el PDF usa Helvetica real al dibujar.
 */
const ANCHOS_ESPECIALES = {
  ' ': 0.278,
  '!': 0.278,
  '"': 0.355,
  '#': 0.556,
  $: 0.556,
  '%': 0.889,
  '&': 0.667,
  "'": 0.191,
  '(': 0.333,
  ')': 0.333,
  '*': 0.389,
  '+': 0.584,
  ',': 0.278,
  '-': 0.333,
  '.': 0.278,
  '/': 0.278,
  ':': 0.278,
  ';': 0.278,
  '<': 0.584,
  '=': 0.584,
  '>': 0.584,
  '?': 0.556,
  '@': 1.015,
  '[': 0.278,
  '\\': 0.278,
  ']': 0.278,
  '^': 0.469,
  _: 0.556,
  '`': 0.333,
  '{': 0.334,
  '|': 0.26,
  '}': 0.334,
  '~': 0.584,
};

// WinAnsi para los caracteres que viven fuera de Latin-1 (típicamente, guiones
// y comillas tipográficas). Los acentos del español ya caen en 0xC0–0xFF.
const WINANSI = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

const anchoCaracter = (caracter) => {
  if (ANCHOS_ESPECIALES[caracter] !== undefined) {
    return ANCHOS_ESPECIALES[caracter];
  }
  const codigo = caracter.codePointAt(0);
  if (codigo >= 65 && codigo <= 90) return 0.667;
  if (codigo >= 97 && codigo <= 122) return 0.556;
  return 0.556;
};

const medirTexto = (texto, tamano, negrita) => {
  const facturado = negrita ? 1.06 : 1;
  let total = 0;
  for (const caracter of String(texto ?? '')) {
    total += anchoCaracter(caracter);
  }
  return total * tamano * facturado;
};

/** Parte un texto en líneas que caben en el ancho pedido, sin cortar palabras. */
function ajustarTexto(texto, anchoMaximo, tamano, negrita = false) {
  const palabras = String(texto ?? '')
    .split(/\s+/)
    .filter(Boolean);
  if (palabras.length === 0) return [''];

  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (medirTexto(candidata, tamano, negrita) <= anchoMaximo) {
      actual = candidata;
      continue;
    }
    if (actual) {
      lineas.push(actual);
      actual = '';
    }
    if (medirTexto(palabra, tamano, negrita) <= anchoMaximo) {
      actual = palabra;
      continue;
    }
    // Palabra más larga que la columna: se parte por caracteres.
    let parte = '';
    for (const caracter of palabra) {
      if (
        medirTexto(parte + caracter, tamano, negrita) > anchoMaximo &&
        parte
      ) {
        lineas.push(parte);
        parte = '';
      }
      parte += caracter;
    }
    actual = parte;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** Codifica a WinAnsi y escapa los caracteres reservados de un string PDF. */
function codificarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFC')
    .split('')
    .map((caracter) => {
      if (WINANSI[caracter] !== undefined) {
        return String.fromCharCode(WINANSI[caracter]);
      }
      const codigo = caracter.codePointAt(0);
      if (codigo >= 0x20 && codigo <= 0xff) return caracter;
      return '?';
    })
    .join('')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Toma los chunks IDAT del PNG del logo. Se valida el formato esperado (RGB,
 * 8 bits, sin interlazado) para que el XObject use exactamente esos bytes.
 */
function extraerImagenPng(base64) {
  const png = Buffer.from(base64 || '', 'base64');
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(firma)) {
    throw new Error('El logo del recibo no es un PNG válido');
  }

  let desplazamiento = 8;
  let ancho = 0;
  let alto = 0;
  const fragmentos = [];

  while (desplazamiento + 12 <= png.length) {
    const longitud = png.readUInt32BE(desplazamiento);
    const tipo = png.toString('ascii', desplazamiento + 4, desplazamiento + 8);
    const inicio = desplazamiento + 8;
    if (inicio + longitud + 4 > png.length) {
      throw new Error('El PNG del logo está incompleto');
    }
    if (tipo === 'IHDR') {
      ancho = png.readUInt32BE(inicio);
      alto = png.readUInt32BE(inicio + 4);
      const profundidad = png[inicio + 8];
      const color = png[inicio + 9];
      const interlazado = png[inicio + 12];
      if (profundidad !== 8 || color !== 2 || interlazado !== 0) {
        throw new Error('Formato de logo no soportado para el recibo');
      }
    } else if (tipo === 'IDAT') {
      fragmentos.push(png.subarray(inicio, inicio + longitud));
    }
    desplazamiento = inicio + longitud + 4;
    if (tipo === 'IEND') break;
  }

  if (!ancho || !alto || fragmentos.length === 0) {
    throw new Error('No se pudo leer la imagen del logo');
  }
  return { ancho, alto, datos: Buffer.concat(fragmentos) };
}

/** Ensambla los objetos PDF y la tabla de desplazamientos (xref). */
function ensamblarPdf(paginas, imagen) {
  const objetos = [
    Buffer.from(
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      'latin1'
    ),
    Buffer.from(
      `2 0 obj\n<< /Type /Pages /Count ${paginas.length} /Kids [${paginas
        .map((_, indice) => `${6 + indice * 2} 0 R`)
        .join(' ')}] >>\nendobj\n`,
      'latin1'
    ),
    Buffer.from(
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
      'latin1'
    ),
    Buffer.from(
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
      'latin1'
    ),
    Buffer.concat([
      Buffer.from(
        `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imagen.ancho} /Height ${imagen.alto} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${imagen.ancho} >> /Length ${imagen.datos.length} >>\nstream\n`,
        'latin1'
      ),
      imagen.datos,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ]),
  ];

  paginas.forEach((comandos, indice) => {
    const numeroPagina = 6 + indice * 2;
    const numeroContenido = numeroPagina + 1;
    const contenido = Buffer.from(`${comandos.join('\n')}\n`, 'latin1');
    objetos.push(
      Buffer.from(
        `${numeroPagina} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO_PAGINA} ${ALTO_PAGINA}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im0 5 0 R >> >> /Contents ${numeroContenido} 0 R >>\nendobj\n`,
        'latin1'
      )
    );
    objetos.push(
      Buffer.concat([
        Buffer.from(
          `${numeroContenido} 0 obj\n<< /Length ${contenido.length} >>\nstream\n`,
          'latin1'
        ),
        contenido,
        Buffer.from('endstream\nendobj\n', 'latin1'),
      ])
    );
  });

  let pdf = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  const desplazamientos = [];
  for (const objeto of objetos) {
    desplazamientos.push(pdf.length);
    pdf = Buffer.concat([pdf, objeto]);
  }

  const inicioXref = pdf.length;
  const xref = [
    `xref\n0 ${objetos.length + 1}\n`,
    '0000000000 65535 f \n',
    ...desplazamientos.map(
      (desplazamiento) =>
        `${String(desplazamiento).padStart(10, '0')} 00000 n \n`
    ),
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\n`,
    `startxref\n${inicioXref}\n%%EOF\n`,
  ].join('');
  return Buffer.concat([pdf, Buffer.from(xref, 'latin1')]);
}

/**
 * Dibuja el recibo y devuelve el PDF como Buffer. No escribe en disco: el
 * controller lo envía tal cual y el email lo adjunta desde el mismo armador.
 *
 * @param {object} params
 * @param {object} params.datos - Salida de `construirDatosRecibo`.
 * @param {string} params.logoBase64 - PNG del logo oficial en base64.
 * @returns {Buffer} PDF generado bajo demanda.
 */
export function generarReciboPdf({ datos, logoBase64 }) {
  const imagen = extraerImagenPng(logoBase64);
  const paginas = [];
  let comandos = [];
  let y = 0;

  function dibujarTexto(texto, x, opciones = {}) {
    const {
      y: yTexto = y,
      tamano = 10,
      negrita = false,
      color = MARRON,
      alineacion = 'izquierda',
    } = opciones;
    const ancho = medirTexto(texto, tamano, negrita);
    const xFinal =
      alineacion === 'derecha'
        ? x - ancho
        : alineacion === 'centro'
        ? x - ancho / 2
        : x;
    comandos.push(
      `BT ${color} rg /${
        negrita ? 'F2' : 'F1'
      } ${tamano} Tf 1 0 0 1 ${xFinal.toFixed(2)} ${yTexto.toFixed(
        2
      )} Tm (${codificarTexto(texto)}) Tj ET`
    );
    return ancho;
  }

  function dibujarLinea(x1, y1, x2, y2, color = CLARO, grosor = 0.6) {
    comandos.push(`q ${color} RG ${grosor} w ${x1} ${y1} m ${x2} ${y2} l S Q`);
  }

  function dibujarRectangulo(x, base, ancho, alto, color) {
    comandos.push(`q ${color} rg ${x} ${base} ${ancho} ${alto} re f Q`);
  }

  function dibujarImagen(x, base, ancho, alto) {
    comandos.push(`q ${ancho} 0 0 ${alto} ${x} ${base} cm /Im0 Do Q`);
  }

  function nuevaPagina() {
    if (comandos.length > 0) paginas.push(comandos);
    comandos = [];
    y = ALTO_PAGINA - MARGEN;
    if (paginas.length > 0) {
      dibujarTexto('COMI-RAPI · RECIBO DE PAGO', MARGEN, {
        y: y - 6,
        tamano: 10,
        negrita: true,
        color: NARANJA,
      });
      dibujarTexto(`Pedido #${datos.id}`, ANCHO_PAGINA - MARGEN, {
        y: y - 6,
        tamano: 9,
        alineacion: 'derecha',
        color: GRIS,
      });
      y -= 20;
      dibujarLinea(MARGEN, y, ANCHO_PAGINA - MARGEN, y, CLARO);
      y -= 22;
    }
  }

  function asegurar(altura) {
    if (y - altura < MARGEN_INFERIOR) nuevaPagina();
  }

  function dibujarSeccion(titulo) {
    asegurar(42);
    y -= 10;
    dibujarTexto(titulo, MARGEN, { y, tamano: 11, negrita: true });
    y -= 7;
    dibujarLinea(MARGEN, y, ANCHO_PAGINA - MARGEN, y, CLARO);
    y -= 17;
  }

  nuevaPagina();

  // Encabezado con la hamburguesa original del logo del frontend.
  dibujarImagen(MARGEN, y - 48, 48, 48);
  dibujarTexto('COMI-RAPI', MARGEN + 58, {
    y: y - 18,
    tamano: 20,
    negrita: true,
    color: NARANJA,
  });
  dibujarTexto('Comprobante de compra y pago', MARGEN + 58, {
    y: y - 36,
    tamano: 9,
    color: GRIS,
  });
  y -= 62;
  dibujarTexto('RECIBO DE PAGO', ANCHO_PAGINA / 2, {
    y,
    tamano: 17,
    negrita: true,
    alineacion: 'centro',
  });
  y -= 22;
  dibujarTexto(`Comprobante N.º #${datos.id}`, ANCHO_PAGINA / 2, {
    y,
    tamano: 11,
    negrita: true,
    color: NARANJA,
    alineacion: 'centro',
  });
  y -= 18;
  dibujarLinea(MARGEN, y, ANCHO_PAGINA - MARGEN, y, CLARO);
  y -= 24;

  const meta = [
    ['Fecha', datos.fecha],
    ['Cliente', datos.clienteDetalle],
    ['Medio de pago', datos.medioPago],
    ['Estado', datos.estado],
  ];
  for (const [etiqueta, valor] of meta) {
    const lineas = ajustarTexto(valor, 330, 9);
    asegurar(14 * lineas.length + 6);
    dibujarTexto(etiqueta, MARGEN, { y, tamano: 9, color: GRIS });
    lineas.forEach((linea, indice) =>
      dibujarTexto(linea, ANCHO_PAGINA - MARGEN, {
        y: y - indice * 12,
        tamano: 9,
        alineacion: 'derecha',
      })
    );
    y -= 14 * lineas.length;
  }
  y -= 8;

  dibujarSeccion('Detalle de productos');
  const anchoUtil = ANCHO_PAGINA - 2 * MARGEN;
  const xProducto = MARGEN;
  const xCantidad = ANCHO_PAGINA - MARGEN - 205;
  const xPrecio = ANCHO_PAGINA - MARGEN - 125;
  const xSubtotal = ANCHO_PAGINA - MARGEN;
  dibujarRectangulo(MARGEN, y - 6, anchoUtil, 18, CREMA);
  dibujarTexto('Producto', xProducto + 6, {
    y: y + 6,
    tamano: 8,
    negrita: true,
  });
  dibujarTexto('Cant.', xCantidad, {
    y: y + 6,
    tamano: 8,
    negrita: true,
    alineacion: 'derecha',
  });
  dibujarTexto('Precio unit.', xPrecio, {
    y: y + 6,
    tamano: 8,
    negrita: true,
    alineacion: 'derecha',
  });
  dibujarTexto('Subtotal', xSubtotal, {
    y: y + 6,
    tamano: 8,
    negrita: true,
    alineacion: 'derecha',
  });
  y -= 18;

  if (datos.items.length === 0) {
    dibujarTexto('Sin productos', xProducto + 6, { y, tamano: 9, color: GRIS });
    y -= 18;
  }

  for (const item of datos.items) {
    const lineasNombre = ajustarTexto(item.nombre, 235, 9, true);
    const lineasPersonalizacion =
      item.personalizacion.length > 0
        ? ajustarTexto(
            `Personalización: ${item.personalizacion.join('; ')}`,
            235,
            8
          )
        : [];
    const lineasNota = item.nota
      ? ajustarTexto(`Nota: ${item.nota}`, 235, 8)
      : [];
    const altura =
      14 * lineasNombre.length +
      12 * (lineasPersonalizacion.length + lineasNota.length) +
      10;
    asegurar(altura);

    const yInicio = y;
    lineasNombre.forEach((linea, indice) =>
      dibujarTexto(linea, xProducto + 6, {
        y: y - indice * 13,
        tamano: 9,
        negrita: indice === 0,
      })
    );
    y -= 13 * lineasNombre.length;
    for (const linea of lineasPersonalizacion) {
      dibujarTexto(linea, xProducto + 6, {
        y,
        tamano: 8,
        color: GRIS,
      });
      y -= 11;
    }
    for (const linea of lineasNota) {
      dibujarTexto(linea, xProducto + 6, {
        y,
        tamano: 8,
        color: GRIS,
      });
      y -= 11;
    }

    dibujarTexto(String(item.cantidad), xCantidad, {
      y: yInicio,
      tamano: 9,
      alineacion: 'derecha',
    });
    dibujarTexto(item.precioUnitario, xPrecio, {
      y: yInicio,
      tamano: 9,
      alineacion: 'derecha',
    });
    dibujarTexto(item.subtotal, xSubtotal, {
      y: yInicio,
      tamano: 9,
      negrita: true,
      alineacion: 'derecha',
    });
    y -= 6;
    dibujarLinea(MARGEN, y, ANCHO_PAGINA - MARGEN, y, CLARO);
    y -= 8;
  }

  dibujarSeccion('Resumen de pago');
  const filas = [
    ['Subtotal', datos.subtotal],
    ...datos.promociones.map((promo) => [promo.nombre, promo.descuento]),
  ];
  if (datos.cupon) {
    filas.push([
      `Cupón ${datos.cupon.codigo}${
        datos.cupon.liberado ? ' (no aplicado)' : ''
      }`,
      datos.cupon.descuento,
    ]);
  }
  filas.push(['Envío', datos.costoEnvio]);

  for (const [etiqueta, valor] of filas) {
    asegurar(15);
    dibujarTexto(etiqueta, MARGEN, { y, tamano: 9 });
    dibujarTexto(valor, ANCHO_PAGINA - MARGEN, {
      y,
      tamano: 9,
      alineacion: 'derecha',
    });
    y -= 14;
  }
  asegurar(34);
  y -= 4;
  dibujarLinea(MARGEN, y, ANCHO_PAGINA - MARGEN, y, NARANJA, 1.4);
  y -= 16;
  dibujarTexto('Total pagado', MARGEN, { y, tamano: 11, negrita: true });
  dibujarTexto(datos.total, ANCHO_PAGINA - MARGEN, {
    y,
    tamano: 15,
    negrita: true,
    color: NARANJA,
    alineacion: 'derecha',
  });
  y -= 26;

  if (datos.observacion) {
    dibujarSeccion('Observaciones del pedido');
    for (const linea of ajustarTexto(datos.observacion, anchoUtil, 9)) {
      asegurar(13);
      dibujarTexto(linea, MARGEN, { y, tamano: 9 });
      y -= 13;
    }
    y -= 6;
  }

  asegurar(28);
  dibujarLinea(MARGEN, y, ANCHO_PAGINA - MARGEN, y, CLARO);
  y -= 14;
  dibujarTexto(
    'Comprobante generado automáticamente por Comi-Rapi',
    ANCHO_PAGINA / 2,
    {
      y,
      tamano: 8,
      color: GRIS,
      alineacion: 'centro',
    }
  );

  if (comandos.length > 0) paginas.push(comandos);
  paginas.forEach((lineas, indice) => {
    lineas.push(
      `BT ${GRIS} rg /F1 8 Tf 1 0 0 1 ${(ANCHO_PAGINA - MARGEN).toFixed(
        2
      )} 28 Tm (Pagina ${indice + 1}) Tj ET`
    );
  });

  return ensamblarPdf(paginas, imagen);
}
