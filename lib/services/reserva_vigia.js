/**
 * Vigía de reservas de stock.
 *
 * Los pedidos PENDIENTES reservan stock al crearse. Si el cliente no paga en el
 * plazo configurado (`minutosReservaStock`, default 15), este vigía los cancela
 * en segundo plano: repone el stock, deja el historial y emite el cambio por
 * WebSocket para que la pantalla de pago vuelva al carrito.
 *
 * Se ejecuta cada pocos segundos y no reprograma por pedido: una pasada
 * encuentra todos los vencidos con una consulta por estado + fecha. Alcanza
 * para que la liberación sea imperceptible; el pago sigue siendo la autoridad
 * (revalida el plazo con la fila bloqueada).
 *
 * Sólo se arranca desde `bin/www.js`: en los tests no hay temporizadores
 * abiertos ni conexiones a la base por esta vía.
 */

import { emitirPedidoActualizado, emitirStockActualizado } from '../realtime';
import { cancelarPedidosVencidos } from './reserva_pedidos';

/** Frecuencia de barrido. La reserva es de minutos: 10 s no cambia la regla. */
const INTERVALO_MS = 10 * 1000;
/** Si la base no está disponible, se reintenta en un minuto. */
const ESPERA_REINTENTO_MS = 60 * 1000;

/** @type {ReturnType<typeof setTimeout>|null} */
let temporizador = null;
let activo = false;
// Cada programación se queda con un número. Si una pasada vieja termina después
// de una nueva, su resultado se descarta (evita temporizadores duplicados).
let version = 0;

const limpiar = () => {
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
};

const programar = (milisegundos) => {
  limpiar();
  temporizador = setTimeout(() => {
    ciclo();
  }, milisegundos);
  // El vigía no debe mantener vivo al proceso (scripts, tests, apagado).
  if (temporizador && typeof temporizador.unref === 'function') {
    temporizador.unref();
  }
};

const emitirCancelacion = (resultado) => {
  emitirStockActualizado(resultado.sucursalId, {
    productoIds: [
      ...new Set(
        resultado.filasStock
          .filter((fila) => fila.productoId)
          .map((fila) => Number(fila.productoId))
      ),
    ],
    insumoIds: [
      ...new Set(
        resultado.filasStock
          .filter((fila) => fila.insumoId)
          .map((fila) => Number(fila.insumoId))
      ),
    ],
  });
  emitirPedidoActualizado(resultado.pedidoId, resultado.sucursalId);
};

const ciclo = async () => {
  temporizador = null;
  if (!activo) return;
  const miVersion = ++version;
  try {
    const cancelados = await cancelarPedidosVencidos();
    if (!activo || miVersion !== version) return;
    cancelados.forEach(emitirCancelacion);
    programar(INTERVALO_MS);
  } catch {
    // La base puede no estar lista todavía: se reintenta sin tumbar el server.
    if (!activo || miVersion !== version) return;
    programar(ESPERA_REINTENTO_MS);
  }
};

/**
 * Arranca el vigía (idempotente). Pensado para `bin/www.js`, después de
 * configurar Socket.IO.
 */
export const iniciarVigiaReservas = () => {
  if (activo) return;
  activo = true;
  // Primera pasada inmediata: limpia reservas vencidas mientras el proceso
  // estuvo caído, sin esperar el primer intervalo.
  ciclo();
};

/** Detiene el vigía y libera el temporizador. */
export const detenerVigiaReservas = () => {
  activo = false;
  version += 1;
  limpiar();
};
