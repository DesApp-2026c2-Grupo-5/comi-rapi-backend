/**
 * Service: horarios_service
 *
 * Horarios de atención estructurados por sucursal (`HorarioSucursal`).
 *
 * Reglas de negocio:
 *   - `diaSemana`: 1 = lunes … 7 = domingo (ISO-8601).
 *   - `apertura` / `cierre` son el horario REAL del local (10:00–23:00). El
 *     corte de pedidos se DERIVA restando el parámetro global
 *     `margenCierreMinutos` (30 por defecto): el local cierra físicamente a las
 *     23:00 y la página deja de tomar pedidos a las 22:30. Esos minutos son el
 *     colchón para terminar los pedidos de última hora.
 *   - `cierre <= apertura` significa que la franja cruza la medianoche
 *     (19:00–02:00) y pertenece al día de apertura. Se evalúan también las
 *     franjas del día anterior.
 *   - Una sucursal sin franjas está cerrada.
 *   - Se permiten varias franjas por día y solapamientos: "abierta" es caer en
 *     cualquiera de ellas. Se rechazan duplicados exactos.
 *   - Una franja más corta que el margen no tiene ventana de pedidos.
 *
 * Toda la evaluación se hace en `America/Argentina/Buenos_Aires` con `Intl`:
 * no depende del TZ del servidor. Quien llama pasa UN `ahora` por request para
 * que todas las sucursales se evalúen con el mismo instante.
 */

export const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

/** Minutos de un día. */
const MINUTOS_DIA = 24 * 60;

const DIAS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** El payload de horarios no respeta el formato esperado. */
export class HorarioInvalidoError extends Error {
  constructor(mensaje) {
    super(mensaje || 'El horario de atención es inválido');
    this.name = 'HorarioInvalidoError';
  }
}

/**
 * Parte un instante en la zona horaria de operación.
 * @param {Date} [ahora]
 * @returns {{ diaSemana: number, minutos: number, segundos: number }}
 */
export function partesDeAhora(ahora = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const partes = {};
  formatter.formatToParts(ahora).forEach((parte) => {
    if (parte.type !== 'literal') {
      partes[parte.type] = parte.value;
    }
  });
  // `hour12: false` puede devolver "24" a la medianoche en algunas versiones
  // de ICU: se normaliza antes de operar.
  const hora = Number(partes.hour) % 24;
  const minuto = Number(partes.minute);
  const diaJs = new Date(
    Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day))
  ).getUTCDay();
  return {
    diaSemana: diaJs === 0 ? 7 : diaJs,
    minutos: hora * 60 + minuto,
    segundos: Number(partes.second),
  };
}

