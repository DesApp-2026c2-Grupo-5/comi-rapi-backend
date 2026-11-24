import db from '../models';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import {
  ALFABETO_CODIGO,
  calcularDescuentoCupon,
  confirmarReservaCupon,
  contarUsosCupon,
  CuponError,
  derivarEstadoCupon,
  esReservaVigente,
  ESTADOS_CUPON,
  ESTADOS_PEDIDO_CUPON,
  generarCodigoCupon,
  generarCodigosDisponibles,
  generarCodigosUnicos,
  liberarCuponDePedido,
  MOTIVOS_CUPON,
  obtenerEstadoCupon,
  reservarCuponParaPedido,
  RESULTADOS_LIBERACION,
  revalidarReservaCupon,
  validarCuponDisponible,
  validarCuponUnico,
} from './cupones';

const { Cupon, CuponEmision, EstadoPedido, Pedido, PedidoCupon, Sucursal } = db;

const AHORA = new Date('2026-11-12T12:00:00.000Z');
const MINUTO_MS = 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

const minutosAtras = (minutos) =>
  new Date(AHORA.getTime() - minutos * MINUTO_MS);
const diasAtras = (dias) => new Date(AHORA.getTime() - dias * DIA_MS);
const diasAdelante = (dias) => new Date(AHORA.getTime() + dias * DIA_MS);

const cuponBase = (extra = {}) => ({
  tipoDescuento: 'PORCENTAJE',
  valorDescuento: 10,
  compraMinima: 0,
  descuentoMaximo: null,
  fechaInicio: diasAtras(1),
  fechaFin: diasAdelante(1),
  usosPermitidos: 1,
  activo: true,
  ...extra,
});

const errorDe = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
};

describe('derivarEstadoCupon', () => {
  test('sin cupón o inactivo gana ANULADO sobre cualquier otro estado', () => {
    expect(derivarEstadoCupon(null, { ahora: AHORA })).toBe(
      ESTADOS_CUPON.ANULADO
    );
    expect(
      derivarEstadoCupon(
        cuponBase({
          activo: false,
          fechaFin: diasAtras(5),
          usosPermitidos: 1,
        }),
        { ahora: AHORA, usosConfirmados: 1 }
      )
    ).toBe(ESTADOS_CUPON.ANULADO);
  });

  test('antes de fechaInicio es PROGRAMADO, no VENCIDO', () => {
    expect(
      derivarEstadoCupon(cuponBase({ fechaInicio: diasAdelante(1) }), {
        ahora: AHORA,
      })
    ).toBe(ESTADOS_CUPON.PROGRAMADO);
    expect(
      derivarEstadoCupon(cuponBase({ fechaFin: diasAtras(1) }), {
        ahora: AHORA,
      })
    ).toBe(ESTADOS_CUPON.VENCIDO);
  });

  test('VENCIDO gana sobre USADO y EN_USO', () => {
    expect(
      derivarEstadoCupon(
        cuponBase({ fechaFin: diasAtras(1), usosPermitidos: 1 }),
        { ahora: AHORA, usosConfirmados: 1, reservasVigentes: 1 }
      )
    ).toBe(ESTADOS_CUPON.VENCIDO);
  });

  test('los bordes de vigencia son inclusivos', () => {
    const inicio = cuponBase({ fechaInicio: AHORA, fechaFin: diasAdelante(1) });
    const fin = cuponBase({ fechaInicio: diasAtras(1), fechaFin: AHORA });
    expect(derivarEstadoCupon(inicio, { ahora: AHORA })).toBe(
      ESTADOS_CUPON.DISPONIBLE
    );
    expect(derivarEstadoCupon(fin, { ahora: AHORA })).toBe(
      ESTADOS_CUPON.DISPONIBLE
    );
  });

  test('fechas inválidas se tratan como vencidas', () => {
    expect(
      derivarEstadoCupon(cuponBase({ fechaInicio: 'no-es-fecha' }), {
        ahora: AHORA,
      })
    ).toBe(ESTADOS_CUPON.VENCIDO);
    expect(
      derivarEstadoCupon(cuponBase({ fechaFin: null }), { ahora: AHORA })
    ).toBe(ESTADOS_CUPON.VENCIDO);
  });

  test('USADO gana sobre EN_USO cuando se alcanzó el límite confirmado', () => {
    expect(
      derivarEstadoCupon(cuponBase({ usosPermitidos: 1 }), {
        ahora: AHORA,
        usosConfirmados: 1,
        reservasVigentes: 1,
      })
    ).toBe(ESTADOS_CUPON.USADO);
  });

  test('EN_USO cuando las reservas vigentes completan el límite', () => {
    expect(
      derivarEstadoCupon(cuponBase({ usosPermitidos: 2 }), {
        ahora: AHORA,
        usosConfirmados: 1,
        reservasVigentes: 1,
      })
    ).toBe(ESTADOS_CUPON.EN_USO);
  });

  test('multi-uso sigue DISPONIBLE si quedan usos libres', () => {
    expect(
      derivarEstadoCupon(cuponBase({ usosPermitidos: 2 }), {
        ahora: AHORA,
        usosConfirmados: 1,
        reservasVigentes: 0,
      })
    ).toBe(ESTADOS_CUPON.DISPONIBLE);
  });

  test('usosPermitidos ausente o inválido se interpreta como 1', () => {
    expect(
      derivarEstadoCupon(cuponBase({ usosPermitidos: 0 }), { ahora: AHORA })
    ).toBe(ESTADOS_CUPON.DISPONIBLE);
    expect(
      derivarEstadoCupon(cuponBase({ usosPermitidos: 0 }), {
        ahora: AHORA,
        usosConfirmados: 1,
      })
    ).toBe(ESTADOS_CUPON.USADO);
  });
});

