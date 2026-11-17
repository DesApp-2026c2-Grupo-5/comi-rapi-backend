/**
 * Servicio de envío de emails.
 *
 * La lógica de recuperación NO conoce Mailpit: habla con este servicio, y este
 * servicio traduce a SMTP usando la configuración. Cambiar de Mailpit a un
 * proveedor real (SendGrid, SES, Brevo, Mailgun...) es solo cambiar las
 * variables SMTP_* en el .env, sin tocar código.
 *
 * El cuerpo del email se arma acá con plantillas simples en texto plano.
 */
import { Op } from 'sequelize';
import nodemailer from 'nodemailer';
import config from '../config/config';
import db from '../models';

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
