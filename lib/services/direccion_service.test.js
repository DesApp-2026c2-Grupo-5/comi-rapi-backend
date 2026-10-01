/**
 * Tests de direccion_service (orquestación del ABM de Direccion).
 *
 * Los servicios de geolocalización/cobertura y el modelo se mockean: los tests
 * NO dependen de APIs externas ni de BD. La integración end-to-end se cubre en
 * los tests de controllers.
 */

jest.mock('../models', () => ({
  Direccion: { create: jest.fn() },
}));
jest.mock('./geolocation_service', () => ({
  geocodificarDireccion: jest.fn(),
}));
jest.mock('./cobertura_service', () => {
  class DireccionFueraDeZonaError extends Error {
    constructor(mensaje) {
      super(mensaje);
      this.name = 'DireccionFueraDeZonaError';
    }
  }
  class DireccionSinCoberturaError extends Error {
    constructor(mensaje, opciones = {}) {
      super(mensaje);
      this.name = 'DireccionSinCoberturaError';
      if (opciones.distanciaMasCercanaMetros !== undefined) {
        this.distanciaMasCercanaMetros = opciones.distanciaMasCercanaMetros;
      }
    }
  }
  return {
    validarCoberturaParaDelivery: jest.fn(),
    DireccionFueraDeZonaError,
    DireccionSinCoberturaError,
  };
});
import db from '../models';
import { geocodificarDireccion } from './geolocation_service';
import { validarCoberturaParaDelivery } from './cobertura_service';
import {
  ErrorValidacionDireccion,
  validarDatosDireccion,
  prepararDireccion,
  crearDireccionDeUsuario,
  actualizarDireccionDeUsuario,
  persistirDireccionSucursal,
} from './direccion_service';
import {
  DireccionFueraDeZonaError,
  DireccionSinCoberturaError,
} from './cobertura_service';

const { Direccion } = db;

const GEO_CABA = {
  latitud: -34.60385632930893,
  longitud: -58.38419018127011,
  nomenclatura: 'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires',
  normalizada: {
    calle: 'AV. CORRIENTES',
    provincia: 'Ciudad Autónoma de Buenos Aires',
    departamento: 'Comuna 1',
    localidad: 'Comuna 1',
  },
};

const DATOS_CABA = {
  calle: 'Av. Corrientes',
  altura: 1234,
  provincia: 'Ciudad Autónoma de Buenos Aires',
  localidad: 'CABA',
  codigoPostal: '1043',
};

const DIRECCION_PERSISTIDA = {
  usuarioId: 7,
  calle: 'Av. Corrientes',
  altura: 1234,
  provincia: 'Ciudad Autónoma de Buenos Aires',
  localidad: 'CABA',
  codigoPostal: '1043',
  latitud: -34.6038,
  longitud: -58.3842,
  update: jest.fn().mockResolvedValue({}),
};

