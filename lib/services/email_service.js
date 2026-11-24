/**
 * Servicio de envío de emails.
 *
 * La lógica de recuperación NO conoce Mailpit: habla con este servicio, y este
 * servicio traduce a SMTP usando la configuración. Cambiar de Mailpit a un
 * proveedor real (SendGrid, SES, Brevo, Mailgun...) es solo cambiar las
 * variables SMTP_* en el .env, sin tocar código.
 *
 * El cuerpo del email se arma acá: texto plano como alternativa y, para el
 * recibo, una plantilla HTML de comprobante con la identidad visual de la marca.
 * El único archivo adjunto es el PDF; el logo vive dentro de ese documento.
 */
import { Op } from 'sequelize';
import nodemailer from 'nodemailer';
import config from '../config/config';
import db from '../models';
import { generarReciboPdf } from './recibo_pdf';

let transporte = null;

/**
 * Construye (y memoiza) el transporte SMTP a partir de la configuración.
 * @returns {object|null} El transporte, o null si no hay transporte configurado.
 */
function obtenerTransporte() {
  if (config.mail.transport !== 'smtp') return null;
  if (transporte) return transporte;

  transporte = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    // Mailpit no requiere credenciales en desarrollo; los proveedores reales sí.
    auth:
      config.mail.user && config.mail.password
        ? { user: config.mail.user, pass: config.mail.password }
        : undefined,
    // TLS: implícito con SMTP_SECURE=true (465) u STARTTLS con
    // SMTP_REQUIRE_TLS=true (587). Ambos salen de la config, no del código,
    // para no dejar Mailpit como único escenario soportado.
    secure: config.mail.secure,
    requireTLS: config.mail.requireTLS,
    tls: { rejectUnauthorized: config.mail.rejectUnauthorized },
  });

  return transporte;
}

/**
 * Permite descartar el transporte memoizado. Solo para tests.
 * @returns {void}
 */
export function reiniciarTransporte() {
  transporte = null;
}

/**
 * Arma el enlace de recuperación que viaja en el email.
 * @param {string} token - Token en texto plano.
 * @returns {string} URL completa del frontend.
 */
export function construirEnlaceRecuperacion(token) {
  return `${config.frontend.url}/reset-password?token=${token}`;
}

/**
 * Envia un email de recuperación de contraseña.
 *
 * @param {object} params
 * @param {string} params.destinatario - Email del usuario.
 * @param {string} params.token - Token en texto plano para armar el enlace.
 * @returns {Promise<{ enviado: boolean, motivo?: string }>}
 *   motivo = 'sin-transporte' cuando MAIL_TRANSPORT no es 'smtp'.
 */
export async function enviarEmailRecuperacion({ destinatario, token }) {
  const enlace = construirEnlaceRecuperacion(token);
  const minutos = config.passwordReset.expirationMinutes;

  const asunto = 'Recuperá tu contraseña de Comi-Rapi';
  const texto = [
    'Hola,',
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta de Comi-Rapi.',
    '',
    'Entrá a este enlace para elegir una contraseña nueva:',
    enlace,
    '',
    `El enlace expira en ${minutos} minutos y solo puede usarse una vez.`,
    '',
    'Si no solicitaste el cambio, podés ignorar este mensaje: tu contraseña actual',
    'seguirá siendo válida.',
    '',
    'Equipo Comi-Rapi',
  ].join('\n');

  const t = obtenerTransporte();

  if (!t) {
    // Sin transporte configurado no se envía nada y NO se registra el token:
    // en producción un token en logs sería una fuga.
    return { enviado: false, motivo: 'sin-transporte' };
  }

  await t.sendMail({
    from: config.mail.from,
    to: destinatario,
    subject: asunto,
    text: texto,
  });

  return { enviado: true };
}