describe('esReservaVigente', () => {
  const pedidoPendiente = (fechaHora) => ({
    fechaHora,
    estadoActual: { nombre: 'pendiente' },
  });

  test('cuenta solo RESERVADO sobre un pedido pendiente y no vencido', () => {
    expect(
      esReservaVigente(
        {
          estado: ESTADOS_PEDIDO_CUPON.RESERVADO,
          pedido: pedidoPendiente(minutosAtras(5)),
        },
        { ahora: AHORA, minutosReserva: 15 }
      )
    ).toBe(true);
  });

  test('una reserva vencida no cuenta', () => {
    expect(
      esReservaVigente(
        {
          estado: ESTADOS_PEDIDO_CUPON.RESERVADO,
          pedido: pedidoPendiente(minutosAtras(16)),
        },
        { ahora: AHORA, minutosReserva: 15 }
      )
    ).toBe(false);
  });

  test('un pedido que ya no está pendiente no cuenta', () => {
    expect(
      esReservaVigente(
        {
          estado: ESTADOS_PEDIDO_CUPON.RESERVADO,
          pedido: {
            fechaHora: minutosAtras(5),
            estadoActual: { nombre: 'confirmado' },
          },
        },
        { ahora: AHORA, minutosReserva: 15 }
      )
    ).toBe(false);
  });

  test('LIBERADO y CONFIRMADO nunca son reservas vigentes', () => {
    const pedido = pedidoPendiente(minutosAtras(1));
    expect(
      esReservaVigente(
        { estado: ESTADOS_PEDIDO_CUPON.LIBERADO, pedido },
        { ahora: AHORA, minutosReserva: 15 }
      )
    ).toBe(false);
    expect(
      esReservaVigente(
        { estado: ESTADOS_PEDIDO_CUPON.CONFIRMADO, pedido },
        { ahora: AHORA, minutosReserva: 15 }
      )
    ).toBe(false);
  });

  test('sin pedido o sin plazo configurado no es vigente', () => {
    expect(
      esReservaVigente(
        { estado: ESTADOS_PEDIDO_CUPON.RESERVADO },
        { ahora: AHORA, minutosReserva: 15 }
      )
    ).toBe(false);
    expect(
      esReservaVigente(
        {
          estado: ESTADOS_PEDIDO_CUPON.RESERVADO,
          pedido: pedidoPendiente(minutosAtras(1)),
        },
        { ahora: AHORA }
      )
    ).toBe(false);
  });

  test('acepta el pedido por parámetro y el nombre de estado plano', () => {
    expect(
      esReservaVigente(
        { estado: ESTADOS_PEDIDO_CUPON.RESERVADO },
        {
          ahora: AHORA,
          minutosReserva: 15,
          pedido: { fechaHora: minutosAtras(1), estado: 'pendiente' },
        }
      )
    ).toBe(true);
  });
});

