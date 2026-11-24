/**
 * Envío de cupones programados.
 *
 * Una emisión con `fechaInicio` futura crea sus cupones pero NO envía correos:
 * quedan con `estadoEnvio: PENDIENTE` y `enviadoEn: null`. Este servicio los
 * envía cuando la fecha de inicio ya pasó, reutilizando `enviarEmailCupon` y
 * las mismas transiciones de `ESTADOS_ENVIO` del flujo original.
 *
 * Idempotencia: el estado `ENVIADO` (junto con `enviadoEn`) es la fuente de
 * verdad. Los cupones se seleccionan con `FOR UPDATE` dentro de una transacción
 * y se marcan como enviados en esa misma transacción; un reintento, un reinicio
 * del proceso o dos pasadas concurrentes nunca vuelven a enviar el mismo cupón.
 * Tampoco se notifican cupones cancelados (`activo: false`), programados ni
 * vencidos.
 */

import { Op } from 'sequelize';
import db from '../models';
import { enviarEmailCupon } from './email_service';
import {
  ESTADOS_ENVIO,
  emailValido,
  contarEstadoEmision,
  estadoEmisionDesdeConteo,
} from './cupon_emisiones';
import { emitirCuponActualizado, emitirEmisionActualizada } from '../realtime';

const { Cupon, CuponEmision, Usuario } = db;

/** Evita dos pasadas concurrentes sobre la misma emisión dentro del proceso. */
const emisionesEnProceso = new Set();

const aFecha = (valor) => {
  if (valor instanceof Date)
    return Number.isFinite(valor.getTime()) ? valor : null;
  if (valor == null || valor === '') return null;
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
};

/**
 * Envía todos los cupones programados que ya están activos y vigentes.
 * @param {{ahora?: Date|string, enviarEmail?: Function}} opciones
 * @returns {Promise<{emisiones: number, enviados: number, fallidos: number}>}
 */
export const enviarCuponesProgramados = async ({
  ahora = new Date(),
  enviarEmail = enviarEmailCupon,
} = {}) => {
  const momento = aFecha(ahora) || new Date();
  const resultado = { emisiones: 0, enviados: 0, fallidos: 0 };

  const candidatas = await Cupon.findAll({
    where: {
      activo: true,
      estadoEnvio: ESTADOS_ENVIO.PENDIENTE,
      enviadoEn: null,
      fechaInicio: { [Op.lte]: momento },
      fechaFin: { [Op.gte]: momento },
    },
    include: [
      {
        model: CuponEmision,
        as: 'emision',
        attributes: ['id', 'fechaFin'],
        where: { fechaFin: { [Op.gte]: momento } },
      },
    ],
    attributes: ['id', 'emisionId'],
  });

  const emisionIds = [
    ...new Set(candidatas.map((c) => Number(c.emisionId)).filter(Boolean)),
  ];

  for (const emisionId of emisionIds) {
    if (emisionesEnProceso.has(emisionId)) continue;
    emisionesEnProceso.add(emisionId);
    try {
      const emision = await CuponEmision.findByPk(emisionId, {
        attributes: ['id', 'nombre', 'descripcion', 'fechaFin'],
      });
      if (!emision) continue;
      const fin = aFecha(emision.fechaFin);
      if (fin && fin.getTime() < momento.getTime()) continue;

      const transaction = await db.sequelize.transaction();
      try {
        const cupones = await Cupon.findAll({
          where: {
            emisionId,
            activo: true,
            estadoEnvio: ESTADOS_ENVIO.PENDIENTE,
            enviadoEn: null,
            fechaInicio: { [Op.lte]: momento },
            fechaFin: { [Op.gte]: momento },
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
          order: [['id', 'ASC']],
        });

        let enviados = 0;
        let fallidos = 0;
        for (const cupon of cupones) {
          const usuario = await Usuario.findByPk(cupon.usuarioId, {
            transaction,
          });
          try {
            if (!usuario || !emailValido(usuario.email)) {
              throw new Error('El cliente no tiene email valido');
            }
            const respuesta = await enviarEmail({
              destinatario: usuario.email,
              nombre: usuario.nombre,
              cupon: cupon.toJSON ? cupon.toJSON() : cupon,
              emision: {
                nombre: emision.nombre,
                descripcion: emision.descripcion,
              },
            });
            if (respuesta && respuesta.enviado === false) {
              throw new Error(respuesta.motivo || 'No se pudo enviar el email');
            }
            await cupon.update(
              {
                estadoEnvio: ESTADOS_ENVIO.ENVIADO,
                enviadoEn: momento,
                errorEnvio: null,
              },
              { transaction }
            );
            enviados += 1;
          } catch (error) {
            await cupon.update(
              {
                estadoEnvio: ESTADOS_ENVIO.FALLIDO,
                enviadoEn: null,
                errorEnvio: String(error.message || error),
              },
              { transaction }
            );
            fallidos += 1;
          }
        }

        if (cupones.length > 0) {
          const conteo = await contarEstadoEmision(emisionId, { transaction });
          await emision.update(
            {
              cantidadEnviados: conteo.enviados,
              cantidadFallidos: conteo.fallidos,
              estado: estadoEmisionDesdeConteo(conteo),
              bloqueoToken: null,
              bloqueoExpiraEn: null,
            },
            { transaction }
          );
          resultado.emisiones += 1;
        }
        resultado.enviados += enviados;
        resultado.fallidos += fallidos;

        await transaction.commit();
        // Sólo hubo cambios si había cupones pendientes: avisos post-commit.
        // Al cliente se lo avisa recién cuando el correo salió: los que
        // quedaron FALLIDO no aparecen en "Mis cupones" y no generan refrescos.
        if (cupones.length > 0) {
          emitirEmisionActualizada(emisionId);
          for (const cupon of cupones) {
            if (cupon.estadoEnvio === ESTADOS_ENVIO.ENVIADO) {
              emitirCuponActualizado(cupon.usuarioId, cupon.id, emisionId);
            }
          }
        }
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } finally {
      emisionesEnProceso.delete(emisionId);
    }
  }

  return resultado;
};