const formatearMonto = (valor) =>
  `$${Number(valor).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatearFecha = (valor) => {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (!Number.isFinite(fecha.getTime())) return String(valor || '');
  return fecha.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

/**
 * Valida el formato básico del destinatario del recibo. Misma regla que el
 * módulo de emisiones: al no haber email verificado, alcanza con que no esté
 * vacío y sea sintácticamente aceptable.
 */
const emailValido = (destinatario) => {
  if (!destinatario || typeof destinatario !== 'string') return false;
  const email = destinatario.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const ETIQUETAS_MEDIO_PAGO = {
  TARJETA: 'Tarjeta',
  MERCADO_PAGO: 'Mercado Pago',
};

/**
 * Convierte el snapshot de personalización de una línea (JSON guardado en
 * `PedidoItem.observacion`) en texto legible. Los pedidos legacy pueden tener
 * texto libre: en ese caso se muestra tal cual, sin lanzar.
 */
function describirPersonalizacion(observacion) {
  if (!observacion) return [];

  let datos;
  try {
    datos =
      typeof observacion === 'string' ? JSON.parse(observacion) : observacion;
  } catch (_error) {
    return [String(observacion)];
  }
  if (!datos || typeof datos !== 'object') return [String(datos)];

  const partes = [];
  const conCantidad = (nombre, cantidad) =>
    Number(cantidad) > 1 ? `${nombre} x${cantidad}` : nombre;

  for (const lista of [datos.extras, datos.acompanamientos]) {
    for (const opcion of lista || []) {
      const nombre = opcion?.nombre || opcion?.id;
      if (nombre) partes.push(conCantidad(String(nombre), opcion.cantidad));
    }
  }
  for (const condimento of datos.condimentos || []) {
    const nombre = condimento?.nombre || condimento?.id;
    if (nombre) partes.push(conCantidad(String(nombre), condimento.cantidad));
  }
  for (const sin of datos.sin || []) {
    if (sin) {
      partes.push(
        `Sin ${typeof sin === 'string' ? sin : sin.nombre || sin.id}`
      );
    }
  }

  return partes;
}

/**
 * Arma, una sola vez, los datos que aparecen en el recibo (email, PDF y
 * descarga). Todos los importes salen del pedido ya serializado: se formatean
 * los snapshots persistidos, sin consultar el catálogo ni recalcular precios.
 *
 * @param {object} params
 * @param {object} params.pedido - Pedido serializado con ítems, promos y cupón.
 * @param {string} [params.nombre] - Nombre a mostrar; si no viene, se toma del
 *   snapshot del cliente del pedido.
 * @returns {object} Datos listos para renderizar en cualquier soporte.
 */
export function construirDatosRecibo({ pedido, nombre } = {}) {
  const cliente = pedido?.cliente || {};
  const nombreCliente =
    nombre || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ');
  const medioPago =
    ETIQUETAS_MEDIO_PAGO[pedido?.medioPago] || pedido?.medioPago || '-';
  const clienteDetalle = `${nombreCliente || cliente.email || '-'}${
    cliente.email ? ` (${cliente.email})` : ''
  }`;

  // El subtotal es la suma de los subtotales ya guardados en cada línea. No se
  // vuelve a multiplicar precio por cantidad: ese cálculo vive en el alta.
  const subtotalNumerico = (pedido?.items || []).reduce(
    (total, item) => total + Number(item.subtotal ?? 0),
    0
  );

  const items = (pedido?.items || []).map((item) => ({
    nombre: item.nombreProducto || 'Producto',
    cantidad: Number(item.cantidad ?? 1),
    precioUnitario: formatearMonto(item.precioUnitario ?? 0),
    subtotal: formatearMonto(item.subtotal ?? 0),
    personalizacion: describirPersonalizacion(item.observacion),
    nota: item.nota ? String(item.nota) : '',
  }));

  const promociones = (pedido?.promociones || []).map((promo) => ({
    nombre: promo.nombre || `Promoción ${promo.promocionId ?? ''}`,
    descuento: `-${formatearMonto(promo.descuentoAplicado ?? 0)}`,
  }));

  const cupon = pedido?.cupon
    ? {
        // El recibo muestra el nombre de la emisión guardado en el snapshot del
        // uso; el código queda fuera del comprobante. Para usos legacy sin ese
        // dato se conserva el código como único identificador disponible.
        nombre: pedido.cupon.nombre || pedido.cupon.codigo || '-',
        descuento: `-${formatearMonto(pedido.cupon.descuentoAplicado ?? 0)}`,
        liberado: pedido.cupon.estado === 'LIBERADO',
      }
    : null;

  return {
    id: pedido?.id ?? '',
    fecha: formatearFecha(pedido?.fechaHora),
    cliente: nombreCliente,
    clienteDetalle,
    email: cliente.email || '',
    medioPago,
    estado: 'PAGADO',
    items,
    subtotal: formatearMonto(subtotalNumerico),
    promociones,
    cupon,
    costoEnvio: formatearMonto(pedido?.costoEnvio ?? 0),
    total: formatearMonto(pedido?.total ?? 0),
    observacion: pedido?.observacion ? String(pedido.observacion) : '',
  };
}

/**
 * Genera el PDF del recibo con los mismos datos que el email. Se expone acá
 * para que el endpoint de descarga no tenga que conocer el logo embebido.
 */
export function generarPdfRecibo({ pedido, nombre } = {}) {
  return generarReciboPdf({
    datos: construirDatosRecibo({ pedido, nombre }),
    logoBase64: LOGO_RECIBO_BASE64,
  });
}

// PNG generado desde el logo oficial del frontend
// (comi-rapi-fronted/public/imagenes/logo-comirapi.svg). El SVG original no se
// muestra en Gmail/Outlook y el backend no sirve la carpeta pública del frontend,
// así que se rasteriza una vez y se incrusta en el PDF del recibo. El correo no
// adjunta esta imagen: el logo llega al cliente dentro del único PDF adjunto.
export const LOGO_RECIBO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAANI0lEQVR4nOydCWwU1xnH/zNr73qxsTG2sTkMKQQSDCHcV6DpIUFppaihTVI1baFqIsAVlLQpRYoiUvUQbZRITSgqjSBpQo+UtmlUNagoLQkhBBocjhAIhwkY4wNjL16fu94j35u1vWt7d3auNzPr3Z9G1q49Xj9//3nfe+/73pEVDoeRwTpEZLCUjAAWkxHAYrKQWoQDCPX0XUEgBNaGhREOsa8MAYIofRXY4yU6IGb3XoId/1nB7o0wWTzoR8gnfe3ps7I2BCaDwwnRBYcLggM2wIYChKMWD/rYM84LkcnQq4eTyWMFthIgjEAnejqY9U2GNMjORdYI82WwhwDBLmZ3+mo5pAFdDjfMwmoByOh+L0J+2AqqEM58OHLAH+sECHQw01Mba1uoxc7Ol/wSR6wQINgNn8fWpo+FOq+uQn61wVwBwkFmejv4erVQPXCO4tFzNVGAHi/zObD3sEMOgTUM5JSM/VAzBAgF0N2UMj5HHvJIOSUQDRtU8xeAGltyOyn84A9FYK1CVi6MgKcAFJ9hHr8TwxLHCLhGSxEnXXATgOI2zO0EMYxh7qiY9Vb1fAYXAaij2X1zeLmdRAhMAx2dVA4CBLrgu4m0wlWMLI3RC6MFoGiarxlpCLUHmpplQwVgPf1WpC3OQmTnQSXGpSRZbCeNrU/4PcwIKjFIABbeaUEGMgKZQg1GCEB5q+40a3VlIFMEVSSUdAvAwgxp0uNUSJgZJKQ07qJPABrr0miLY9o2RZHMElZkFn0C+G8NkxCb4ZBZyDgK0CEAtfjqG/00Qpl9tApAoR4W48wgC5koWWOgaSBGv9LVYJnzuXUBzWfRegHeq+hqQncLG34PghJYOaPhLkH+JBRMQ1EFRk2DJYhO5IyRCZpqEoAGXDToNRPq2DUcRf17qHtHY82jkNnYpewqW8TmY5kJJdGcBYl+qF4AqlNd9TCNplO49DfUH1bVuZaDrD92GaZ+HcV3wzTcYxMl0dQLQLG2gCk5lhsncPp5eD4GJwrvxKyNGDMHJkAu0VUU9ycqBWCB/ibwpr0WH+5E7VswgQmfw+zNcI8BbyiTHC9toEYAE9peGrxUv4Yzu9DTDs1QwnbccvZCYYNBIcy7KjH5PmleOzcofeYuG9oaqxGApdd5RtwC3ajajpoD0EPeeHxxN5s/Qvi9+N8jaKtV9IsTV2DBEzrzi0kgLzRknp1izUknP8+eD3UoD67Ta33iM/f1Wp+gF+Urlf4i/em3vs+KwY+eNgx53BULEPJxdD7Uszr2FG5dlLuHHAsZly56IcOgLiab+K+Y5jOoelp5HE01If/QmfeKBeD6+J98Bk0n5G4gx/KlP2P+VnbRi5ETEt5Zd3jAWxo9qIL6u1QYflAlGIiyGV7xpDMManWrX09yz1DHcnZ3/DtvHMfbm3r7+DdPJdRVpqGmwtDgecr94AF1I2lAE1NNlQmgp08iT2cjTv82+W2qHAtpQJcMAxrqyjgNNRWJuqfyvk4z1JeJ+XcUuKBwmOPI69QORR+u07EMImlDTUWignGCPjymKVZQA0LdvBJebddQ+19Fdyp0LApRUp+u7sf0NRg5EcYTZibtWwWloAb0cAv6n3tJxc2kAfl9uuTdixIU1qdzfwAnYkyarAaEg7zWU1BG4frbsASF9en6IVZIHkMzMimN+aWBd1byWzlBVghYN3E6aUMNqbWke8qWgAdkWGkmXTIXFFA3y0UFTR/A/vArZKD3yZatAZ7zqNmP7mZdsXhq8Sg5VTIXBZMHfN9bA/vDr5BkUuoLCTLxPwrEX/wLOur0ZkLo1zvqceXfaK0e8P22q7A/HAsZioR2EgtQf8Tg4M+NqgFv/dwGdwbCtZDSJMbEApDnCRm6vsU3cJ5MTyoIwLWQkmuRb4R5LjBSP5PbArgWUtqgIbEArtEwdu2Ga9SAt6ULYH/KFoEfNMYKh0Tz/vaYeQPezqpk83bsDBVv9iZwJRxMnJKkUdKN91lHuLuFSzeUoPx+1a9ZGsRns5UdrgKMnsFyDznF4EpOcWIBzJ99lYY4CxIPxIb3El+bEApkBLCUcFBGgMyyC/6EQxkBLEVOAJ7Lvu5d9c0VX1i2cd238/NHJrrn4KGje/buO3e+elL5+IdWf+XB1V+W+cDf7f7T62+82eJpXbJwzuYNa2+blHDaRENj0/O7Xj78HouLfPaeBZsr1xaN5pP7VUQ4cS+o8zq/SjBz0Sr6esfUyS/u3B5Xgz2v7Ht2x57Y7zxw/6ptW+P3yjdv/fmbB9/tf5uXl7t7xy9nTI+zIODyJzVr1m/x3Ir2essnjN37wjOWaSCIiQdi/F3Q+YuXK3/0lM83eJCx99V/DrI+se+1/Tt+/8rQD/np9udirU+0t3c8uumJC5c+GXTntdr671ZujbV+5JvrfvBkVxe3tIc8ciNhUzh5+uyGx7Z5vdHpSvTsb392V9ybyc8M0uAXT+8kYYbe6fW2r92w5fSZ6NT2S5evrln/4+aWOHN1P75Qvf6xJ2PLYCZWuqB+8vPzli2eX1xUeOjI+1euJplLO2F82T2L5wUCwXePVpFDl7950fzZFXfeTrWBbpa/k8qwfMmCxzd9r6S4CKYhiDIC1PEbCgwSwD68+tJv4jYevBAcMr0gazazTjNit9TvbGQLEP1t0i7xUixIYUaMPsSZi/zJcHMOXQ0/or0gSts2HGWBz4j12c8U1wDSicKZTSfQeQMZVBEVIM7cfPUdJO8VZFBFtA0YmvzUsGBK8STGDY88DFsypsTELhCYAH29oCtvRJ1PBErCBFSmpKkxKP88VHL92N8bTx3wXP7A19oIq3EVlBZOnlt694rxi74GE3AV9Qlw/dDgdQrUB1W230cUZwHKFiq/vau59sM//uTmuXdgP4qnL7/r4V+5iyaAK+6yPj8zaurgn2lwQfm3qbkbJ/dssqf1CSrYyRc5J4TBXFCflXPHomwxS95GJwMLSocCbIf9ApTMwQgVy51rj/zVc1n3RHOeeKqPUyHBD8FBT3nMOGBEKbtiYduf8ZodXVf1L9geKuSEpQ+CEyJbGCLrZ3juKuK9dha2h28hJfPKzo425RSb9EUyr2wNYIEKXvHq/PIK2B6OhWQNAHv65QUQ+HmhScu/BdvDsZD0+EvBnmQPeBavI81KZ68srrgXNoaGY1RIcKLPvScTgK2m5BWXrnhgm5ilZi8HE3G4RlQ89DPwQugXQMF2NZy3yErHUETMBloKBKChQGZraGNhh24oX6gt5mSyY4YiSibtf5MUaqw5n6eYXpAxY5Jdyrr5WamwnChVGHjSiTIBHM7MqNgYyIwD9wZRPNA1+gzFNGWIGRWfiUhDYore6T95mTpUx7ej5SPbLUtKBEXai2Zi3ha28adOyIBDIgtqtq3U3x/1t+LAd/juTMgJdwlWvCyzBbQiYnqf/aiJtdEvi/oGriefS0nrQ9pVkwqvB/b4x4nrqAx2OkdBDw3HkLroLHwC06kUgFyYni5pSmxPkAg9hSejJYgrqw/3s+3utCYJUnruovbCi9E9AuP8TC2USXBpbYvKliJ10Vx4Mlfiw+g1PcuOXIiaEjV3fAMpCuVFtBWeDOWQO+RTkwAUymDRVPURutxxmPM4UpFZG1nh1SKIzFCy05y1enPRwbZT0cDtqzH3h+r21LYWKurcLZjyVWiArC865G/Rd5yt/9bQ3agV0VGHMy+g5j+wORNXYuajWp59Inukkl67PgF0nqnRUY/qf6Dx/0k2rjefUVNRuhBTVrMJg9pIdnpVP7oPdA4F0d2gdzmfvw2ec2j+iO0U6DmPLtMXerjHoHAaCqejaAb76hwJPZDrzylL6nx67zXgRO1QD7oaDV5Z39nIjkvpamaLPtprWF2JahyCz8uGRXQFZGdOUtclO49drpixC/UI88YhrxwjJ8FdxLZIH1EGIxHgLlW+365BR5qbc7pSSpDgtKREGDTxjf6kK7NCD8wIKjNXxs08pPquM1SX6tC/r34em0EuqJ9AJ5tHlIbEO6JKCUYLgEh7kFaHnAtSpkVjzpyDAJAW+DEN0mHLJ1FqdbUP7PkIAOloMPJF+nPIdoZGWyzYoDivHg9uAkTwe1I7CSMDDS+cBmzzxFkARJrlluHVJAgsEGnQbEH+AkAaKnc3I9yDYYCQjZwiAw+WMUWACD1e6TzE1K0KAsssGj1BzUQB0Lf63sKzezTjcLOokaAovqYKcwWIQAMFn4fvwdAGwpahF/KbGmuFABGoHpBTCtm4YSBHTw6H89R86wSIQLWBGgZ+R7Vqgzr45O4dvBYoxmK1ABFIAJIhaNHmnbGQq3EW6J2BqQZ7CNCLdGxrT4cFFYLN+MuVvI3Zi7FsJUAf1FkiJYJdeo8wSwrZnfwMmV4wLiyvElsKECXMNGCnUHcb1lyL0mqf3pUq1i8+tLkAA6Gea0i6Ii9YljgkHfUUll5H/hFBepwFaUaCyF5TsIy6kmJW7wubkVICDEcs3rw7Q0YAi8kIYDGfAgAA//8v4PlTAAAABklEQVQDAH/UGnjhTUWdAAAAAElFTkSuQmCC';

const escaparHtml = (valor) =>
  String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const textoConSaltos = (valor) => escaparHtml(valor).replace(/\n/g, '<br>');

const celda = (contenido, estilo = '') =>
  `<td style="padding:6px 8px;color:#4a2c17;${estilo}">${contenido}</td>`;

/**
 * Arma la versión HTML del recibo como comprobante comercial de compra y pago.
 * Usa tablas y estilos inline (sin CSS externo ni etiquetas modernas) para que
 * se vea igual en Gmail, Outlook y clientes móviles. Todos los importes salen
 * del pedido ya serializado: no se recalcula nada desde el catálogo.
 */
function armarHtmlRecibo(datos) {
  const filasProductos = datos.items
    .map((item) => {
      const detalle = [
        item.personalizacion.length > 0
          ? `<div style="margin-top:4px;font-size:12px;color:#6b4b32;">Personalización: ${item.personalizacion
              .map(escaparHtml)
              .join('; ')}</div>`
          : '',
        item.nota
          ? `<div style="margin-top:4px;font-size:12px;color:#6b4b32;">Nota: ${textoConSaltos(
              item.nota
            )}</div>`
          : '',
      ].join('');

      return `<tr>
        ${celda(`${escaparHtml(item.nombre)}${detalle}`, 'vertical-align:top;')}
        ${celda(item.cantidad, 'text-align:right;vertical-align:top;')}
        ${celda(
          item.precioUnitario,
          'text-align:right;vertical-align:top;white-space:nowrap;'
        )}
        ${celda(
          item.subtotal,
          'text-align:right;vertical-align:top;white-space:nowrap;'
        )}
      </tr>`;
    })
    .join('');

  const filasPromociones = datos.promociones
    .map(
      (promo) => `<tr>
        ${celda(escaparHtml(promo.nombre))}
        ${celda(promo.descuento, 'text-align:right;white-space:nowrap;')}
      </tr>`
    )
    .join('');

  const filaCupon = datos.cupon
    ? `<tr>
        ${celda(
          `Cupón ${escaparHtml(datos.cupon.nombre)}${
            datos.cupon.liberado
              ? '<div style="margin-top:4px;font-size:12px;color:#6b4b32;">El cupón no se aplicó; el total ya lo refleja.</div>'
              : ''
          }`
        )}
        ${celda(datos.cupon.descuento, 'text-align:right;white-space:nowrap;')}
      </tr>`
    : '';

  const seccionObservaciones = datos.observacion
    ? `<tr>
        <td style="padding:18px 8px 8px;">
          <div style="padding-bottom:6px;border-bottom:1px solid #ecdcc6;color:#4a2c17;font-weight:bold;">Observaciones del pedido</div>
          <div style="margin-top:8px;color:#4a2c17;">${textoConSaltos(
            datos.observacion
          )}</div>
        </td>
      </tr>`
    : '';

  const estiloTitulo =
    'padding-bottom:6px;border-bottom:1px solid #ecdcc6;color:#4a2c17;font-size:12px;font-weight:bold;letter-spacing:1px;';

  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;color:#4a2c17;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">
            <tr>
              <td align="center" style="padding:0 8px 16px;">
                <span style="color:#ff9f1c;font-size:22px;font-weight:bold;letter-spacing:1px;vertical-align:middle;">COMI-RAPI</span>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 8px;">
                <h1 style="margin:0;color:#4a2c17;font-size:20px;line-height:1.3;letter-spacing:1px;">RECIBO DE PAGO</h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 8px 18px;">
                <span style="color:#6b4b32;">Comprobante N.º</span>
                <strong style="color:#ff9f1c;font-size:20px;">#${escaparHtml(
                  datos.id
                )}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:0 8px;"><div style="border-top:1px solid #ecdcc6;font-size:0;line-height:0;">&nbsp;</div></td>
            </tr>
            <tr>
              <td style="padding:16px 8px 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${celda('Fecha', 'color:#6b4b32;')}
                    ${celda(escaparHtml(datos.fecha), 'text-align:right;')}
                  </tr>
                  <tr>
                    ${celda('Cliente', 'color:#6b4b32;')}
                    ${celda(
                      escaparHtml(datos.clienteDetalle),
                      'text-align:right;'
                    )}
                  </tr>
                  <tr>
                    ${celda('Medio de pago', 'color:#6b4b32;')}
                    ${celda(escaparHtml(datos.medioPago), 'text-align:right;')}
                  </tr>
                  <tr>
                    ${celda('Estado', 'color:#6b4b32;')}
                    ${celda(
                      `<strong style="color:#ff9f1c;">${escaparHtml(
                        datos.estado
                      )}</strong>`,
                      'text-align:right;'
                    )}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 8px;">
                <div style="${estiloTitulo}">Detalle de productos</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr style="background:#fff4e2;">
                    ${celda('Producto', 'font-size:12px;font-weight:bold;')}
                    ${celda(
                      'Cant.',
                      'font-size:12px;font-weight:bold;text-align:right;'
                    )}
                    ${celda(
                      'Precio unit.',
                      'font-size:12px;font-weight:bold;text-align:right;white-space:nowrap;'
                    )}
                    ${celda(
                      'Subtotal',
                      'font-size:12px;font-weight:bold;text-align:right;white-space:nowrap;'
                    )}
                  </tr>
                  ${filasProductos}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 8px;">
                <div style="${estiloTitulo}">Resumen de pago</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${celda('Subtotal')}
                    ${celda(
                      datos.subtotal,
                      'text-align:right;white-space:nowrap;'
                    )}
                  </tr>
                  ${filasPromociones}
                  ${filaCupon}
                  <tr>
                    ${celda('Envío')}
                    ${celda(
                      datos.costoEnvio,
                      'text-align:right;white-space:nowrap;'
                    )}
                  </tr>
                  <tr>
                    ${celda(
                      '<strong>Total pagado</strong>',
                      'padding-top:10px;border-top:2px solid #ff9f1c;'
                    )}
                    ${celda(
                      `<strong style="color:#ff9f1c;font-size:20px;">${escaparHtml(
                        datos.total
                      )}</strong>`,
                      'padding-top:10px;border-top:2px solid #ff9f1c;text-align:right;white-space:nowrap;'
                    )}
                  </tr>
                </table>
              </td>
            </tr>
            ${seccionObservaciones}
            <tr>
              <td style="padding:24px 8px 8px;"><div style="border-top:1px solid #ecdcc6;font-size:0;line-height:0;">&nbsp;</div></td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 8px 24px;color:#6b4b32;font-size:12px;">Comprobante generado automáticamente por Comi-Rapi</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Envía al cliente el recibo de un pedido recién confirmado. Reutiliza el mismo
 * transporte SMTP que la recuperación y los cupones, sin duplicar configuración.
 *
 * El contenido se arma exclusivamente con el pedido ya serializado (snapshots
 * persistidos): no se recalculan importes ni se consulta el catálogo. Tampoco se
 * incluye ningún dato de la sucursal, que puede cambiar después de confirmar.
 *
 * @param {object} params
 * @param {string} params.destinatario - Email del cliente dueño del pedido.
 * @param {string} [params.nombre] - Nombre del cliente.
 * @param {object} params.pedido - Pedido serializado con ítems, promos y cupón.
 * @returns {Promise<{ enviado: boolean, motivo?: string }>}
 *   motivo = 'destinatario-invalido' | 'sin-transporte' cuando no se envió.
 */
export async function enviarEmailReciboPedido({
  destinatario,
  nombre,
  pedido,
}) {
  // Validar ANTES de obtener el transporte: un destinatario inválido nunca debe
  // llegar a sendMail. No lanza: el controller registra el motivo devuelto.
  if (!emailValido(destinatario)) {
    return { enviado: false, motivo: 'destinatario-invalido' };
  }

  const datos = construirDatosRecibo({ pedido, nombre });
  const asunto = `Recibo de tu pedido #${datos.id} - Comi-Rapi`;

  const lineas = [
    `Hola${datos.cliente ? ` ${datos.cliente}` : ''},`,
    '',
    'Gracias por tu compra en Comi-Rapi. Este es el recibo de tu pedido.',
    '',
    `Pedido: #${datos.id}`,
    `Fecha: ${datos.fecha}`,
    `Cliente: ${datos.clienteDetalle}`,
    `Medio de pago: ${datos.medioPago}`,
    '',
    'Productos:',
  ];

  for (const item of datos.items) {
    lineas.push(
      `• ${item.cantidad} x ${item.nombre} — ${item.precioUnitario} c/u = ${item.subtotal}`
    );
    if (item.personalizacion.length > 0) {
      lineas.push(`  Personalización: ${item.personalizacion.join('; ')}`);
    }
    if (item.nota) lineas.push(`  Nota: ${item.nota}`);
  }

  if (datos.promociones.length > 0) {
    lineas.push('', 'Promociones:');
    for (const promo of datos.promociones) {
      lineas.push(`• ${promo.nombre} — ${promo.descuento}`);
    }
  }

  if (datos.cupon) {
    lineas.push('', `Cupón: ${datos.cupon.nombre} — ${datos.cupon.descuento}`);
    if (datos.cupon.liberado) {
      lineas.push('  El cupón no se aplicó; el total ya lo refleja.');
    }
  }

  lineas.push('', `Envío: ${datos.costoEnvio}`);

  if (datos.observacion) {
    lineas.push('', `Nota del pedido: ${datos.observacion}`);
  }

  lineas.push('', `Total pagado: ${datos.total}`, '', 'Equipo Comi-Rapi');

  const t = obtenerTransporte();
  if (!t) return { enviado: false, motivo: 'sin-transporte' };

  await t.sendMail({
    from: config.mail.from,
    to: destinatario.trim(),
    subject: asunto,
    // La versión plain se conserva como alternativa para clientes que no
    // renderizan HTML; el diseño comercial va en html con los colores de la
    // marca. Adjuntos visibles: solo el PDF, que ya contiene el logo original.
    text: lineas.join('\n'),
    html: armarHtmlRecibo(datos),
    attachments: [
      {
        filename: `recibo-pedido-${datos.id}.pdf`,
        contentType: 'application/pdf',
        content: generarReciboPdf({
          datos,
          logoBase64: LOGO_RECIBO_BASE64,
        }),
        disposition: 'attachment',
      },
    ],
  });

  return { enviado: true };
}

