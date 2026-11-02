/**
 * Tests de horarios_service.
 *
 * Reglas: franja por día, corte de pedidos = cierre real − margen global,
 * cruce de medianoche y evaluación en America/Argentina/Buenos_Aires
 * (independiente del TZ del servidor).
 */

import {
  agruparHorarios,
  estaAbierta,
  formatearHorarios,
  formatearProximaApertura,
  franjaVigente,
  HorarioInvalidoError,
  mensajeCerrado,
  normalizarHorarios,
  partesDeAhora,
  proximaApertura,
  proximaLimite,
} from './horarios_service';

/** Franjas de un solo día, en formato de la tabla. */
function franja(diaSemana, apertura, cierre) {
  return [{ diaSemana, apertura, cierre }];
}

/** Instante en la zona de Buenos Aires (UTC-3, sin horario de verano). */
function enArgentina(isoLocal) {
  return new Date(`${isoLocal}-03:00`);
}

describe('horarios_service', () => {
  describe('partesDeAhora', () => {
    test('devuelve día ISO y minutos en la zona de Buenos Aires', () => {
      // Sábado 31/10/2026 12:34 en Argentina.
      const partes = partesDeAhora(enArgentina('2026-10-31T12:34:00'));
      expect(partes.diaSemana).toBe(6); // sábado
      expect(partes.minutos).toBe(12 * 60 + 34);
      expect(partes.segundos).toBe(0);
    });

    test('la medianoche sigue siendo el final del día anterior', () => {
      const partes = partesDeAhora(enArgentina('2026-11-01T00:00:00'));
      expect(partes.diaSemana).toBe(7); // domingo
      expect(partes.minutos).toBe(0);
    });
  });

  describe('franjaVigente y margen de cierre', () => {
    const horarios = franja(6, '10:00:00', '23:00:00'); // sábado

    test('abierta al mediodía', () => {
      const resultado = franjaVigente(horarios, {
        ahora: enArgentina('2026-10-31T12:00:00'),
        margenMinutos: 30,
      });
      expect(resultado).not.toBeNull();
      expect(resultado.cierrePedidos).toBe('22:30');
    });

    test('22:29 todavía toma pedidos', () => {
      expect(
        estaAbierta(horarios, {
          ahora: enArgentina('2026-10-31T22:29:59'),
          margenMinutos: 30,
        })
      ).toBe(true);
    });

    test('22:30 ya no toma pedidos (borde exacto del corte)', () => {
      expect(
        estaAbierta(horarios, {
          ahora: enArgentina('2026-10-31T22:30:00'),
          margenMinutos: 30,
        })
      ).toBe(false);
    });

    test('el local sigue cerrado a las 22:45 aunque cierre físicamente 23:00', () => {
      expect(
        estaAbierta(horarios, {
          ahora: enArgentina('2026-10-31T22:45:00'),
          margenMinutos: 30,
        })
      ).toBe(false);
    });

    test('sin margen sigue tomando pedidos hasta el cierre', () => {
      expect(
        estaAbierta(horarios, {
          ahora: enArgentina('2026-10-31T22:59:00'),
          margenMinutos: 0,
        })
      ).toBe(true);
    });

    test('fuera de la franja (antes de abrir) está cerrada', () => {
      expect(
        estaAbierta(horarios, {
          ahora: enArgentina('2026-10-31T09:59:00'),
          margenMinutos: 30,
        })
      ).toBe(false);
    });

    test('un día sin franjas está cerrado', () => {
      expect(
        estaAbierta([], {
          ahora: enArgentina('2026-10-31T12:00:00'),
          margenMinutos: 30,
        })
      ).toBe(false);
    });

    test('una franja más corta que el margen no tiene ventana de pedidos', () => {
      expect(
        estaAbierta(franja(6, '10:00:00', '10:20:00'), {
          ahora: enArgentina('2026-10-31T10:10:00'),
          margenMinutos: 30,
        })
      ).toBe(false);
    });
  });

  describe('cruce de medianoche', () => {
    const sabadoDeNoche = franja(6, '19:00:00', '02:00:00');

    test('a la 01:00 del domingo sigue abierta por la franja del sábado', () => {
      const resultado = franjaVigente(sabadoDeNoche, {
        ahora: enArgentina('2026-11-01T01:00:00'),
        margenMinutos: 30,
      });
      expect(resultado).not.toBeNull();
      expect(resultado.cierrePedidos).toBe('01:30');
    });

    test('a la 01:30 del domingo ya cerró', () => {
      expect(
        estaAbierta(sabadoDeNoche, {
          ahora: enArgentina('2026-11-01T01:30:00'),
          margenMinutos: 30,
        })
      ).toBe(false);
    });

    test('cierre 00:00 (11:00–00:00) toma pedidos hasta las 23:59', () => {
      const horarios = franja(6, '11:00:00', '00:00:00');
      expect(
        estaAbierta(horarios, {
          ahora: enArgentina('2026-10-31T23:59:00'),
          margenMinutos: 0,
        })
      ).toBe(true);
      expect(
        estaAbierta(horarios, {
          ahora: enArgentina('2026-11-01T00:01:00'),
          margenMinutos: 0,
        })
      ).toBe(false);
    });

    test('dos franjas el mismo día: vale la que cierra más tarde', () => {
      const horarios = [
        { diaSemana: 6, apertura: '11:00:00', cierre: '15:00:00' },
        { diaSemana: 6, apertura: '19:00:00', cierre: '02:00:00' },
      ];
      const resultado = franjaVigente(horarios, {
        ahora: enArgentina('2026-11-01T01:00:00'),
        margenMinutos: 30,
      });
      expect(resultado.cierrePedidos).toBe('01:30');
    });
  });

  describe('proximaApertura', () => {
    test('más tarde el mismo día', () => {
      const proxima = proximaApertura(franja(6, '19:00:00', '23:00:00'), {
        ahora: enArgentina('2026-10-31T12:00:00'),
      });
      expect(proxima).toMatchObject({
        diaSemana: 6,
        diaOffset: 0,
        apertura: '19:00',
      });
    });

    test('el próximo día con horario (sábado → lunes)', () => {
      const proxima = proximaApertura(franja(1, '11:00:00', '23:00:00'), {
        ahora: enArgentina('2026-10-31T12:00:00'),
      });
      expect(proxima).toMatchObject({
        diaSemana: 1,
        diaOffset: 2,
        apertura: '11:00',
      });
      expect(formatearProximaApertura(proxima)).toBe('el lunes a las 11:00');
    });

    test('una sucursal sin franjas no tiene próxima apertura', () => {
      expect(
        proximaApertura([], { ahora: enArgentina('2026-10-31T12:00:00') })
      ).toBeNull();
    });
  });

  describe('proximaLimite', () => {
    test('con la sucursal abierta devuelve el corte de pedidos', () => {
      const limite = proximaLimite(franja(6, '10:00:00', '23:00:00'), {
        ahora: enArgentina('2026-10-31T22:00:00'),
        margenMinutos: 30,
      });
      expect(limite).toEqual({ segundos: 1800, tipo: 'corte', diaSemana: 6 });
    });

    test('con la sucursal cerrada devuelve la próxima apertura', () => {
      const limite = proximaLimite(franja(6, '10:00:00', '23:00:00'), {
        ahora: enArgentina('2026-10-31T08:00:00'),
      });
      expect(limite).toMatchObject({ tipo: 'apertura', diaSemana: 6 });
      expect(limite.segundos).toBe(2 * 60 * 60);
    });

    test('considera la franja de ayer que cruza medianoche y sigue vigente', () => {
      const limite = proximaLimite(franja(6, '19:00:00', '02:00:00'), {
        ahora: enArgentina('2026-11-01T01:00:00'),
        margenMinutos: 0,
      });
      expect(limite).toEqual({
        segundos: 60 * 60,
        tipo: 'corte',
        diaSemana: 6,
      });
    });

    test('sin franjas no hay límite', () => {
      expect(proximaLimite([], { ahora: new Date() })).toBeNull();
    });
  });

  describe('mensajes', () => {
    test('mensaje de cerradas con la próxima apertura', () => {
      const proxima = {
        diaSemana: 1,
        diaOffset: 2,
        apertura: '11:00',
      };
      expect(mensajeCerrado(proxima)).toBe(
        'Lo sentimos, las sucursales cercanas ya están cerradas. Volvemos a abrir el lunes a las 11:00.'
      );
    });

    test('sin próxima apertura el mensaje no promete una hora', () => {
      expect(mensajeCerrado(null)).toBe(
        'Lo sentimos, las sucursales cercanas ya están cerradas.'
      );
    });
  });

  describe('normalizarHorarios', () => {
    test('acepta la forma plana y normaliza a HH:MM:SS', () => {
      const normalizado = normalizarHorarios([
        { diaSemana: 1, apertura: '10:00', cierre: '23:00' },
        { diaSemana: 2, apertura: '09:30', cierre: '13:00' },
      ]);
      expect(normalizado).toEqual([
        { diaSemana: 1, apertura: '10:00:00', cierre: '23:00:00' },
        { diaSemana: 2, apertura: '09:30:00', cierre: '13:00:00' },
      ]);
    });

    test('acepta la forma agrupada por día', () => {
      const normalizado = normalizarHorarios([
        {
          diaSemana: 1,
          franjas: [
            { apertura: '11:00', cierre: '15:00' },
            { apertura: '19:00', cierre: '02:00' },
          ],
        },
      ]);
      expect(normalizado).toHaveLength(2);
      expect(normalizado[1]).toEqual({
        diaSemana: 1,
        apertura: '19:00:00',
        cierre: '02:00:00',
      });
    });

    test('rechaza un día fuera de 1..7', () => {
      expect(() =>
        normalizarHorarios([
          { diaSemana: 8, apertura: '10:00', cierre: '23:00' },
        ])
      ).toThrow(HorarioInvalidoError);
    });

    test('rechaza apertura igual al cierre', () => {
      expect(() =>
        normalizarHorarios([
          { diaSemana: 1, apertura: '10:00', cierre: '10:00' },
        ])
      ).toThrow(/misma hora/i);
    });

    test('rechaza duplicados exactos', () => {
      expect(() =>
        normalizarHorarios([
          { diaSemana: 1, apertura: '10:00', cierre: '23:00' },
          { diaSemana: 1, apertura: '10:00', cierre: '23:00' },
        ])
      ).toThrow(/repetido/i);
    });

    test('rechaza una hora inválida', () => {
      expect(() =>
        normalizarHorarios([
          { diaSemana: 1, apertura: '25:00', cierre: '23:00' },
        ])
      ).toThrow(HorarioInvalidoError);
    });

    test('rechaza un payload que no es lista', () => {
      expect(() => normalizarHorarios('10:00-23:00')).toThrow(
        HorarioInvalidoError
      );
    });
  });

  describe('agruparHorarios y formatearHorarios', () => {
    test('siempre devuelve los siete días', () => {
      const agrupado = agruparHorarios(franja(1, '10:00:00', '23:00:00'));
      expect(agrupado).toHaveLength(7);
      expect(agrupado[0]).toMatchObject({
        diaSemana: 1,
        dia: 'Lunes',
        franjas: [{ apertura: '10:00', cierre: '23:00' }],
      });
      expect(agrupado[1].franjas).toEqual([]);
    });

    test('agrupa días consecutivos con el mismo horario', () => {
      const horarios = Array.from({ length: 7 }, (_, indice) => ({
        diaSemana: indice + 1,
        apertura: '10:00:00',
        cierre: '23:00:00',
      }));
      expect(formatearHorarios(horarios)).toBe('Lun a Dom 10:00 a 23:00');
    });

    test('describe dos franjas y los días cerrados', () => {
      const horarios = [
        { diaSemana: 1, apertura: '11:00:00', cierre: '15:00:00' },
        { diaSemana: 1, apertura: '19:00:00', cierre: '02:00:00' },
        { diaSemana: 2, apertura: '11:00:00', cierre: '15:00:00' },
        { diaSemana: 2, apertura: '19:00:00', cierre: '02:00:00' },
      ];
      expect(formatearHorarios(horarios)).toBe(
        'Lun y Mar 11:00 a 15:00 y 19:00 a 02:00 · Mié a Dom cerrado'
      );
    });

    test('una sucursal sin franjas se describe como cerrada', () => {
      expect(formatearHorarios([])).toBe('Lun a Dom cerrado');
    });
  });
});