/** 'HH:MM' / 'HH:MM:SS' / Date → minutos desde la medianoche (o null). */
function aMinutos(valor) {
  const match = String(valor ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const horas = Number(match[1]);
  const minutos = Number(match[2]);
  if (horas > 23 || minutos > 59) return null;
  return horas * 60 + minutos;
}

/** Minutos desde la medianoche → 'HH:MM'. */
export function minutosAHora(minutos) {
  const normalizado =
    ((Number(minutos) % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  const horas = Math.floor(normalizado / 60);
  return `${String(horas).padStart(2, '0')}:${String(normalizado % 60).padStart(
    2,
    '0'
  )}`;
}

/** Minutos desde la medianoche → 'HH:MM:SS' (formato de la columna TIME). */
function minutosAHoraConSegundos(minutos) {
  return `${minutosAHora(minutos)}:00`;
}

/**
 * Normaliza las filas de horarios a una forma interna, tolerando instancias de
 * Sequelize. Ignora filas sin día u horas válidas.
 */
function normalizarFilas(horarios) {
  return (Array.isArray(horarios) ? horarios : [])
    .map((horario) => {
      const datos =
        horario && horario.get ? horario.get({ plain: true }) : horario;
      if (!datos || typeof datos !== 'object') return null;
      const diaSemana = Number(datos.diaSemana);
      const aperturaMin = aMinutos(datos.apertura);
      const cierreMin = aMinutos(datos.cierre);
      if (
        !Number.isInteger(diaSemana) ||
        diaSemana < 1 ||
        diaSemana > 7 ||
        aperturaMin === null ||
        cierreMin === null
      ) {
        return null;
      }
      return { diaSemana, aperturaMin, cierreMin };
    })
    .filter(Boolean);
}

/** Desfase en días entre el día de la franja y el día actual (0 o -1). */
function desfaseDeDia(diaFranja, diaHoy) {
  if (diaFranja === diaHoy) return 0;
  const anterior = diaHoy === 1 ? 7 : diaHoy - 1;
  if (diaFranja === anterior) return -1;
  return null;
}

/**
 * Franja vigente de una sucursal, con su corte de pedidos.
 * @param {Array} horarios - Filas de `HorarioSucursal`.
 * @param {object} opciones - { ahora, margenMinutos }.
 * @returns {object|null} null si la sucursal no está tomando pedidos.
 */
export function franjaVigente(
  horarios,
  { ahora = new Date(), margenMinutos = 0 } = {}
) {
  const { diaSemana, minutos, segundos } = partesDeAhora(ahora);
  const margen = Math.max(0, Number(margenMinutos) || 0);
  let vigente = null;

  for (const fila of normalizarFilas(horarios)) {
    const desfase = desfaseDeDia(fila.diaSemana, diaSemana);
    if (desfase === null) continue;

    const abre = desfase * MINUTOS_DIA + fila.aperturaMin;
    const cruzaMedianoche = fila.cierreMin <= fila.aperturaMin;
    const cierra =
      desfase * MINUTOS_DIA +
      (cruzaMedianoche ? fila.cierreMin + MINUTOS_DIA : fila.cierreMin);
    const cortePedidos = cierra - margen;
    // Una franja más corta que el margen no tiene ventana de pedidos: se
    // informa en el formulario, no se abre por un rato.
    if (cortePedidos <= abre) continue;

    if (minutos >= abre && minutos < cortePedidos) {
      const segundosRestantes = (cortePedidos - minutos) * 60 - segundos;
      // Si dos franjas se solapan, manda la que cierra más tarde: el aviso al
      // cliente tiene que ser el más optimista pero veraz.
      if (!vigente || segundosRestantes > vigente.segundosRestantes) {
        vigente = {
          franja: {
            diaSemana: fila.diaSemana,
            apertura: minutosAHora(fila.aperturaMin),
            cierre: minutosAHora(fila.cierreMin),
          },
          abre,
          cierra,
          cortePedidos,
          cierrePedidos: minutosAHora(cortePedidos),
          cruzaMedianoche,
          segundosRestantes,
        };
      }
    }
  }

  return vigente;
}

/**
 * ¿La sucursal está tomando pedidos ahora?
 * @param {Array} horarios
 * @param {object} opciones - { ahora, margenMinutos }.
 * @returns {boolean}
 */
export function estaAbierta(horarios, opciones = {}) {
  return franjaVigente(horarios, opciones) !== null;
}

/**
 * Próxima apertura a partir de un instante.
 * @param {Array} horarios
 * @param {object} opciones - { ahora }.
 * @returns {{ diaSemana: number, diaOffset: number, apertura: string, minutosHasta: number }|null}
 */
export function proximaApertura(horarios, { ahora = new Date() } = {}) {
  const filas = normalizarFilas(horarios);
  if (filas.length === 0) return null;
  const { diaSemana, minutos } = partesDeAhora(ahora);

  for (let diaOffset = 0; diaOffset <= 7; diaOffset += 1) {
    const dia = ((diaSemana - 1 + diaOffset) % 7) + 1;
    const delDia = filas
      .filter((fila) => fila.diaSemana === dia)
      .sort((a, b) => a.aperturaMin - b.aperturaMin);
    for (const fila of delDia) {
      if (diaOffset === 0 && fila.aperturaMin <= minutos) continue;
      return {
        diaSemana: dia,
        diaOffset,
        apertura: minutosAHora(fila.aperturaMin),
        minutosHasta: diaOffset * MINUTOS_DIA + fila.aperturaMin - minutos,
      };
    }
  }
  return null;
}

/**
 * Próxima apertura considerando VARIAS sucursales: la más próxima en el
 * tiempo. Sirve para el mensaje "volvemos a abrir el lunes a las 11:00".
 * @param {Array<Array>} listaDeHorarios - Una entrada por sucursal.
 * @param {object} opciones - { ahora }.
 */
export function proximaAperturaEntre(listaDeHorarios, { ahora } = {}) {
  let mejor = null;
  for (const horarios of listaDeHorarios || []) {
    const proxima = proximaApertura(horarios, { ahora });
    if (proxima && (!mejor || proxima.minutosHasta < mejor.minutosHasta)) {
      mejor = proxima;
    }
  }
  return mejor;
}

/**
 * Próximo límite operativo de un horario: la apertura o el corte de pedidos
 * más cercano en el tiempo. Lo usa el vigía del backend para emitir
 * `sucursal_estado` justo cuando una sucursal abre o deja de tomar pedidos.
 *
 * Se consideran la franja de hoy, la de ayer si cruza medianoche y los siete
 * días siguientes, de modo que siempre hay un límite mientras haya franjas.
 *
 * @param {Array} horarios - Filas de `HorarioSucursal`.
 * @param {object} opciones - { ahora, margenMinutos }.
 * @returns {{segundos: number, tipo: 'apertura'|'corte', diaSemana: number}|null}
 */
export function proximaLimite(
  horarios,
  { ahora = new Date(), margenMinutos = 0 } = {}
) {
  const filas = normalizarFilas(horarios);
  if (filas.length === 0) return null;
  const margen = Math.max(0, Number(margenMinutos) || 0);
  const { diaSemana, minutos, segundos } = partesDeAhora(ahora);
  const ahoraEnSegundos = minutos * 60 + segundos;
  let mejor = null;

  // -1 incluye la franja de ayer que cruza medianoche y todavía está vigente.
  for (let diaOffset = -1; diaOffset <= 8; diaOffset += 1) {
    const dia = ((((diaSemana - 1 + diaOffset) % 7) + 7) % 7) + 1;
    for (const fila of filas) {
      if (fila.diaSemana !== dia) continue;
      const cruzaMedianoche = fila.cierreMin <= fila.aperturaMin;
      const abre = diaOffset * MINUTOS_DIA + fila.aperturaMin;
      const cierra =
        diaOffset * MINUTOS_DIA +
        (cruzaMedianoche ? fila.cierreMin + MINUTOS_DIA : fila.cierreMin);
      const corte = cierra - margen;
      // Una franja más corta que el margen nunca toma pedidos: no hay
      // transición operativa que avisar.
      if (corte <= abre) continue;
      for (const [limite, tipo] of [
        [abre, 'apertura'],
        [corte, 'corte'],
      ]) {
        const delta = limite * 60 - ahoraEnSegundos;
        if (delta > 1 && (!mejor || delta < mejor.segundos)) {
          mejor = { segundos: delta, tipo, diaSemana: fila.diaSemana };
        }
      }
    }
  }
  return mejor;
}

/** Normaliza un horario de entrada a 'HH:MM:SS' (o null si es inválido). */
function normalizarHoraEntrada(valor) {
  const minutos = aMinutos(valor);
  return minutos === null ? null : minutosAHoraConSegundos(minutos);
}

/**
 * Valida y normaliza el payload de horarios de una sucursal.
 *
 * Acepta las dos formas:
 *   - Plana: `[{ diaSemana, apertura, cierre }]`
 *   - Agrupada por día: `[{ diaSemana, franjas: [{ apertura, cierre }] }]`
 *
 * @param {*} horarios
 * @returns {Array<{ diaSemana: number, apertura: string, cierre: string }>}
 * @throws {HorarioInvalidoError}
 */
export function normalizarHorarios(horarios) {
  if (!Array.isArray(horarios)) {
    throw new HorarioInvalidoError('El horario tiene que ser una lista');
  }

  const planas = [];
  horarios.forEach((entrada) => {
    if (!entrada || typeof entrada !== 'object') {
      throw new HorarioInvalidoError(
        'Cada día del horario tiene que ser un objeto'
      );
    }
    const franjas = Array.isArray(entrada.franjas)
      ? entrada.franjas
      : [entrada];
    franjas.forEach((franja) => {
      planas.push({
        diaSemana: entrada.diaSemana,
        apertura: franja.apertura,
        cierre: franja.cierre,
      });
    });
  });

  if (planas.length > 0 && planas.length > 7 * 6) {
    throw new HorarioInvalidoError(
      'No se pueden cargar más de 6 franjas por día'
    );
  }

  const vistas = new Set();
  return planas.map((entrada) => {
    const diaSemana = Number(entrada.diaSemana);
    if (!Number.isInteger(diaSemana) || diaSemana < 1 || diaSemana > 7) {
      throw new HorarioInvalidoError(
        'El día de la semana tiene que ser un número entre 1 (lunes) y 7 (domingo)'
      );
    }
    const apertura = normalizarHoraEntrada(entrada.apertura);
    const cierre = normalizarHoraEntrada(entrada.cierre);
    if (!apertura || !cierre) {
      throw new HorarioInvalidoError(
        `El horario del ${DIAS[
          diaSemana - 1
        ].toLowerCase()} tiene una hora inválida`
      );
    }
    if (apertura === cierre) {
      throw new HorarioInvalidoError(
        `El horario del ${DIAS[
          diaSemana - 1
        ].toLowerCase()} no puede abrir y cerrar a la misma hora`
      );
    }
    const clave = `${diaSemana}|${apertura}|${cierre}`;
    if (vistas.has(clave)) {
      throw new HorarioInvalidoError(
        `El horario del ${DIAS[diaSemana - 1].toLowerCase()} está repetido`
      );
    }
    vistas.add(clave);
    return { diaSemana, apertura, cierre };
  });
}

/**
 * Agrupa las franjas por día (siempre los siete días, aunque estén cerrados).
 * Es la forma que consume el editor del superadmin y la API pública.
 * @param {Array} horarios
 * @returns {Array<{ diaSemana: number, dia: string, diaCorto: string, franjas: Array }>}
 */
export function agruparHorarios(horarios) {
  const filas = normalizarFilas(horarios);
  return DIAS.map((dia, indice) => {
    const diaSemana = indice + 1;
    return {
      diaSemana,
      dia,
      diaCorto: DIAS_CORTOS[indice],
      franjas: filas
        .filter((fila) => fila.diaSemana === diaSemana)
        .sort((a, b) => a.aperturaMin - b.aperturaMin)
        .map((fila) => ({
          apertura: minutosAHora(fila.aperturaMin),
          cierre: minutosAHora(fila.cierreMin),
        })),
    };
  });
}

/**
 * Texto legible de un horario: agrupa días consecutivos con las mismas franjas.
 * Ej.: "Lun a Dom 10:00 a 23:00", "Lun a Vie 11:00 a 15:00 y 19:00 a 23:00 ·
 * Sáb y Dom cerrado".
 */
export function formatearHorarios(horarios) {
  const agrupado = agruparHorarios(horarios);
  const bloques = [];
  agrupado.forEach((dia) => {
    const firma =
      dia.franjas.length === 0
        ? 'cerrado'
        : dia.franjas.map((f) => `${f.apertura}-${f.cierre}`).join('|');
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && ultimo.firma === firma) {
      ultimo.hasta = dia.diaSemana;
    } else {
      bloques.push({ firma, desde: dia.diaSemana, hasta: dia.diaSemana });
    }
  });

  return bloques
    .map((bloque) => {
      const dias =
        bloque.desde === bloque.hasta
          ? DIAS_CORTOS[bloque.desde - 1]
          : bloque.hasta - bloque.desde === 1
          ? `${DIAS_CORTOS[bloque.desde - 1]} y ${
              DIAS_CORTOS[bloque.hasta - 1]
            }`
          : `${DIAS_CORTOS[bloque.desde - 1]} a ${
              DIAS_CORTOS[bloque.hasta - 1]
            }`;
      if (bloque.firma === 'cerrado') {
        return `${dias} cerrado`;
      }
      const franjas = bloque.firma
        .split('|')
        .map((par) => {
          const [apertura, cierre] = par.split('-');
          return `${apertura} a ${cierre}`;
        })
        .join(' y ');
      return `${dias} ${franjas}`;
    })
    .join(' · ');
}

/**
 * Texto de la próxima apertura: "hoy a las 19:00" / "el lunes a las 11:00".
 */
export function formatearProximaApertura(proxima) {
  if (!proxima) return null;
  const dia =
    proxima.diaOffset === 0
      ? 'hoy'
      : proxima.diaOffset === 1
      ? 'mañana'
      : `el ${DIAS[proxima.diaSemana - 1].toLowerCase()}`;
  return `${dia} a las ${proxima.apertura}`;
}

/** Mensaje de rechazo cuando no hay ninguna sucursal tomando pedidos. */
export function mensajeCerrado(proxima) {
  const base = 'Lo sentimos, las sucursales cercanas ya están cerradas.';
  const detalle = formatearProximaApertura(proxima);
  return detalle ? `${base} Volvemos a abrir ${detalle}.` : base;
}

export { DIAS, DIAS_CORTOS };