/**
 * Resuelve los nombres legibles del alcance de un cupón a partir de su
 * `alcanceSnapshot` congelado.
 *
 * @param {object} alcanceSnapshot
 *   `{ global: true }` → todos los productos.
 *   `{ global: false, productoIdsResueltos: [...], categoriaIds: [...] }`
 *   → productos y/o categorías específicas.
 * @returns {Promise<{ tipo: 'global' | 'especifico', productos: string[],
 *   categorias: string[] } | null>}
 */
const obtenerNombresAlcance = async (alcanceSnapshot) => {
  if (!alcanceSnapshot) return null;

  const {
    global,
    productoIdsResueltos = [],
    categoriaIds = [],
  } = alcanceSnapshot;

  if (global) {
    return { tipo: 'global', productos: [], categorias: [] };
  }

  const productos = [];
  const categorias = [];

  const idsProducto = Array.from(
    new Set((productoIdsResueltos || []).map(Number).filter(Number.isFinite))
  );
  if (idsProducto.length > 0) {
    const filas = await db.Producto.findAll({
      where: { id: { [Op.in]: idsProducto } },
      attributes: ['nombre'],
      order: [['nombre', 'ASC']],
    });
    productos.push(...filas.map((f) => f.nombre));
  }

  const idsCategoria = Array.from(
    new Set((categoriaIds || []).map(Number).filter(Number.isFinite))
  );
  if (idsCategoria.length > 0) {
    const filas = await db.Categoria.findAll({
      where: { id: { [Op.in]: idsCategoria } },
      attributes: ['nombre'],
      order: [['nombre', 'ASC']],
    });
    categorias.push(...filas.map((f) => f.nombre));
  }

  return { tipo: 'especifico', productos, categorias };
};

