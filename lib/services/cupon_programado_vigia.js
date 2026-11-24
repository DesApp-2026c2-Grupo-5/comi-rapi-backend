/**
 * Vigía de cupones programados.
 *
 * Comprueba periódicamente si alguna emisión programada pasó a ACTIVO y envía
 * sus correos una sola vez. Sólo se arranca desde `bin/www.js`: en los tests
 * no hay temporizadores abiertos ni conexiones a la base por esta vía.
 */

import { enviarCuponesProgramados } from './cupon_programados';

/** Frecuencia de barrido: el envío no necesita ser instantáneo. */
const INTERVALO_MS = 10 * 1000;
/** Si la base no está disponible, se reintenta en un minuto. */
const ESPERA_REINTENTO_MS = 60 * 1000;

/** @type {ReturnType<typeof setTimeout>|null} */
let temporizador = null;
let activo = false;
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
  if (temporizador && typeof temporizador.unref === 'function') {
    temporizador.unref();
  }
};

const ciclo = async () => {
  temporizador = null;
  if (!activo) return;
  const miVersion = ++version;
  try {
    await enviarCuponesProgramados();
    if (!activo || miVersion !== version) return;
    programar(INTERVALO_MS);
  } catch {
    // La base puede no estar lista todavía: se reintenta sin tumbar el server.
    if (!activo || miVersion !== version) return;
    programar(ESPERA_REINTENTO_MS);
  }
};

/** Arranca el vigía (idempotente). */
export const iniciarVigiaCuponesProgramados = () => {
  if (activo) return;
  activo = true;
  // Primera pasada inmediata: cubre las emisiones activadas mientras el
  // proceso estuvo caído, sin esperar al primer intervalo.
  ciclo();
};

/** Detiene el vigía y libera el temporizador. */
export const detenerVigiaCuponesProgramados = () => {
  activo = false;
  version += 1;
  limpiar();
};