describe('direccion_service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validarDatosDireccion', () => {
    test('creación: valida y normaliza todos los campos', () => {
      const valores = validarDatosDireccion({
        ...DATOS_CABA,
        calle: '  Av. Corrientes  ',
        altura: '1234',
        alias: '  Casa ',
        referencia: '',
      });
      expect(valores).toEqual({
        calle: 'Av. Corrientes',
        altura: 1234,
        provincia: 'Ciudad Autónoma de Buenos Aires',
        localidad: 'CABA',
        codigoPostal: '1043',
        referencia: null,
        alias: 'Casa',
      });
    });

    test('rechaza campos obligatorios faltantes (400)', () => {
      expect(() => validarDatosDireccion(null)).toThrow(
        ErrorValidacionDireccion
      );
      expect(() => validarDatosDireccion({ altura: 1 })).toThrow(/calle/);
      expect(() => validarDatosDireccion({ calle: 'Calle' })).toThrow(/altura/);
      expect(() =>
        validarDatosDireccion({ calle: 'Calle', altura: 1 })
      ).toThrow(/provincia/);
      // Iteración 1-geo: localidad y codigoPostal son opcionales; ya no se
      // exigen en la validación de entrada.
      expect(() =>
        validarDatosDireccion({ calle: 'Calle', altura: 1, provincia: 'P' })
      ).not.toThrow();
    });

    test('acumula TODOS los errores de campo en un único mensaje', () => {
      let mensaje = null;
      try {
        validarDatosDireccion({ altura: -5, provincia: '' });
      } catch (e) {
        mensaje = e instanceof ErrorValidacionDireccion ? e.message : null;
      }
      expect(mensaje).toContain('La altura debe ser un número entero');
      expect(mensaje).toContain('La provincia es obligatoria');
      expect(mensaje).toContain('; ');
    });

    test('rechaza altura inválida y coordenadas manuales (400)', () => {
      expect(() =>
        validarDatosDireccion({ ...DATOS_CABA, altura: -5 })
      ).toThrow(/altura/);
      expect(() =>
        validarDatosDireccion({ ...DATOS_CABA, altura: 1.5 })
      ).toThrow(/altura/);
      expect(() =>
        validarDatosDireccion({ ...DATOS_CABA, latitud: -34.6 })
      ).toThrow(/no se ingresan manualmente/);
      expect(() =>
        validarDatosDireccion({ ...DATOS_CABA, longitud: -58.38 })
      ).toThrow(/no se ingresan manualmente/);
    });

    test('parcial: solo valida los campos provistos', () => {
      expect(
        validarDatosDireccion({ alias: 'Casa' }, { parcial: true })
      ).toEqual({
        alias: 'Casa',
      });
      expect(
        validarDatosDireccion({ altura: '999' }, { parcial: true })
      ).toEqual({ altura: 999 });
      expect(() =>
        validarDatosDireccion({ provincia: '' }, { parcial: true })
      ).toThrow(/no puede quedar vacío/);
      expect(() => validarDatosDireccion({}, { parcial: true })).not.toThrow();
    });
  });

  describe('prepararDireccion', () => {
    test('sin existente (creación): geocodifica siempre', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      const { valores, coordenadas } = await prepararDireccion({
        datos: DATOS_CABA,
      });

      expect(geocodificarDireccion).toHaveBeenCalledWith({
        calle: 'Av. Corrientes',
        altura: 1234,
        provincia: 'Ciudad Autónoma de Buenos Aires',
        localidad: 'CABA',
      });
      expect(coordenadas).toEqual({
        latitud: GEO_CABA.latitud,
        longitud: GEO_CABA.longitud,
      });
      expect(valores.calle).toBe('Av. Corrientes');
      // Iteración 1-geo: datos territoriales persistidos normalizados.
      expect(valores.departamento).toBe(GEO_CABA.normalizada.departamento);
      expect(valores.localidad).toBe(GEO_CABA.normalizada.localidad);
      expect(valores.nomenclatura).toBe(GEO_CABA.nomenclatura);
    });

    // Iteración 1-geo: en Buenos Aires el partido es obligatorio (regla
    // territorial para desambiguar).
    test('creación en Buenos Aires sin partido → ErrorValidacionDireccion', async () => {
      await expect(
        prepararDireccion({
          datos: {
            calle: 'General Villegas',
            altura: 5329,
            provincia: 'Buenos Aires',
          },
        })
      ).rejects.toThrow(/partido es obligatorio/i);
      expect(geocodificarDireccion).not.toHaveBeenCalled();
    });

    test('creación en Buenos Aires con partido: lo envía a la query', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      await prepararDireccion({
        datos: {
          calle: 'General Villegas',
          altura: 5329,
          provincia: 'Buenos Aires',
          departamento: 'Tres de Febrero',
        },
      });
      expect(geocodificarDireccion).toHaveBeenCalledWith(
        expect.objectContaining({ departamento: 'Tres de Febrero' })
      );
    });

    // Iteración 1-geo: la insensibilidad a acentos/mayúsculas de la regla.
    test('la regla del partido tolera acentos y mayúsculas en la provincia', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      await expect(
        prepararDireccion({
          datos: {
            calle: 'Calle',
            altura: 1,
            provincia: 'BUENOS AIRES',
          },
        })
      ).rejects.toThrow(/partido es obligatorio/i);
    });

    test('con existente y cambio de campo de ubicación: re-geocodifica con datos combinados', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      const { valores, coordenadas } = await prepararDireccion({
        datos: { calle: 'Av. Nueva' },
        existente: DIRECCION_PERSISTIDA,
      });

      expect(geocodificarDireccion).toHaveBeenCalledWith({
        calle: 'Av. Nueva',
        altura: 1234,
        provincia: 'Ciudad Autónoma de Buenos Aires',
        localidad: 'CABA',
      });
      expect(coordenadas).toEqual({
        latitud: GEO_CABA.latitud,
        longitud: GEO_CABA.longitud,
      });
      expect(valores.calle).toBe('Av. Nueva');
      expect(valores.departamento).toBe(GEO_CABA.normalizada.departamento);
      expect(valores.localidad).toBe(GEO_CABA.normalizada.localidad);
      expect(valores.nomenclatura).toBe(GEO_CABA.nomenclatura);
    });

    test('con existente y cambio solo de alias/referencia: NO geocodifica', async () => {
      const { valores, coordenadas } = await prepararDireccion({
        datos: { alias: 'Trabajo', referencia: 'Piso 3' },
        existente: DIRECCION_PERSISTIDA,
      });

      expect(geocodificarDireccion).not.toHaveBeenCalled();
      expect(coordenadas).toBe(null);
      expect(valores).toEqual({ alias: 'Trabajo', referencia: 'Piso 3' });
    });

    test('con existente y cambio solo de codigoPostal: NO geocodifica (Georef no lo usa)', async () => {
      const { valores, coordenadas } = await prepararDireccion({
        datos: { codigoPostal: '9999' },
        existente: DIRECCION_PERSISTIDA,
      });

      expect(geocodificarDireccion).not.toHaveBeenCalled();
      expect(coordenadas).toBe(null);
      expect(valores).toEqual({ codigoPostal: '9999' });
    });

    test('con existente y misma altura en otro formato: NO re-geocodifica', async () => {
      await prepararDireccion({
        datos: { altura: '1234' },
        existente: DIRECCION_PERSISTIDA,
      });
      expect(geocodificarDireccion).not.toHaveBeenCalled();
    });

    test('exigirCobertura: valida cobertura con las coordenadas geocodificadas', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      validarCoberturaParaDelivery.mockResolvedValue({
        coberturaDisponible: true,
      });
      await prepararDireccion({ datos: DATOS_CABA, exigirCobertura: true });

      expect(validarCoberturaParaDelivery).toHaveBeenCalledWith({
        coordenadas: { latitud: GEO_CABA.latitud, longitud: GEO_CABA.longitud },
        normalizada: GEO_CABA.normalizada,
      });
    });

    test('exigirCobertura: si la cobertura falla, propaga el error tipado', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      validarCoberturaParaDelivery.mockRejectedValue(
        new DireccionFueraDeZonaError()
      );
      await expect(
        prepararDireccion({ datos: DATOS_CABA, exigirCobertura: true })
      ).rejects.toThrow(DireccionFueraDeZonaError);
    });

    test('sin exigirCobertura (sucursal): no valida cobertura', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      await prepararDireccion({ datos: DATOS_CABA });
      expect(validarCoberturaParaDelivery).not.toHaveBeenCalled();
    });
  });

  describe('crearDireccionDeUsuario', () => {
    test('persiste con coordenadas obtenidas por el backend', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      validarCoberturaParaDelivery.mockResolvedValue({
        coberturaDisponible: true,
      });
      Direccion.create.mockResolvedValue({ id: 1, ...DATOS_CABA });

      const creada = await crearDireccionDeUsuario({
        usuarioId: 7,
        datos: DATOS_CABA,
      });

      expect(Direccion.create).toHaveBeenCalledWith({
        usuarioId: 7,
        calle: 'Av. Corrientes',
        altura: 1234,
        provincia: 'Ciudad Autónoma de Buenos Aires',
        localidad: GEO_CABA.normalizada.localidad,
        codigoPostal: '1043',
        departamento: GEO_CABA.normalizada.departamento,
        nomenclatura: GEO_CABA.nomenclatura,
        latitud: GEO_CABA.latitud,
        longitud: GEO_CABA.longitud,
        activa: true,
      });
      expect(creada.id).toBe(1);
    });

    test('si la cobertura falla, NO persiste la dirección', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      validarCoberturaParaDelivery.mockRejectedValue(
        new DireccionSinCoberturaError()
      );
      await expect(
        crearDireccionDeUsuario({ usuarioId: 7, datos: DATOS_CABA })
      ).rejects.toThrow(DireccionSinCoberturaError);
      expect(Direccion.create).not.toHaveBeenCalled();
    });

    test('si la geocodificación falla, NO persiste la dirección', async () => {
      geocodificarDireccion.mockRejectedValue(
        new ErrorValidacionDireccion('La calle es obligatoria')
      );
      await expect(
        crearDireccionDeUsuario({ usuarioId: 7, datos: {} })
      ).rejects.toThrow(ErrorValidacionDireccion);
      expect(Direccion.create).not.toHaveBeenCalled();
    });
  });

  describe('actualizarDireccionDeUsuario', () => {
    test('cambio de ubicación: re-geocodifica y actualiza coordenadas', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      validarCoberturaParaDelivery.mockResolvedValue({
        coberturaDisponible: true,
      });
      const update = jest.fn().mockResolvedValue({});
      await actualizarDireccionDeUsuario({
        direccion: { ...DIRECCION_PERSISTIDA, update },
        datos: { calle: 'Av. Nueva' },
      });

      expect(update).toHaveBeenCalledWith({
        calle: 'Av. Nueva',
        latitud: GEO_CABA.latitud,
        longitud: GEO_CABA.longitud,
        departamento: GEO_CABA.normalizada.departamento,
        localidad: GEO_CABA.normalizada.localidad,
        nomenclatura: GEO_CABA.nomenclatura,
      });
    });

    test('cambio solo de alias: actualiza sin llamar a proveedores', async () => {
      const update = jest.fn().mockResolvedValue({});
      await actualizarDireccionDeUsuario({
        direccion: { ...DIRECCION_PERSISTIDA, update },
        datos: { alias: 'Nuevo alias' },
      });

      expect(geocodificarDireccion).not.toHaveBeenCalled();
      expect(validarCoberturaParaDelivery).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({ alias: 'Nuevo alias' });
    });

    test('si la re-validación de cobertura falla, NO actualiza nada', async () => {
      geocodificarDireccion.mockResolvedValue(GEO_CABA);
      validarCoberturaParaDelivery.mockRejectedValue(
        new DireccionSinCoberturaError()
      );
      const update = jest.fn();
      await expect(
        actualizarDireccionDeUsuario({
          direccion: { ...DIRECCION_PERSISTIDA, update },
          datos: { calle: 'Av. Nueva' },
        })
      ).rejects.toThrow(DireccionSinCoberturaError);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('persistirDireccionSucursal', () => {
    test('con dirección existente: update dentro de la transacción', async () => {
      const update = jest.fn().mockResolvedValue({});
      const transaction = { id: 1 };
      await persistirDireccionSucursal({
        sucursalId: 3,
        existente: { update },
        valores: { calle: 'Nueva', altura: 10 },
        coordenadas: { latitud: -34.6, longitud: -58.38 },
        transaction,
      });

      expect(update).toHaveBeenCalledWith(
        {
          calle: 'Nueva',
          altura: 10,
          latitud: -34.6,
          longitud: -58.38,
        },
        { transaction }
      );
    });

    test('con coordenadas null (sin re-geocodificación): conserva las persistidas', async () => {
      const update = jest.fn().mockResolvedValue({});
      await persistirDireccionSucursal({
        sucursalId: 3,
        existente: { update, latitud: -34.6, longitud: -58.38 },
        valores: { alias: 'X' },
        coordenadas: null,
      });

      expect(update).toHaveBeenCalledWith(
        { alias: 'X' },
        { transaction: null }
      );
    });

    test('sin dirección existente: create con sucursalId y activa', async () => {
      Direccion.create.mockResolvedValue({ id: 5 });
      await persistirDireccionSucursal({
        sucursalId: 3,
        valores: {
          calle: 'Nueva',
          altura: 10,
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
        },
        coordenadas: { latitud: -34.6, longitud: -58.38 },
        transaction: null,
      });

      expect(Direccion.create).toHaveBeenCalledWith(
        {
          calle: 'Nueva',
          altura: 10,
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
          latitud: -34.6,
          longitud: -58.38,
          sucursalId: 3,
          activa: true,
        },
        { transaction: null }
      );
    });
  });
});
