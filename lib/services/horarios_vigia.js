/**
 * Service: horarios_vigia
 *
 * Vigía de horarios de atención. Mantiene UN solo temporizador programado para
 * el próximo límite operativo (apertura o corte de pedidos) de todas las
 * sucursales activas. Cuando llega, emite `sucursal_estado` por WebSocket para
 * que los clientes re-consulten el estado real por REST y se reprograma solo.
 *
 * Por qué existe: el canal de tiempo real solo notifica. Sin este vigía, el
 * cierre de una sucursal por horario no genera ningún evento (nadie hizo un
 * cambio en la base) y el cliente se enteraría recién al pagar.
 *
 * Es un complemento, no la autoridad: el backend sigue revalidando horarios al
 * crear el pedido y al confirmar el pago. Si el vigía falla o el proceso se
 * reinicia, la red de seguridad del pago mantiene el comportamiento correcto.
 *
 * Sólo se arranca desde `bin/www.js`: en los tests no hay temporizadores
 * abiertos ni conexiones a la base por esta vía.
 */

import db from '../models';
import { emitirSucursalEstado } from '../realtime';
import { proximaLimite } from './horarios_service';
import { obtenerValor } from './parametros_service';

const { HorarioSucursal, Sucursal } = db;

/** Nunca programar por debajo de 1 s (evita bucles si el reloj va justo). */
const ESPERA_MINIMA_MS = 1000;
/** Re-chequeo periódico: cubre cambios de reloj y ajustes hechos por fuera. */
const ESPERA_MAXIMA_MS = 6 * 60 * 60 * 1000;
/** Si la base no está disponible, se reintenta en un minuto. */
const ESPERA_REINTENTO_MS = 60 * 1000;

/** @type {ReturnType<typeof setTimeout>|null} */
let temporizador = null;
let activo = false;
// Cada programación se queda con un número. Si una consulta vieja termina
// después de una nueva, su resultado se descarta (evita timers duplicados).
let version = 0;

const limpiar = () => {
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
};

const armarTemporizador = (milisegundos) => {
  limpiar();
  temporizador = setTimeout(() => {
    disparar();
  }, milisegundos);
  // El vigía no debe mantener vivo al proceso (scripts, tests, apagado).
  if (temporizador && typeof temporizador.unref === 'function') {
    temporizador.unref();
  }
};

const programar = async () => {
  if (!activo) return;
  const miVersion = ++version;
  try {
    const [sucursales, margenMinutos] = await Promise.all([
      Sucursal.findAll({
        where: { activa: true },
        include: [{ model: HorarioSucursal, as: 'horarios', required: false }],
      }),
      obtenerValor('margenCierreMinutos'),
    ]);
    if (!activo || miVersion !== version) return;

    const ahora = new Date();
    let menorEnSegundos = null;
    sucursales.forEach((sucursal) => {
      const limite = proximaLimite(sucursal.horarios, {
        ahora,
        margenMinutos,
      });
      if (
        limite &&
        (menorEnSegundos === null || limite.segundos < menorEnSegundos)
      ) {
        menorEnSegundos = limite.segundos;
      }
    });

    const espera = Math.min(
      ESPERA_MAXIMA_MS,
      Math.max(
        ESPERA_MINIMA_MS,
        menorEnSegundos === null
          ? ESPERA_MAXIMA_MS
          : menorEnSegundos * 1000 + 1000
      )
    );
    armarTemporizador(espera);
  } catch {
    // La base puede no estar lista todavía: se reintenta sin tumbar el server.
    if (!activo || miVersion !== version) return;
    armarTemporizador(ESPERA_REINTENTO_MS);
  }
};

const disparar = async () => {
  temporizador = null;
  if (!activo) return;
  // Broadcast: el evento no lleva la verdad, sólo el aviso de que hay que
  // releer las sucursales (GET /api/sucursales) o la disponibilidad del pedido.
  emitirSucursalEstado({ ahora: new Date().toISOString() });
  await programar();
};

/**
 * Arranca el vigía (idempotente). Pensado para `bin/www.js`, después de
 * configurar Socket.IO.
 */
export const iniciarVigiaHorarios = () => {
  if (activo) return;
  activo = true;
  programar();
};

/** Detiene el vigía y libera el temporizador. */
export const detenerVigiaHorarios = () => {
  activo = false;
  version += 1;
  limpiar();
};

/**
 * Reprograma el próximo límite. Se llama después de crear, editar o dar de
 * baja una sucursal, y al cambiar el margen global de cierre. Si el vigía no
 * está activo (tests, scripts) no hace nada.
 */
export const reprogramarVigiaHorarios = () => {
  if (!activo) return;
  programar();
};