describe('validarCuponDisponible', () => {
  test('devuelve DISPONIBLE cuando el cupón puede usarse', () => {
    expect(validarCuponDisponible(cuponBase(), { ahora: AHORA })).toBe(
      ESTADOS_CUPON.DISPONIBLE
    );
  });

  test('null es un cupón inválido (400)', () => {
    const error = errorDe(() => validarCuponDisponible(null, { ahora: AHORA }));
    expect(error).toBeInstanceOf(CuponError);
    expect(error.codigo).toBe(400);
    expect(error.motivo).toBe(MOTIVOS_CUPON.INVALIDO);
  });

  test('un cupón no disponible responde 409 con el motivo del estado', () => {
    const vencido = errorDe(() =>
      validarCuponDisponible(cuponBase({ fechaFin: diasAtras(1) }), {
        ahora: AHORA,
      })
    );
    expect(vencido.codigo).toBe(409);
    expect(vencido.motivo).toBe(MOTIVOS_CUPON.VENCIDO);

    const anulado = errorDe(() =>
      validarCuponDisponible(cuponBase({ activo: false }), { ahora: AHORA })
    );
    expect(anulado.motivo).toBe(MOTIVOS_CUPON.ANULADO);
  });
});

describe('validarCuponUnico', () => {
  test('sin uso previo no hace nada', () => {
    expect(() => validarCuponUnico(null)).not.toThrow();
  });

  test('un segundo cupón sobre el mismo pedido se rechaza', () => {
    const error = errorDe(() => validarCuponUnico({ id: 1 }));
    expect(error).toBeInstanceOf(CuponError);
    expect(error.codigo).toBe(409);
    expect(error.motivo).toBe(MOTIVOS_CUPON.YA_APLICADO);
  });
});

describe('calcularDescuentoCupon', () => {
  test('porcentual se aplica sobre los ítems menos las promociones', () => {
    expect(
      calcularDescuentoCupon({
        subtotalItems: 1000,
        descuentoPromociones: 200,
        cupon: cuponBase({ valorDescuento: 10 }),
        ahora: AHORA,
      })
    ).toEqual({
      estado: ESTADOS_CUPON.DISPONIBLE,
      subtotalItems: 1000,
      descuentoPromociones: 200,
      subtotalAlcanzado: 1000,
      descuentoPromocionAlcanzado: 200,
      baseCalculo: 800,
      descuentoAplicado: 80,
      subtotalNeto: 720,
    });
  });

  test('monto fijo respeta el tope', () => {
    const resultado = calcularDescuentoCupon({
      subtotalItems: 1000,
      cupon: cuponBase({
        tipoDescuento: 'MONTO_FIJO',
        valorDescuento: 500,
        descuentoMaximo: 300,
      }),
      ahora: AHORA,
    });
    expect(resultado.descuentoAplicado).toBe(300);
    expect(resultado.subtotalNeto).toBe(700);
  });

  test('el descuento nunca supera la base de cálculo', () => {
    const resultado = calcularDescuentoCupon({
      subtotalItems: 1000,
      cupon: cuponBase({ tipoDescuento: 'MONTO_FIJO', valorDescuento: 5000 }),
      ahora: AHORA,
    });
    expect(resultado.descuentoAplicado).toBe(1000);
    expect(resultado.subtotalNeto).toBe(0);
  });

  test('promociones mayores al subtotal dejan la base en cero', () => {
    const resultado = calcularDescuentoCupon({
      subtotalItems: 500,
      descuentoPromociones: 700,
      cupon: cuponBase({ valorDescuento: 50 }),
      ahora: AHORA,
    });
    expect(resultado.baseCalculo).toBe(0);
    expect(resultado.descuentoAplicado).toBe(0);
  });

  test('la compra mínima se mide antes de promociones y cupón', () => {
    const resultado = calcularDescuentoCupon({
      subtotalItems: 1000,
      descuentoPromociones: 600,
      cupon: cuponBase({ valorDescuento: 50, compraMinima: 800 }),
      ahora: AHORA,
    });
    expect(resultado.baseCalculo).toBe(400);
    expect(resultado.descuentoAplicado).toBe(200);
  });

  test('rechaza la compra mínima no alcanzada sin importar el tipo', () => {
    const error = errorDe(() =>
      calcularDescuentoCupon({
        subtotalItems: 999,
        cupon: cuponBase({ compraMinima: 1000 }),
        ahora: AHORA,
      })
    );
    expect(error).toBeInstanceOf(CuponError);
    expect(error.codigo).toBe(409);
    expect(error.motivo).toBe(MOTIVOS_CUPON.COMPRA_MINIMA);
  });

  test('un cupón vencido no se aplica', () => {
    const error = errorDe(() =>
      calcularDescuentoCupon({
        subtotalItems: 1000,
        cupon: cuponBase({ fechaFin: diasAtras(1) }),
        ahora: AHORA,
      })
    );
    expect(error.codigo).toBe(409);
    expect(error.motivo).toBe(MOTIVOS_CUPON.VENCIDO);
  });

  test('un tipo de descuento desconocido es un error de validación', () => {
    const error = errorDe(() =>
      calcularDescuentoCupon({
        subtotalItems: 1000,
        cupon: cuponBase({ tipoDescuento: 'OTRO' }),
        ahora: AHORA,
      })
    );
    expect(error.codigo).toBe(400);
    expect(error.motivo).toBe(MOTIVOS_CUPON.INVALIDO);
  });
});