/**
 * Envía a un cliente su cupón individual. Reutiliza el mismo transporte SMTP
 * que la recuperación de contraseña y mantiene el cuerpo en texto plano.
 *
 * @param {object} params
 * @param {string} params.destinatario - Email del cliente.
 * @param {string} [params.nombre] - Nombre del cliente.
 * @param {object} params.cupon - Cupón con código, descuento y vigencia.
 * @param {object} params.emision - Datos de la emisión (nombre, descripción).
 * @returns {Promise<{ enviado: boolean, motivo?: string }>}
 *   motivo = 'sin-transporte' cuando MAIL_TRANSPORT no es 'smtp'.
 */
export async function enviarEmailCupon({
  destinatario,
  nombre,
  cupon,
  emision,
}) {
  const descuento =
    cupon.tipoDescuento === 'PORCENTAJE'
      ? `${Number(cupon.valorDescuento)}% de descuento`
      : `${formatearMonto(cupon.valorDescuento)} de descuento`;

  const condiciones = [];
  if (Number(cupon.compraMinima) > 0) {
    condiciones.push(`Compra mínima: ${formatearMonto(cupon.compraMinima)}.`);
  }
  if (cupon.descuentoMaximo !== null && cupon.descuentoMaximo !== undefined) {
    condiciones.push(
      `Tope de descuento: ${formatearMonto(cupon.descuentoMaximo)}.`
    );
  }
  condiciones.push(
    `Válido del ${formatearFecha(cupon.fechaInicio)} al ${formatearFecha(
      cupon.fechaFin
    )}.`
  );
  condiciones.push(
    `Podés usarlo en ${cupon.usosPermitidos} ${
      Number(cupon.usosPermitidos) === 1 ? 'pedido' : 'pedidos'
    }.`
  );

  const alcance = await obtenerNombresAlcance(cupon.alcanceSnapshot);

  const lineasAlcance = [];
  if (alcance) {
    if (alcance.tipo === 'global') {
      lineasAlcance.push('• Aplica a todos los productos.');
    } else {
      if (alcance.productos.length > 0) {
        lineasAlcance.push(`• Productos: ${alcance.productos.join(', ')}.`);
      }
      if (alcance.categorias.length > 0) {
        lineasAlcance.push(`• Categorías: ${alcance.categorias.join(', ')}.`);
      }
      if (alcance.productos.length === 0 && alcance.categorias.length === 0) {
        lineasAlcance.push('• Aplica a todos los productos.');
      }
    }
  }

  const asunto = `Tu cupón: ${emision.nombre}`;
  const texto = [
    `Hola${nombre ? ` ${nombre}` : ''},`,
    '',
    `Se habilitó un cupón para vos en Comi-Rapi: "${emision.nombre}".`,
    ...(emision.descripcion ? [emision.descripcion, ''] : []),
    'Tu código es:',
    cupon.codigo,
    '',
    `Beneficio: ${descuento}.`,
    ...condiciones,
    ...(lineasAlcance.length > 0
      ? ['', 'Alcance del cupón:', ...lineasAlcance]
      : []),
    '',
    'Seleccioná el cupón en el carrito antes de confirmar el pedido.',
    '',
    'Equipo Comi-Rapi',
  ].join('\n');

  const t = obtenerTransporte();
  if (!t) {
    return { enviado: false, motivo: 'sin-transporte' };
  }

  await t.sendMail({
    from: config.mail.from,
    to: destinatario,
    subject: asunto,
    text: texto,
  });

  return { enviado: true };
}
