import db from '../models';
import { cleanDb } from '../../test/db_utils';
import { conDeleteDeSesionesFallando } from '../../test/transacciones_utils';
import {
  generarToken,
  hashearToken,
  esTokenBienFormado,
  normalizarEmail,
  calcularExpiracion,
  emitirTokenRecuperacion,
  clasificarToken,
  clasificarRegistro,
  aplicarCambioDePassword,
  eliminarSesiones,
  TokenNoUtilizableError,
} from './password_reset_service';

const { Usuario, PasswordResetToken } = db;

const crearUsuario = (overrides = {}) =>
  Usuario.create({
    nombre: 'Cliente',
    apellido: 'Prueba',
    email: 'cliente@test.com',
    password: 'original123',
    telefono: '1155555555',
    rol: 'CLIENTE',
    activo: true,
    ...overrides,
  });

describe('PasswordResetService', () => {
  let usuario;

  // Argon2id y los bloqueos de fila hacen que algunos casos superen los 5s
  // por defecto de Jest. El cierre de la conexión lo hace jest.setup.js.
  jest.setTimeout(30000);

  beforeEach(async () => {
    await cleanDb();
    usuario = await crearUsuario();
  });

  describe('generación y hash del token', () => {
    test('genera un token de 64 hexadecimales', () => {
      const token = generarToken();
      expect(token).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);
    });

    test('dos tokens generados nunca coinciden', () => {
      const tokens = new Set(Array.from({ length: 200 }, generarToken));
      expect(tokens.size).toBe(200);
    });

    test('el hash es determinístico y no es el token', () => {
      const token = generarToken();
      const hash = hashearToken(token);
      expect(hash).toHaveLength(64);
      expect(hash).toBe(hashearToken(token));
      expect(hash).not.toBe(token);
    });

    test('esTokenBienFormado acepta tokens válidos y rechaza basura', () => {
      expect(esTokenBienFormado(generarToken())).toBe(true);
      expect(esTokenBienFormado('basura')).toBe(false);
      expect(esTokenBienFormado('')).toBe(false);
      expect(esTokenBienFormado(undefined)).toBe(false);
      expect(esTokenBienFormado('z'.repeat(64))).toBe(false);
    });

    test('normalizarEmail aplica trim y lowercase', () => {
      expect(normalizarEmail('  Cliente@Test.COM ')).toBe('cliente@test.com');
      expect(normalizarEmail(undefined)).toBe('');
    });
  });

  describe('emisión', () => {
    test('guarda solo el hash y nunca el token en claro', async () => {
      const { token, registro } = await emitirTokenRecuperacion(usuario.id);

      expect(registro.tokenHash).toBe(hashearToken(token));
      expect(registro.tokenHash).not.toBe(token);
    });

    test('expira exactamente 10 minutos después de crearse', async () => {
      const antes = Date.now();
      const { registro } = await emitirTokenRecuperacion(usuario.id);
      const minutos = (registro.expiresAt.getTime() - antes) / 60000;

      expect(minutos).toBeGreaterThan(9.9);
      expect(minutos).toBeLessThanOrEqual(10);
    });

    test('usa la expiración configurada', () => {
      const expiracion = calcularExpiracion(new Date('2026-01-01T00:00:00Z'));
      expect(expiracion.toISOString()).toBe('2026-01-01T00:10:00.000Z');
    });

    test('nace con usedAt e invalidatedAt en null', async () => {
      const { registro } = await emitirTokenRecuperacion(usuario.id);
      expect(registro.usedAt).toBeNull();
      expect(registro.invalidatedAt).toBeNull();
    });
  });

  describe('invalidación de tokens anteriores', () => {
    test('una solicitud nueva invalida el token pendiente', async () => {
      const { token: anterior } = await emitirTokenRecuperacion(usuario.id);
      const { token: nuevo } = await emitirTokenRecuperacion(usuario.id);

      const { estado: estadoAnterior } = await clasificarToken(anterior);
      const { estado: estadoNuevo } = await clasificarToken(nuevo);

      expect(estadoAnterior).toBe('invalidado');
      expect(estadoNuevo).toBe('vigente');
    });

    test('el token invalidado NO se borra (queda para auditoría)', async () => {
      const { registro: anterior } = await emitirTokenRecuperacion(usuario.id);
      await emitirTokenRecuperacion(usuario.id);

      const guardado = await PasswordResetToken.findByPk(anterior.id);
      expect(guardado).not.toBeNull();
      expect(guardado.invalidatedAt).not.toBeNull();
      expect(guardado.estado()).toBe('invalidado');
    });

    test('queda exactamente un token vigente por usuario', async () => {
      await emitirTokenRecuperacion(usuario.id);
      await emitirTokenRecuperacion(usuario.id);
      const { token: ultimo } = await emitirTokenRecuperacion(usuario.id);

      const pendientes = await PasswordResetToken.findAll({
        where: { usuarioId: usuario.id, usedAt: null, invalidatedAt: null },
      });
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0].tokenHash).toBe(hashearToken(ultimo));
    });
  });

  describe('clasificación del token', () => {
    test('token inexistente', async () => {
      const { registro, estado } = await clasificarToken(generarToken());
      expect(registro).toBeNull();
      expect(estado).toBe('inexistente');
    });

    test('token mal formado', async () => {
      const { estado } = await clasificarToken('basura');
      expect(estado).toBe('invalido');
    });

    test('token expirado', async () => {
      const { token, registro } = await emitirTokenRecuperacion(usuario.id);
      await registro.update({ expiresAt: new Date(Date.now() - 60000) });

      const { estado } = await clasificarToken(token);
      expect(estado).toBe('expirado');
    });

    test('token usado', async () => {
      const { token, registro } = await emitirTokenRecuperacion(usuario.id);
      await registro.update({ usedAt: new Date() });

      const { estado } = await clasificarToken(token);
      expect(estado).toBe('usado');
    });

    test('token vigente', async () => {
      const { token } = await emitirTokenRecuperacion(usuario.id);
      const { estado } = await clasificarToken(token);
      expect(estado).toBe('vigente');
    });

    test('clasificarRegistro no consulta la base y respeta el orden de estados', () => {
      const futuro = new Date(Date.now() + 60000);
      const pasado = new Date(Date.now() - 60000);

      expect(clasificarRegistro(null)).toBe('inexistente');
      expect(
        clasificarRegistro({
          invalidatedAt: new Date(),
          usedAt: new Date(),
          expiresAt: futuro,
        })
      ).toBe('invalidado');
      expect(
        clasificarRegistro({ usedAt: new Date(), expiresAt: pasado })
      ).toBe('usado');
      expect(clasificarRegistro({ expiresAt: pasado })).toBe('expirado');
      expect(clasificarRegistro({ expiresAt: futuro })).toBe('vigente');
    });
  });

  describe('aplicación del cambio de contraseña', () => {
    const sesionDe = (sid, usuarioId) =>
      db.sequelize.query(
        `INSERT INTO "session" (sid, sess, expire) VALUES (:sid, :sess, :expire)`,
        {
          replacements: {
            sid,
            sess: JSON.stringify({ usuarioId }),
            expire: new Date(Date.now() + 3600000),
          },
        }
      );

    const contarSesiones = async (usuarioId) => {
      const [
        filas,
      ] = await db.sequelize.query(
        `SELECT count(*)::int AS n FROM "session" WHERE "sess"->>'usuarioId' = :id`,
        { replacements: { id: String(usuarioId) } }
      );
      return filas[0].n;
    };

    test('cambia la contraseña, consume el token y borra las sesiones', async () => {
      const { token, registro } = await emitirTokenRecuperacion(usuario.id);
      await sesionDe('sess-de-prueba', usuario.id);

      await aplicarCambioDePassword({ token, nuevaPassword: 'nuevaClave123' });

      const recargado = await Usuario.findByPk(usuario.id);
      expect(await recargado.verificarPassword('nuevaClave123')).toBe(true);
      expect(await recargado.verificarPassword('original123')).toBe(false);
      // El hook Argon2id debe haber corrido: nunca queda en texto plano.
      expect(recargado.password).not.toBe('nuevaClave123');
      expect(recargado.password.startsWith('$argon2')).toBe(true);

      const consumido = await PasswordResetToken.findByPk(registro.id);
      expect(consumido.usedAt).not.toBeNull();
      expect(await contarSesiones(usuario.id)).toBe(0);

      const { estado } = await clasificarToken(token);
      expect(estado).toBe('usado');
    });

    test('un token usado no puede reutilizarse', async () => {
      const { token } = await emitirTokenRecuperacion(usuario.id);
      await aplicarCambioDePassword({ token, nuevaPassword: 'primeraClave1' });

      const { estado } = await clasificarToken(token);
      expect(estado).toBe('usado');

      await expect(
        aplicarCambioDePassword({ token, nuevaPassword: 'segundaClave2' })
      ).rejects.toBeInstanceOf(TokenNoUtilizableError);
    });

    test('rechaza un token expirado sin tocar la contraseña', async () => {
      const { token, registro } = await emitirTokenRecuperacion(usuario.id);
      await registro.update({ expiresAt: new Date(Date.now() - 1000) });

      await expect(
        aplicarCambioDePassword({ token, nuevaPassword: 'nuevaClave123' })
      ).rejects.toBeInstanceOf(TokenNoUtilizableError);

      expect(
        await (await Usuario.findByPk(usuario.id)).verificarPassword(
          'original123'
        )
      ).toBe(true);
    });

    test('rechaza un token invalidado por una emisión posterior', async () => {
      const { token: anterior } = await emitirTokenRecuperacion(usuario.id);
      await emitirTokenRecuperacion(usuario.id);

      await expect(
        aplicarCambioDePassword({
          token: anterior,
          nuevaPassword: 'nuevaClave123',
        })
      ).rejects.toBeInstanceOf(TokenNoUtilizableError);
    });

    test('el error de dominio expone el estado interno', async () => {
      const { token, registro } = await emitirTokenRecuperacion(usuario.id);
      await registro.update({ usedAt: new Date() });

      await expect(
        aplicarCambioDePassword({ token, nuevaPassword: 'nuevaClave123' })
      ).rejects.toMatchObject({ estado: 'usado' });
    });
  });

  describe('concurrencia', () => {
    test('dos resets simultáneos: solo uno cambia la contraseña', async () => {
      const { token } = await emitirTokenRecuperacion(usuario.id);

      const intentos = ['primeraClave1', 'segundaClave2'].map((password) =>
        aplicarCambioDePassword({ token, nuevaPassword: password }).then(
          () => 'ok',
          (error) => error
        )
      );

      const resultados = await Promise.all(intentos);
      const exitos = resultados.filter((r) => r === 'ok');
      const rechazados = resultados.filter((r) => r !== 'ok');

      // El bloqueo de fila garantiza que gana uno solo.
      expect(exitos).toHaveLength(1);
      expect(rechazados).toHaveLength(1);
      expect(rechazados[0]).toBeInstanceOf(TokenNoUtilizableError);
      expect(rechazados[0].estado).toBe('usado');

      // Y la contraseña final es la del ganador, no una mezcla.
      const final = await Usuario.findByPk(usuario.id);
      const [, perdedora] =
        exitos[0] === 'ok'
          ? ['ganador', 'segundaClave2']
          : ['ganador', 'primeraClave1'];
      expect(await final.verificarPassword(perdedora)).toBe(false);
    });
  });

  describe('atomicidad y rollback', () => {
    // El trigger hace fallar el DELETE de sesiones, que es el ÚLTIMO paso de la
    // transacción: si algo queda sin revertir, es porque el rollback falló.
    test('un error al borrar sesiones revierte password, token y la sesión', async () => {
      const { token, registro } = await emitirTokenRecuperacion(usuario.id);
      await db.sequelize.query(
        `INSERT INTO "session" (sid, sess, expire) VALUES (:sid, :sess, :expire)`,
        {
          replacements: {
            sid: 'sesion-que-debe-sobrevivir',
            sess: JSON.stringify({ usuarioId: usuario.id }),
            expire: new Date(Date.now() + 3600000),
          },
        }
      );

      const error = await conDeleteDeSesionesFallando(() =>
        aplicarCambioDePassword({ token, nuevaPassword: 'nuevaClave123' })
      );
      expect(error.message).toMatch(/fallo simulado/);

      // 1. La contraseña NO cambió.
      const usuarioTocado = await Usuario.findByPk(usuario.id);
      expect(usuarioTocado.password).toBe(usuario.password);
      expect(await usuarioTocado.verificarPassword('original123')).toBe(true);
      expect(await usuarioTocado.verificarPassword('nuevaClave123')).toBe(
        false
      );

      // 2. El token NO quedó consumido: sigue siendo utilizable.
      const tokenIntacto = await PasswordResetToken.findByPk(registro.id);
      expect(tokenIntacto.usedAt).toBeNull();
      expect(tokenIntacto.esUtilizable()).toBe(true);

      // 3. La sesión sigue viva.
      const [sesiones] = await db.sequelize.query(
        `SELECT count(*)::int AS n FROM "session" WHERE sid = 'sesion-que-debe-sobrevivir'`
      );
      expect(sesiones[0].n).toBe(1);
    });

    test('tras el rollback el token se puede usar normalmente', async () => {
      const { token } = await emitirTokenRecuperacion(usuario.id);
      // El trigger es BEFORE DELETE FOR EACH ROW: sin filas que borrar no
      // dispara, así que la sesión debe existir para provocar el fallo.
      await db.sequelize.query(
        `INSERT INTO "session" (sid, sess, expire) VALUES (:sid, :sess, :expire)`,
        {
          replacements: {
            sid: 'sesion-del-segundo-intento',
            sess: JSON.stringify({ usuarioId: usuario.id }),
            expire: new Date(Date.now() + 3600000),
          },
        }
      );

      await conDeleteDeSesionesFallando(() =>
        aplicarCambioDePassword({ token, nuevaPassword: 'primeraClave1' })
      );

      // El segundo intento, ya sin el trigger, debe funcionar.
      await aplicarCambioDePassword({ token, nuevaPassword: 'segundaClave2' });
      expect(
        await (await Usuario.findByPk(usuario.id)).verificarPassword(
          'segundaClave2'
        )
      ).toBe(true);
    });

    test('el rechazo de un token inválido no modifica nada', async () => {
      const { registro } = await emitirTokenRecuperacion(usuario.id);
      await registro.update({ usedAt: new Date() });

      await expect(
        aplicarCambioDePassword({
          token: generarToken(),
          nuevaPassword: 'nuevaClave123',
        })
      ).rejects.toBeInstanceOf(TokenNoUtilizableError);

      expect(
        await (await Usuario.findByPk(usuario.id)).verificarPassword(
          'original123'
        )
      ).toBe(true);
    });
  });

  describe('eliminación de sesiones', () => {
    test('borra solo las sesiones del usuario indicado', async () => {
      const otro = await crearUsuario({ email: 'otro@test.com' });

      for (const u of [usuario, otro]) {
        await db.sequelize.query(
          `INSERT INTO "session" (sid, sess, expire) VALUES (:sid, :sess, :expire)`,
          {
            replacements: {
              sid: `sid-${u.id}`,
              sess: JSON.stringify({ usuarioId: u.id }),
              expire: new Date(Date.now() + 3600000),
            },
          }
        );
      }

      const borradas = await eliminarSesiones(usuario.id);
      expect(borradas).toBe(1);

      const restantes = await db.sequelize.query(
        `SELECT count(*)::int AS n FROM "session"`
      );
      expect(restantes[0][0].n).toBe(1);
    });
  });
});