describe('generarCodigoCupon', () => {
  test('usa el prefijo y solo el alfabeto sin caracteres ambiguos', () => {
    const codigo = generarCodigoCupon({
      randomBytes: () => Buffer.alloc(10, 0),
    });
    expect(codigo).toBe('CR-AAAAAAAAAA');
    expect(codigo.slice(3)).toHaveLength(10);
    for (const caracter of codigo.slice(3)) {
      expect(ALFABETO_CODIGO).toContain(caracter);
    }
  });

  test('es determinístico para los mismos bytes', () => {
    const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(generarCodigoCupon({ randomBytes: () => bytes })).toBe(
      generarCodigoCupon({ randomBytes: () => bytes })
    );
  });

  test('sin prefijo devuelve solo el cuerpo', () => {
    expect(
      generarCodigoCupon({
        longitud: 6,
        prefijo: '',
        randomBytes: () => Buffer.alloc(6, 0),
      })
    ).toBe('AAAAAA');
  });

  test('rechaza longitudes fuera de rango y bytes insuficientes', () => {
    expect(() =>
      generarCodigoCupon({ longitud: 5, randomBytes: () => Buffer.alloc(5) })
    ).toThrow(CuponError);
    expect(() =>
      generarCodigoCupon({
        longitud: 10,
        randomBytes: () => Buffer.alloc(3),
      })
    ).toThrow(CuponError);
  });

  test('genera códigos únicos en un lote normal', () => {
    const codigos = new Set(
      Array.from({ length: 25 }, () => generarCodigoCupon())
    );
    expect(codigos.size).toBe(25);
    codigos.forEach((codigo) => {
      expect(codigo).toMatch(/^CR-[A-HJ-NP-Z2-9]{10}$/);
    });
  });
});

describe('generarCodigosUnicos', () => {
  test('deduplica contra el lote y contra los existentes', () => {
    const secuencia = ['CR-AAA111', 'CR-AAA111', 'CR-BBB222', 'CR-CCC333'];
    let indice = 0;
    const codigos = generarCodigosUnicos(2, {
      existentes: ['CR-BBB222'],
      generar: () => secuencia[indice++],
    });
    expect(codigos).toEqual(['CR-AAA111', 'CR-CCC333']);
  });

  test('normaliza mayúsculas antes de comparar', () => {
    const secuencia = ['cr-aaa111', 'CR-AAA111', 'CR-BBB222'];
    let indice = 0;
    expect(
      generarCodigosUnicos(1, {
        existentes: ['CR-AAA111'],
        generar: () => secuencia[indice++],
      })
    ).toEqual(['CR-BBB222']);
  });

  test('se rinde si no logra suficientes códigos únicos', () => {
    expect(() =>
      generarCodigosUnicos(2, {
        generar: () => 'CR-MISMO',
        maxIntentos: 10,
      })
    ).toThrow(CuponError);
  });

  test('rechaza cantidades no positivas', () => {
    expect(() => generarCodigosUnicos(0)).toThrow(CuponError);
    expect(() => generarCodigosUnicos(-1)).toThrow(CuponError);
  });
});

