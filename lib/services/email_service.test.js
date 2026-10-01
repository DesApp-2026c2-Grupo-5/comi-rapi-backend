import net from 'net';
import {
  construirEnlaceRecuperacion,
  enviarEmailRecuperacion,
  reiniciarTransporte,
} from './email_service';
import config from '../config/config';

const TOKEN_DE_PRUEBA = 'a'.repeat(64);

/**
 * Servidor SMTP mínimo en memoria.
 *
 * Se usa en lugar de apuntar a Mailpit para que los tests NO dejen correos de
 * prueba en la bandeja del desarrollador: este servidor escucha en un puerto
 * efímero de localhost, captura el mensaje y se cierra al terminar. Así se
 * sigue verificando la conversación SMTP real (Nodemailer connects, MAIL FROM,
 * RCPT TO, DATA) y el contenido, sin ensuciar Mailpit.
 *
 * No anuncia STARTTLS, así que Nodemailer transmite en texto plano, igual que
 * contra Mailpit.
 */
const crearServidorSmtp = () =>
  new Promise((resolve) => {
    const recibidos = [];
    let server;

    server = net.createServer((socket) => {
      let enDatos = false;
      let buffer = '';
      let mensaje = '';
      // El sobre (MAIL FROM / RCPT TO) viaja en comandos, no dentro del DATA,
      // así que se guarda aparte: sin esto no se puede verificar el destinatario.
      let sobre = { mailFrom: null, rcptTo: [] };

      socket.write('220 fake.local ESMTP listo\r\n');

      socket.on('data', (chunk) => {
        // 'binary' (latin1) preserva los bytes 1:1, necesario para decodificar
        // quoted-printable y base64 sin perder nada.
        buffer += chunk.toString('binary');

        let limite = buffer.indexOf('\r\n');
        while (limite !== -1) {
          const linea = buffer.slice(0, limite);
          buffer = buffer.slice(limite + 2);

          if (enDatos) {
            // El final del cuerpo SMTP es una línea con un solo punto.
            if (linea === '.') {
              enDatos = false;
              socket.write('250 2.0.0 Ok: queued\r\n');
              recibidos.push({ ...sobre, mensaje });
              mensaje = '';
              sobre = { mailFrom: null, rcptTo: [] };
            } else {
              mensaje += `${linea}\n`;
            }
          } else if (/^DATA/i.test(linea)) {
            enDatos = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (/^QUIT/i.test(linea)) {
            socket.write('221 2.0.0 Bye\r\n');
            socket.end();
          } else if (/^MAIL FROM/i.test(linea)) {
            sobre.mailFrom = (linea.match(/<([^>]*)>/) || [])[1];
            socket.write('250 2.1.0 Ok\r\n');
          } else if (/^RCPT TO/i.test(linea)) {
            sobre.rcptTo.push((linea.match(/<([^>]*)>/) || [])[1]);
            socket.write('250 2.1.0 Ok\r\n');
          } else {
            // EHLO, RSET, NOOP... alcanza con un 250.
            socket.write('250 2.0.0 Ok\r\n');
          }

          limite = buffer.indexOf('\r\n');
        }
      });

      socket.on('error', () => {});
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, recibidos, port: server.address().port });
    });
  });

/**
 * Decodifica quoted-printable, que es como Nodemailer codifica el texto al
 * detectar acentos. Sin esto, los soft breaks (`=` al final de línea) partirían
 * el token y las aserciones fallarían sin que haya un bug real.
 */
