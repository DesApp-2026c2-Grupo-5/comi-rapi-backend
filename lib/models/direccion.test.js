import { cleanDb } from '../../test/db_utils';
import db from './index';

const { Direccion, Sucursal, Usuario } = db;

const direccionValida = (overrides = {}) => ({
  calle: 'Calle Test',
  altura: 100,
  provincia: 'Buenos Aires',
  localidad: 'CABA',
  codigoPostal: '1406',
  ...overrides,
});

describe('Direccion (DER: Usuario 1:N Direccion, Sucursal 1:1 Direccion)', () => {
  beforeAll(async () => {
    await cleanDb();
  });

  describe('Asociaciones Sequelize', () => {
    test('un usuario puede tener múltiples direcciones (usuario.direcciones)', async () => {
      const usuario = await Usuario.create({
        nombre: 'Multi',
        email: 'multi-direccion@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
      await Direccion.create(
        direccionValida({
          usuarioId: usuario.id,
          calle: 'Calle Uno',
          altura: 1,
        })
      );
      await Direccion.create(
        direccionValida({
          usuarioId: usuario.id,
          calle: 'Calle Dos',
          altura: 2,
        })
      );
      const direcciones = await usuario.getDirecciones();
      expect(direcciones).toHaveLength(2);
    });

    test('una dirección puede pertenecer a un usuario (direccion.usuario)', async () => {
      const usuario = await Usuario.create({
        nombre: 'Owner',
        email: 'owner-direccion@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
      const direccion = await Direccion.create(
        direccionValida({
          usuarioId: usuario.id,
          calle: 'Calle Propia',
          altura: 10,
        })
      );
      const asociada = await direccion.getUsuario();
      expect(asociada.id).toBe(usuario.id);
    });

    test('una sucursal puede tener una dirección (sucursal.direccion)', async () => {
      const sucursal = await Sucursal.create({ nombre: 'Sucursal Dir' });
      await Direccion.create(
        direccionValida({
          sucursalId: sucursal.id,
          calle: 'Calle Sucursal',
          altura: 100,
          latitud: -34.6037,
          longitud: -58.3816,
        })
      );
      const direccion = await sucursal.getDireccion();
      expect(direccion).not.toBeNull();
      expect(direccion.calle).toBe('Calle Sucursal');
      expect(Number(direccion.latitud)).toBe(-34.6037);
      expect(Number(direccion.longitud)).toBe(-58.3816);
    });

    test('una dirección puede pertenecer a una sucursal (direccion.sucursal)', async () => {
      const sucursal = await Sucursal.create({ nombre: 'Sucursal Ref' });
      const direccion = await Direccion.create(
        direccionValida({ sucursalId: sucursal.id, calle: 'Calle Referida' })
      );
      const asociada = await direccion.getSucursal();
      expect(asociada.id).toBe(sucursal.id);
    });
  });

  describe('Restricción: un solo propietario (usuario o sucursal)', () => {
    test('rechaza una dirección con usuarioId y sucursalId a la vez (validación de modelo)', async () => {
      const usuario = await Usuario.create({
        nombre: 'Ambos',
        email: 'ambos-direccion@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
      const sucursal = await Sucursal.create({ nombre: 'Sucursal Ambos' });
      await expect(
        Direccion.create(
          direccionValida({
            usuarioId: usuario.id,
            sucursalId: sucursal.id,
            calle: 'Calle Ambigua',
          })
        )
      ).rejects.toThrow(/un usuario o a una sucursal/);
    });

    test('rechaza una dirección sin usuarioId ni sucursalId (validación de modelo)', async () => {
      await expect(
        Direccion.create(direccionValida({ calle: 'Calle Huérfana' }))
      ).rejects.toThrow(/un usuario o a una sucursal/);
    });

    test('CHECK de BD: rechaza una dirección con ambos propietarios', async () => {
      const usuario = await Usuario.create({
        nombre: 'Check',
        email: 'check-direccion@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
      const sucursal = await Sucursal.create({ nombre: 'Sucursal Check' });
      await expect(
        db.sequelize.query(
          `INSERT INTO "Direcciones"
             ("usuarioId", "sucursalId", "calle", "altura", "provincia", "localidad",
              "codigoPostal", "activa", "createdAt", "updatedAt")
           VALUES (:usuarioId, :sucursalId, 'Calle Check', 1, 'Buenos Aires', 'CABA',
                   '1406', true, NOW(), NOW())`,
          { replacements: { usuarioId: usuario.id, sucursalId: sucursal.id } }
        )
      ).rejects.toThrow(/CK_Direcciones_propietario/);
    });

    test('CHECK de BD: rechaza una dirección huérfana', async () => {
      await expect(
        db.sequelize.query(
          `INSERT INTO "Direcciones"
             ("calle", "altura", "provincia", "localidad", "codigoPostal",
              "activa", "createdAt", "updatedAt")
           VALUES ('Calle Huérfana', 1, 'Buenos Aires', 'CABA', '1406',
                   true, NOW(), NOW())`
        )
      ).rejects.toThrow(/CK_Direcciones_propietario/);
    });
  });

  describe('Foreign keys', () => {
    test('rechaza sucursalId inexistente (FK → Sucursales)', async () => {
      await expect(
        Direccion.create(
          direccionValida({ sucursalId: 999999, calle: 'Calle Fantasma' })
        )
      ).rejects.toThrow();
    });

    test('rechaza usuarioId inexistente (FK → Usuarios)', async () => {
      await expect(
        Direccion.create(
          direccionValida({ usuarioId: 999999, calle: 'Calle Fantasma' })
        )
      ).rejects.toThrow();
    });
  });

  describe('Atributos', () => {
    test('latitud y longitud son opcionales (a futuro las calcula un servicio de geolocalización)', async () => {
      const usuario = await Usuario.create({
        nombre: 'Sin Coords',
        email: 'sincoords-direccion@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
      const direccion = await Direccion.create(
        direccionValida({
          usuarioId: usuario.id,
          calle: 'Calle Sin Coordenadas',
          altura: 5,
        })
      );
      expect(direccion.latitud).toBeNull();
      expect(direccion.longitud).toBeNull();
    });

    test('calle, altura, provincia, localidad y codigoPostal son obligatorios', async () => {
      const usuario = await Usuario.create({
        nombre: 'Obligatorios',
        email: 'obligatorios-direccion@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
      await expect(
        Direccion.create(
          direccionValida({ usuarioId: usuario.id, altura: null })
        )
      ).rejects.toThrow();
      await expect(
        Direccion.create(
          direccionValida({ usuarioId: usuario.id, provincia: null })
        )
      ).rejects.toThrow();
      await expect(
        Direccion.create(
          direccionValida({ usuarioId: usuario.id, localidad: null })
        )
      ).rejects.toThrow();
      await expect(
        Direccion.create(
          direccionValida({ usuarioId: usuario.id, codigoPostal: null })
        )
      ).rejects.toThrow();
    });
  });
});