describe('cupones (contra la base)', () => {
  let sucursal;
  let estados;
  let superadmin;
  let cliente;
  let contadorEmisiones = 0;

  const crearEmision = async () => {
    contadorEmisiones += 1;
    const nombre = `Emisión cupones ${contadorEmisiones}`;
    return CuponEmision.create({
      creadaPorUsuarioId: superadmin.id,
      nombre,
      tipoDescuento: 'PORCENTAJE',
      valorDescuento: 10,
      compraMinima: 0,
      fechaInicio: diasAtras(1),
      fechaFin: diasAdelante(5),
      configuracionSnapshot: { nombre },
    });
  };

  const crearCupon = async (extra = {}) => {
    const emisionDelCupon = await crearEmision();
    return Cupon.create({
      emisionId: emisionDelCupon.id,
      usuarioId: cliente.id,
      codigo: generarCodigoCupon(),
      tipoDescuento: 'PORCENTAJE',
      valorDescuento: 10,
      compraMinima: 0,
      descuentoMaximo: null,
      fechaInicio: diasAtras(1),
      fechaFin: diasAdelante(5),
      usosPermitidos: 1,
      activo: true,
      estadoEnvio: 'ENVIADO',
      alcanceSnapshot: { global: true },
      ...extra,
    });
  };

  const crearPedido = ({
    estado = estados.pendiente,
    fechaHora = minutosAtras(5),
    total = 1000,
  } = {}) =>
    Pedido.create({
      usuarioId: cliente.id,
      sucursalId: sucursal.id,
      estadoId: estado.id,
      fechaHora,
      total,
      costoEnvio: 0,
    });

  const crearUso = (pedido, cupon, estado = 'RESERVADO', extra = {}) =>
    PedidoCupon.create({
      pedidoId: pedido.id,
      cuponId: cupon.id,
      usuarioId: cliente.id,
      codigo: cupon.codigo,
      tipoDescuento: cupon.tipoDescuento,
      valorDescuento: cupon.valorDescuento,
      compraMinima: cupon.compraMinima,
      baseCalculo: 1000,
      descuentoAplicado: 100,
      estado,
      ...extra,
    });

  beforeAll(async () => {
    await cleanDb();

    sucursal = await Sucursal.create({ nombre: 'Sucursal Cupones' });
    const filas = await EstadoPedido.bulkCreate([
      { nombre: 'pendiente', orden: 1, esInicial: true },
      { nombre: 'confirmado', orden: 2 },
      { nombre: 'cancelado', orden: 7, esFinal: true },
      { nombre: 'entregado', orden: 6, esFinal: true },
    ]);
    estados = Object.fromEntries(
      filas.map((estado) => [estado.nombre, estado])
    );

    superadmin = await crearUsuario({
      nombre: 'Super',
      apellido: 'Admin',
      email: 'super-cupones@test.com',
      rol: 'SUPERADMINISTRADOR',
    });
    cliente = await crearUsuario({
      nombre: 'Cliente',
      apellido: 'Cupones',
      email: 'cliente-cupones@test.com',
    });
  });

  describe('contarUsosCupon', () => {
    test('cuenta confirmados y solo reservas vigentes', async () => {
      const cupon = await crearCupon({ usosPermitidos: 3 });

      const vigente = await crearPedido();
      const vencido = await crearPedido({ fechaHora: minutosAtras(30) });
      const cancelado = await crearPedido({ estado: estados.cancelado });
      const confirmado = await crearPedido({ estado: estados.confirmado });
      const liberado = await crearPedido();

      await crearUso(vigente, cupon);
      await crearUso(vencido, cupon);
      await crearUso(cancelado, cupon);
      await crearUso(confirmado, cupon, 'CONFIRMADO', {
        confirmadoEn: minutosAtras(1),
      });
      await crearUso(liberado, cupon, 'LIBERADO', {
        liberadoEn: minutosAtras(1),
      });

      await expect(
        contarUsosCupon(cupon.id, { ahora: AHORA, minutosReserva: 15 })
      ).resolves.toEqual({
        usosConfirmados: 1,
        reservasVigentes: 1,
        usosActivos: 2,
      });
    });

    test('sin cupón devuelve todos los contadores en cero', async () => {
      await expect(contarUsosCupon(null)).resolves.toEqual({
        usosConfirmados: 0,
        reservasVigentes: 0,
        usosActivos: 0,
      });
    });
  });

  describe('obtenerEstadoCupon', () => {
    test('cupón multi-uso: DISPONIBLE, EN_USO y luego USADO', async () => {
      const cupon = await crearCupon({ usosPermitidos: 2 });

      const primero = await crearPedido({ estado: estados.confirmado });
      await crearUso(primero, cupon, 'CONFIRMADO', {
        confirmadoEn: minutosAtras(1),
      });

      await expect(
        obtenerEstadoCupon(cupon, { ahora: AHORA, minutosReserva: 15 })
      ).resolves.toBe(ESTADOS_CUPON.DISPONIBLE);

      const segundo = await crearPedido();
      const reserva = await crearUso(segundo, cupon);

      await expect(
        obtenerEstadoCupon(cupon, { ahora: AHORA, minutosReserva: 15 })
      ).resolves.toBe(ESTADOS_CUPON.EN_USO);

      await reserva.update({ estado: 'CONFIRMADO', confirmadoEn: AHORA });
      await segundo.update({ estadoId: estados.confirmado.id });

      await expect(
        obtenerEstadoCupon(cupon, { ahora: AHORA, minutosReserva: 15 })
      ).resolves.toBe(ESTADOS_CUPON.USADO);
    });

    test('una reserva vencida no bloquea el cupón', async () => {
      const cupon = await crearCupon({ usosPermitidos: 1 });
      const viejo = await crearPedido({ fechaHora: minutosAtras(30) });
      await crearUso(viejo, cupon);

      await expect(
        obtenerEstadoCupon(cupon, { ahora: AHORA, minutosReserva: 15 })
      ).resolves.toBe(ESTADOS_CUPON.DISPONIBLE);
    });

    test('un cupón inactivo se informa ANULADO sin importar los usos', async () => {
      const cupon = await crearCupon({ usosPermitidos: 1, activo: false });
      await expect(
        obtenerEstadoCupon(cupon, { ahora: AHORA, minutosReserva: 15 })
      ).resolves.toBe(ESTADOS_CUPON.ANULADO);
    });
  });

  describe('contarUsosCupon con exclusión', () => {
    test('omite la propia reserva del pedido al revalidar', async () => {
      const cupon = await crearCupon({ usosPermitidos: 1 });
      const pedido = await crearPedido();
      await crearUso(pedido, cupon);

      await expect(
        contarUsosCupon(cupon.id, {
          ahora: AHORA,
          minutosReserva: 15,
          excluirPedidoId: pedido.id,
        })
      ).resolves.toEqual({
        usosConfirmados: 0,
        reservasVigentes: 0,
        usosActivos: 0,
      });
    });
  });

  describe('reservarCuponParaPedido', () => {
    test('calcula sobre el subtotal menos promociones y respeta tope', async () => {
      const cupon = await crearCupon({
        tipoDescuento: 'PORCENTAJE',
        valorDescuento: 20,
        descuentoMaximo: 150,
        usosPermitidos: 2,
      });

      const resultado = await reservarCuponParaPedido({
        codigo: cupon.codigo.toLowerCase(),
        usuarioId: cliente.id,
        subtotalItems: 1000,
        descuentoPromociones: 100,
        ahora: AHORA,
      });

      expect(resultado.cupon.id).toBe(cupon.id);
      const emision = await CuponEmision.findByPk(cupon.emisionId);
      expect(resultado.cupon.emision?.nombre).toBe(emision.nombre);
      expect(resultado.calculo).toMatchObject({
        subtotalItems: 1000,
        descuentoPromociones: 100,
        baseCalculo: 900,
        descuentoAplicado: 150,
        subtotalNeto: 750,
      });
    });

    test('rechaza código inexistente o de otro cliente', async () => {
      const cupon = await crearCupon();
      const otroCliente = await crearUsuario({
        email: 'otro-cupon@test.com',
        rol: 'CLIENTE',
      });

      await expect(
        reservarCuponParaPedido({
          codigo: 'CR-NOEXISTE',
          usuarioId: cliente.id,
          subtotalItems: 1000,
          ahora: AHORA,
        })
      ).rejects.toMatchObject({
        motivo: MOTIVOS_CUPON.INVALIDO,
        codigo: 404,
      });

      await expect(
        reservarCuponParaPedido({
          codigo: cupon.codigo,
          usuarioId: otroCliente.id,
          subtotalItems: 1000,
          ahora: AHORA,
        })
      ).rejects.toMatchObject({
        motivo: MOTIVOS_CUPON.INVALIDO,
        codigo: 404,
      });
    });

    test('rechaza cupón vencido, anulado, agotado o sin compra mínima', async () => {
      const vencido = await crearCupon({ fechaFin: diasAtras(1) });
      const anulado = await crearCupon({ activo: false });
      const minimo = await crearCupon({ compraMinima: 2000 });
      const agotado = await crearCupon({ usosPermitidos: 1 });
      const pedido = await crearPedido();
      await crearUso(pedido, agotado);

      await expect(
        reservarCuponParaPedido({
          codigo: vencido.codigo,
          usuarioId: cliente.id,
          subtotalItems: 1000,
          ahora: AHORA,
        })
      ).rejects.toMatchObject({ motivo: MOTIVOS_CUPON.VENCIDO });

      await expect(
        reservarCuponParaPedido({
          codigo: anulado.codigo,
          usuarioId: cliente.id,
          subtotalItems: 1000,
          ahora: AHORA,
        })
      ).rejects.toMatchObject({ motivo: MOTIVOS_CUPON.ANULADO });

      await expect(
        reservarCuponParaPedido({
          codigo: minimo.codigo,
          usuarioId: cliente.id,
          subtotalItems: 1000,
          ahora: AHORA,
        })
      ).rejects.toMatchObject({ motivo: MOTIVOS_CUPON.COMPRA_MINIMA });

      await expect(
        reservarCuponParaPedido({
          codigo: agotado.codigo,
          usuarioId: cliente.id,
          subtotalItems: 1000,
          ahora: AHORA,
        })
      ).rejects.toMatchObject({ motivo: MOTIVOS_CUPON.EN_USO });
    });

    test('un cupón multiuso permite reservar mientras queden usos', async () => {
      const cupon = await crearCupon({ usosPermitidos: 2 });
      const primero = await crearPedido();
      await crearUso(primero, cupon);

      const resultado = await reservarCuponParaPedido({
        codigo: cupon.codigo,
        usuarioId: cliente.id,
        subtotalItems: 1000,
        ahora: AHORA,
      });
      expect(resultado.usos).toMatchObject({
        usosConfirmados: 0,
        reservasVigentes: 1,
        usosActivos: 1,
      });
    });
  });

  describe('revalidarReservaCupon', () => {
    test('la propia reserva no bloquea un cupón de un solo uso', async () => {
      const cupon = await crearCupon({ usosPermitidos: 1 });
      const pedido = await crearPedido();
      const uso = await crearUso(pedido, cupon);

      await expect(
        revalidarReservaCupon({ pedidoCupon: uso, ahora: AHORA })
      ).resolves.toMatchObject({
        valido: true,
        estado: ESTADOS_CUPON.DISPONIBLE,
        motivo: null,
      });
    });

    test('invalida si otro pedido agotó el cupón entre la reserva y el pago', async () => {
      const cupon = await crearCupon({ usosPermitidos: 1 });
      const pedido = await crearPedido();
      const uso = await crearUso(pedido, cupon);
      const otro = await crearPedido();
      await crearUso(otro, cupon);

      await expect(
        revalidarReservaCupon({ pedidoCupon: uso, ahora: AHORA })
      ).resolves.toMatchObject({
        valido: false,
        estado: ESTADOS_CUPON.EN_USO,
        motivo: MOTIVOS_CUPON.EN_USO,
      });
    });

    test('invalida si el cupón fue anulado o venció', async () => {
      const anulado = await crearCupon({ activo: false });
      const usoAnulado = await crearUso(await crearPedido(), anulado);

      await expect(
        revalidarReservaCupon({ pedidoCupon: usoAnulado, ahora: AHORA })
      ).resolves.toMatchObject({
        valido: false,
        estado: ESTADOS_CUPON.ANULADO,
        motivo: MOTIVOS_CUPON.ANULADO,
      });

      const vencido = await crearCupon({ fechaFin: diasAtras(1) });
      const usoVencido = await crearUso(await crearPedido(), vencido);

      await expect(
        revalidarReservaCupon({ pedidoCupon: usoVencido, ahora: AHORA })
      ).resolves.toMatchObject({
        valido: false,
        estado: ESTADOS_CUPON.VENCIDO,
        motivo: MOTIVOS_CUPON.VENCIDO,
      });
    });
  });

  describe('confirmarReservaCupon', () => {
    test('marca CONFIRMADO y repetir no cambia la fecha', async () => {
      const cupon = await crearCupon();
      const pedido = await crearPedido();
      const uso = await crearUso(pedido, cupon);

      await confirmarReservaCupon(uso, { ahora: AHORA });
      expect(uso.estado).toBe(ESTADOS_PEDIDO_CUPON.CONFIRMADO);
      const confirmadoEn = uso.confirmadoEn;

      await confirmarReservaCupon(uso, { ahora: diasAdelante(1) });
      expect(uso.confirmadoEn).toEqual(confirmadoEn);
    });
  });

  describe('liberarCuponDePedido', () => {
    test('RESERVADO pasa a LIBERADO y repetir es idempotente', async () => {
      const cupon = await crearCupon({ usosPermitidos: 1 });
      const pedido = await crearPedido();
      await crearUso(pedido, cupon);

      const primera = await liberarCuponDePedido(pedido.id, { ahora: AHORA });
      expect(primera).toEqual({
        liberado: true,
        motivo: RESULTADOS_LIBERACION.LIBERADO,
        pedidoId: Number(pedido.id),
        cuponId: Number(cupon.id),
      });

      const fila = await PedidoCupon.findOne({
        where: { pedidoId: pedido.id },
      });
      expect(fila.estado).toBe('LIBERADO');
      const liberadoEn = fila.liberadoEn;

      const segunda = await liberarCuponDePedido(pedido.id, {
        ahora: diasAdelante(1),
      });
      expect(segunda).toMatchObject({
        liberado: false,
        motivo: RESULTADOS_LIBERACION.YA_LIBERADO,
      });

      await fila.reload();
      expect(fila.liberadoEn).toEqual(liberadoEn);

      await expect(
        obtenerEstadoCupon(cupon, { ahora: AHORA, minutosReserva: 15 })
      ).resolves.toBe(ESTADOS_CUPON.DISPONIBLE);
    });

    test('un uso CONFIRMADO no se libera al cancelar el pedido', async () => {
      const cupon = await crearCupon({ usosPermitidos: 1 });
      const pedido = await crearPedido({ estado: estados.confirmado });
      await crearUso(pedido, cupon, 'CONFIRMADO', { confirmadoEn: AHORA });

      await expect(
        liberarCuponDePedido(pedido.id, { ahora: AHORA })
      ).resolves.toEqual({
        liberado: false,
        motivo: RESULTADOS_LIBERACION.NO_RESERVADO,
        pedidoId: Number(pedido.id),
        cuponId: Number(cupon.id),
      });

      const fila = await PedidoCupon.findOne({
        where: { pedidoId: pedido.id },
      });
      expect(fila.estado).toBe('CONFIRMADO');
      expect(fila.confirmadoEn).not.toBeNull();
      expect(fila.liberadoEn).toBeNull();

      await expect(
        obtenerEstadoCupon(cupon, { ahora: AHORA, minutosReserva: 15 })
      ).resolves.toBe(ESTADOS_CUPON.USADO);
    });

    test('un CONFIRMADO mantiene NO_RESERVADO al reintentar la liberación', async () => {
      const cupon = await crearCupon();
      const pedido = await crearPedido({ estado: estados.confirmado });
      await crearUso(pedido, cupon, 'CONFIRMADO', { confirmadoEn: AHORA });

      const esperado = {
        liberado: false,
        motivo: RESULTADOS_LIBERACION.NO_RESERVADO,
        pedidoId: Number(pedido.id),
        cuponId: Number(cupon.id),
      };

      await expect(
        liberarCuponDePedido(pedido.id, { ahora: AHORA })
      ).resolves.toEqual(esperado);

      const fila = await PedidoCupon.findOne({
        where: { pedidoId: pedido.id },
      });

      await expect(
        liberarCuponDePedido(pedido.id, { ahora: diasAdelante(1) })
      ).resolves.toEqual(esperado);

      await fila.reload();
      expect(fila.estado).toBe('CONFIRMADO');
      expect(fila.liberadoEn).toBeNull();
      expect(fila.confirmadoEn).not.toBeNull();
    });

    test('un pedido sin cupón devuelve sin_cupon', async () => {
      const pedido = await crearPedido();
      await expect(
        liberarCuponDePedido(pedido.id, { ahora: AHORA })
      ).resolves.toEqual({
        liberado: false,
        motivo: RESULTADOS_LIBERACION.SIN_CUPON,
      });
    });

    test('reutiliza la transacción del llamador y respeta su rollback', async () => {
      const cupon = await crearCupon();
      const pedido = await crearPedido();
      await crearUso(pedido, cupon);

      await expect(
        db.sequelize.transaction(async (transaction) => {
          const resultado = await liberarCuponDePedido(pedido.id, {
            ahora: AHORA,
            transaction,
          });
          expect(resultado.motivo).toBe(RESULTADOS_LIBERACION.LIBERADO);
          throw new Error('rollback a propósito');
        })
      ).rejects.toThrow('rollback a propósito');

      const fila = await PedidoCupon.findOne({
        where: { pedidoId: pedido.id },
      });
      expect(fila.estado).toBe('RESERVADO');
      expect(fila.liberadoEn).toBeNull();
    });
  });

  describe('generarCodigosDisponibles', () => {
    test('descarta códigos que ya existen en la base', async () => {
      await crearCupon({ codigo: 'CR-EXISTE01' });

      const secuencia = ['CR-EXISTE01', 'CR-NUEVO001', 'CR-NUEVO002'];
      let indice = 0;
      const codigos = await generarCodigosDisponibles(2, {
        generar: () => secuencia[indice++],
      });

      expect(codigos).toEqual(['CR-NUEVO001', 'CR-NUEVO002']);
    });

    test('también deduplica dentro del mismo lote', async () => {
      const secuencia = ['CR-LOTE0001', 'CR-LOTE0001', 'CR-LOTE0002'];
      let indice = 0;
      const codigos = await generarCodigosDisponibles(2, {
        generar: () => secuencia[indice++],
      });
      expect(codigos).toEqual(['CR-LOTE0001', 'CR-LOTE0002']);
    });
  });
});