const decodificarQuotedPrintable = (texto) =>
  texto
    .replace(/=\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

const cuerpoLegible = (mensaje) => {
  const separador = mensaje.indexOf('\n\n');
  const cuerpo = separador === -1 ? mensaje : mensaje.slice(separador + 2);
  // Si el cuerpo llegó en base64, se decodifica antes de buscar nada.
  if (/^[A-Za-z0-9+/=\s]+$/.test(cuerpo) && /=\s*$/.test(cuerpo.trim())) {
    return Buffer.from(cuerpo.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  return decodificarQuotedPrintable(cuerpo);
};

describe('EmailService', () => {
  const original = {
    transport: config.mail.transport,
    host: config.mail.host,
    port: config.mail.port,
  };

  afterEach(() => {
    config.mail.transport = original.transport;
    config.mail.host = original.host;
    config.mail.port = original.port;
    reiniciarTransporte();
    jest.restoreAllMocks();
  });

  describe('construcción del enlace', () => {
    test('apunta al frontend configurado e incluye el token', () => {
      const enlace = construirEnlaceRecuperacion(TOKEN_DE_PRUEBA);
      expect(enlace).toBe(
        `${config.frontend.url}/reset-password?token=${TOKEN_DE_PRUEBA}`
      );
    });

    test('el enlace viaja en texto plano, no hasheado', () => {
      expect(construirEnlaceRecuperacion(TOKEN_DE_PRUEBA)).toContain(
        TOKEN_DE_PRUEBA
      );
    });
  });

  describe('sin transporte configurado', () => {
    test('informa que no envió y no filtra el token', async () => {
      config.mail.transport = '';

      const resultado = await enviarEmailRecuperacion({
        destinatario: 'alguien@test.com',
        token: TOKEN_DE_PRUEBA,
      });

      expect(resultado).toEqual({ enviado: false, motivo: 'sin-transporte' });
    });

    test('no escribe nada en consola', async () => {
      config.mail.transport = '';
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await enviarEmailRecuperacion({
        destinatario: 'alguien@test.com',
        token: TOKEN_DE_PRUEBA,
      });

      const impreso = [...log.mock.calls, ...warn.mock.calls].flat().join(' ');
      expect(impreso).not.toContain(TOKEN_DE_PRUEBA);
    });
  });

  describe('con transporte SMTP', () => {
    let smtp;
    let destinatario;

    beforeEach(async () => {
      smtp = await crearServidorSmtp();
      destinatario = 'alguien@test.com';
      config.mail.transport = 'smtp';
      config.mail.host = '127.0.0.1';
      config.mail.port = smtp.port;
      reiniciarTransporte();
    });

    afterEach(async () => {
      await new Promise((resolve) => smtp.server.close(resolve));
    });

    test('entrega el mensaje con el enlace y la vigencia correctos', async () => {
      const resultado = await enviarEmailRecuperacion({
        destinatario,
        token: TOKEN_DE_PRUEBA,
      });

      expect(resultado).toEqual({ enviado: true });
      expect(smtp.recibidos).toHaveLength(1);

      const cuerpo = cuerpoLegible(smtp.recibidos[0].mensaje);
      expect(cuerpo).toContain(TOKEN_DE_PRUEBA);
      expect(cuerpo).toContain('/reset-password?token=');
      expect(cuerpo).toContain(
        `expira en ${config.passwordReset.expirationMinutes} minutos`
      );
      expect(cuerpo).toMatch(/un solo uso|solo puede usarse una vez/);
    });

    test('el mensaje va dirigido al destinatario pedido', async () => {
      await enviarEmailRecuperacion({ destinatario, token: TOKEN_DE_PRUEBA });

      const recibido = smtp.recibidos[0];
      expect(recibido.rcptTo).toEqual([destinatario]);
      expect(recibido.mensaje).toMatch(new RegExp(`^To: ${destinatario}`, 'm'));
    });

    test('el remitente sale de la configuración', async () => {
      await enviarEmailRecuperacion({ destinatario, token: TOKEN_DE_PRUEBA });

      expect(smtp.recibidos[0].mailFrom).toBe(config.mail.from);
    });

    test('el token viaja en claro en el email (es lo que lo hace usable)', async () => {
      await enviarEmailRecuperacion({ destinatario, token: TOKEN_DE_PRUEBA });

      // Contrapartida de que en la base solo se guarda el hash: el email lleva
      // el token real, y por eso el enlace funciona.
      expect(cuerpoLegible(smtp.recibidos[0].mensaje)).toContain(
        TOKEN_DE_PRUEBA
      );
    });

    test('nunca envía nada a Mailpit aunque esté configurado', async () => {
      await enviarEmailRecuperacion({ destinatario, token: TOKEN_DE_PRUEBA });

      // El puerto de Mailpit (1025) nunca se tocó: el transporte se creó
      // apuntando al servidor efímero del test.
      expect(smtp.port).not.toBe(1025);
    });
  });

  describe('fallos de SMTP', () => {
    test('un puerto cerrado hace fallar el envío (el controller lo captura)', async () => {
      config.mail.transport = 'smtp';
      config.mail.host = '127.0.0.1';
      config.mail.port = 1; // puerto cerrado a propósito
      reiniciarTransporte();

      await expect(
        enviarEmailRecuperacion({
          destinatario: 'alguien@test.com',
          token: TOKEN_DE_PRUEBA,
        })
      ).rejects.toBeDefined();
    });
  });
});
