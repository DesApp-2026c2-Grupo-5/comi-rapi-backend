import crypto from 'crypto';
import net from 'net';
import {
  LOGO_RECIBO_BASE64,
  construirEnlaceRecuperacion,
  enviarEmailReciboPedido,
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
  Buffer.from(
    texto
      .replace(/=\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      ),
    'latin1'
  ).toString('utf8');

/**
 * Decodifica una parte MIME según su Content-Transfer-Encoding.
 */
const decodificarParte = (contenido, codificacion) => {
  if (/base64/i.test(codificacion)) {
    return Buffer.from(contenido.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  if (/quoted-printable/i.test(codificacion)) {
    return decodificarQuotedPrintable(contenido);
  }
  return Buffer.from(contenido, 'latin1').toString('utf8');
};

/**
 * El recibo viaja como multipart: texto plano, HTML y un único PDF adjunto.
 * Recorrer los límites evita que el base64 produzca falsos positivos en
 * aserciones del tipo "no contener tal número". Los tipos image/* se siguen
 * reconociendo para detectar cualquier adjunto indebido.
 */
const analizarMensaje = (mensaje) => {
  const partes = { texto: '', html: '', adjuntos: [] };

  const visitar = (bloque) => {
    const separador = bloque.indexOf('\n\n');
    const cabeceras = separador === -1 ? bloque : bloque.slice(0, separador);
    const contenido = separador === -1 ? '' : bloque.slice(separador + 2);
    const tipo =
      (cabeceras.match(/^Content-Type:\s*([^\r\n;]+)/im) || [])[1] ||
      'text/plain';
    const limite = (cabeceras.match(/boundary="?([^";\r\n]+)"?/i) || [])[1];
    const codificacion =
      (cabeceras.match(/^Content-Transfer-Encoding:\s*([^\r\n]+)/im) ||
        [])[1] || '';

    if (/^multipart\//i.test(tipo) && limite) {
      for (const fragmento of contenido.split(`--${limite}`)) {
        const parte = fragmento.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
        if (parte && parte !== '--') visitar(parte);
      }
      return;
    }

    if (/^text\/plain/i.test(tipo)) {
      partes.texto += decodificarParte(contenido, codificacion);
    } else if (/^text\/html/i.test(tipo)) {
      partes.html += decodificarParte(contenido, codificacion);
    } else if (/^(image\/|application\/pdf)/i.test(tipo)) {
      partes.adjuntos.push({
        tipo,
        codificacion,
        contentId:
          (cabeceras.match(/^Content-ID:\s*<([^>]+)>/im) || [])[1] || null,
        nombre:
          (cabeceras.match(/filename="?([^";\r\n]+)"?/i) || [])[1] || null,
        contenido: contenido.replace(/\s/g, ''),
      });
    }
  };

  visitar(mensaje);
  return partes;
};

/** Los fragmentos IDAT del PNG oficial son los bytes incrustados en el PDF. */
const idatDelLogo = () => {
  const png = Buffer.from(LOGO_RECIBO_BASE64, 'base64');
  const fragmentos = [];
  let desplazamiento = 8;
  while (desplazamiento + 12 <= png.length) {
    const longitud = png.readUInt32BE(desplazamiento);
    const tipo = png.toString('ascii', desplazamiento + 4, desplazamiento + 8);
    if (tipo === 'IDAT') {
      fragmentos.push(
        png.subarray(desplazamiento + 8, desplazamiento + 8 + longitud)
      );
    }
    desplazamiento += 12 + longitud;
    if (tipo === 'IEND') break;
  }
  return Buffer.concat(fragmentos);
};

/** Lee el XObject de imagen del PDF para compararlo con el logo original. */
const imagenDelPdf = (pdfBytes) => {
  const texto = pdfBytes.toString('latin1');
  const coincidencia = texto.match(
    /\/Subtype \/Image \/Width (\d+) \/Height (\d+)[\s\S]*?\/Filter \/FlateDecode[\s\S]*?\/Length (\d+) >>\nstream\n/
  );
  if (!coincidencia) return null;
  const inicio = coincidencia.index + coincidencia[0].length;
  const longitud = Number(coincidencia[3]);
  return {
    ancho: Number(coincidencia[1]),
    alto: Number(coincidencia[2]),
    datos: pdfBytes.subarray(inicio, inicio + longitud),
    longitud,
    conPredictor: /\/Predictor 15 \/Colors 3 \/BitsPerComponent 8/.test(
      coincidencia[0]
    ),
  };
};

const cuerpoLegible = (mensaje) => analizarMensaje(mensaje).texto;

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

  describe('recibo de pedido', () => {
    let smtp;

    afterEach(async () => {
      // Red de seguridad si una aserción falla antes del cierre manual.
      if (smtp && smtp.server.listening) {
        await new Promise((resolve) => smtp.server.close(resolve));
      }
      smtp = null;
    });

    const pedidoDePrueba = () => ({
      id: 123,
      fechaHora: '2026-11-17T12:34:56.000Z',
      medioPago: 'TARJETA',
      observacion: 'Dejar en el portero',
      costoEnvio: 500,
      total: 2750,
      cliente: {
        id: 7,
        nombre: 'Ana',
        apellido: 'Pérez',
        email: 'ana@test.com',
      },
      items: [
        {
          nombreProducto: 'Hamburguesa',
          cantidad: 2,
          precioUnitario: 1500,
          subtotal: 3000,
          observacion: JSON.stringify({
            extras: [{ id: 1, nombre: 'Bacon', precio: 500, cantidad: 1 }],
            acompanamientos: [],
            sin: ['Cebolla'],
            condimentos: [{ nombre: 'Ketchup', cantidad: 2 }],
          }),
          nota: 'Sin sal, por favor',
        },
      ],
      promociones: [{ nombre: 'Happy hour', descuentoAplicado: 250 }],
      cupon: {
        codigo: 'CR-ABC123',
        descuentoAplicado: 500,
        estado: 'CONFIRMADO',
      },
      // Datos operativos que NO deben aparecer en el recibo.
      sucursalId: 99,
      Sucursal: {
        nombre: 'Sucursal Centro',
        direccion: { calle: 'Siempre Viva' },
      },
      etaMinutos: 35,
    });

    test('valida el destinatario antes de intentar el envío', async () => {
      smtp = await crearServidorSmtp();
      config.mail.transport = 'smtp';
      config.mail.host = '127.0.0.1';
      config.mail.port = smtp.port;
      reiniciarTransporte();

      for (const destinatarioInvalido of [
        undefined,
        null,
        '',
        '   ',
        'sin-arroba',
        'ana@test',
      ]) {
        await expect(
          enviarEmailReciboPedido({
            destinatario: destinatarioInvalido,
            pedido: pedidoDePrueba(),
          })
        ).resolves.toEqual({
          enviado: false,
          motivo: 'destinatario-invalido',
        });
      }
      expect(smtp.recibidos).toHaveLength(0);
      await new Promise((resolve) => smtp.server.close(resolve));
    });

    test('sin transporte informa el motivo sin lanzar', async () => {
      config.mail.transport = '';

      await expect(
        enviarEmailReciboPedido({
          destinatario: 'ana@test.com',
          pedido: pedidoDePrueba(),
        })
      ).resolves.toEqual({ enviado: false, motivo: 'sin-transporte' });
    });

    test('entrega el recibo solo al cliente, sin copias', async () => {
      smtp = await crearServidorSmtp();
      config.mail.transport = 'smtp';
      config.mail.host = '127.0.0.1';
      config.mail.port = smtp.port;
      reiniciarTransporte();

      const resultado = await enviarEmailReciboPedido({
        destinatario: 'ana@test.com',
        nombre: 'Ana',
        pedido: pedidoDePrueba(),
      });

      expect(resultado).toEqual({ enviado: true });
      expect(smtp.recibidos).toHaveLength(1);
      const recibido = smtp.recibidos[0];
      expect(recibido.rcptTo).toEqual(['ana@test.com']);
      expect(recibido.mensaje).not.toMatch(/^(Cc|Bcc):/im);
      expect(recibido.mailFrom).toBe(config.mail.from);
      expect(recibido.mensaje).toMatch(/^Subject: Recibo de tu pedido #123/m);
      await new Promise((resolve) => smtp.server.close(resolve));
    });

    test('incluye importes, notas y personalización, y excluye la sucursal', async () => {
      smtp = await crearServidorSmtp();
      config.mail.transport = 'smtp';
      config.mail.host = '127.0.0.1';
      config.mail.port = smtp.port;
      reiniciarTransporte();

      await enviarEmailReciboPedido({
        destinatario: 'ana@test.com',
        pedido: pedidoDePrueba(),
      });

      const cuerpo = cuerpoLegible(smtp.recibidos[0].mensaje);
      // Número, fecha, cliente y medio de pago.
      expect(cuerpo).toContain('Pedido: #123');
      expect(cuerpo).toContain('17/11/2026');
      expect(cuerpo).toContain('Ana Pérez');
      expect(cuerpo).toContain('Tarjeta');
      // Productos, cantidades, precios y personalización.
      expect(cuerpo).toContain('2 x Hamburguesa');
      expect(cuerpo).toContain('$1.500,00 c/u = $3.000,00');
      expect(cuerpo).toContain('Bacon');
      expect(cuerpo).toContain('Sin Cebolla');
      expect(cuerpo).toContain('Ketchup x2');
      expect(cuerpo).toContain('Nota: Sin sal, por favor');
      // Promoción, cupón, envío, nota general y total persistido.
      expect(cuerpo).toContain('Happy hour');
      expect(cuerpo).toContain('-$250,00');
      expect(cuerpo).toContain('CR-ABC123');
      expect(cuerpo).toContain('Envío: $500,00');
      expect(cuerpo).toContain('Nota del pedido: Dejar en el portero');
      expect(cuerpo).toContain('Total pagado: $2.750,00');
      // La sucursal puede cambiar después: no va en el comprobante.
      expect(cuerpo).not.toMatch(/sucursal/i);
      expect(cuerpo).not.toContain('Siempre Viva');
      expect(cuerpo).not.toContain('35');
      await new Promise((resolve) => smtp.server.close(resolve));
    });

    test('el HTML conserva la identidad visual y solo se adjunta el PDF con el logo original', async () => {
      smtp = await crearServidorSmtp();
      config.mail.transport = 'smtp';
      config.mail.host = '127.0.0.1';
      config.mail.port = smtp.port;
      reiniciarTransporte();

      await enviarEmailReciboPedido({
        destinatario: 'ana@test.com',
        pedido: pedidoDePrueba(),
      });

      const { texto, html, adjuntos } = analizarMensaje(
        smtp.recibidos[0].mensaje
      );
      // La alternativa en texto plano sigue intacta.
      expect(texto).toContain('Total pagado: $2.750,00');
      // Encabezado, comprobante y datos de pago. Sin imagen referenciada por
      // CID: el cuerpo mantiene la identidad visual solo con tipografía/color.
      expect(html).not.toContain('cid:');
      expect(html).not.toContain('<img');
      expect(html).toContain('COMI-RAPI');
      expect(html).toContain('RECIBO DE PAGO');
      expect(html).toContain('Comprobante N.º');
      expect(html).toContain('#123');
      expect(html).toContain('Ana Pérez');
      expect(html).toContain('Tarjeta');
      expect(html).toContain('PAGADO');
      // Detalle contable y resumen económico separado.
      expect(html).toContain('Detalle de productos');
      expect(html).toContain('Personalización: Bacon; Ketchup x2; Sin Cebolla');
      expect(html).toContain('Nota: Sin sal, por favor');
      expect(html).toContain('Resumen de pago');
      expect(html).toContain('Subtotal');
      expect(html).toContain('$3.000,00');
      expect(html).toContain('Happy hour');
      expect(html).toContain('-$250,00');
      expect(html).toContain('CR-ABC123');
      expect(html).toContain('Envío');
      expect(html).toContain('$500,00');
      expect(html).toContain('Total pagado');
      expect(html).toContain('$2.750,00');
      // Observaciones independientes y pie obligatorio.
      expect(html).toContain('Observaciones del pedido');
      expect(html).toContain('Dejar en el portero');
      expect(html).toContain(
        'Comprobante generado automáticamente por Comi-Rapi'
      );
      // Identidad visual: fondo blanco, marrón oscuro y naranja de la marca.
      expect(html).toContain('background:#ffffff;');
      expect(html).toContain('color:#4a2c17;');
      expect(html).toContain('color:#ff9f1c;');
      // Ningún dato operativo de la sucursal.
      expect(html).not.toMatch(/sucursal/i);
      expect(html).not.toContain('Siempre Viva');
      expect(html).not.toContain('35');

      // Único adjunto visible: el recibo en PDF. No hay PNG independiente ni
      // imagen inline con Content-ID.
      expect(adjuntos).toHaveLength(1);
      expect(adjuntos.some((a) => /^image\//i.test(a.tipo))).toBe(false);
      expect(adjuntos.some((a) => a.contentId)).toBe(false);

      const pdf = adjuntos[0];
      expect(pdf.tipo).toMatch(/^application\/pdf/i);
      expect(pdf.codificacion).toMatch(/base64/i);
      expect(pdf.nombre).toMatch(/^recibo-pedido-123\.pdf$/);
      const pdfBytes = Buffer.from(pdf.contenido, 'base64');
      expect(pdfBytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
      const pdfTexto = pdfBytes.toString('latin1');
      expect(pdfTexto).toContain('RECIBO DE PAGO');
      expect(pdfTexto).toContain('Ana P\u00e9rez');
      expect(pdfTexto).toContain('$2.750,00');
      expect(pdfTexto).not.toMatch(/Sucursal/i);
      expect(pdfTexto).not.toContain('Siempre Viva');

      // El logo original sigue dentro del PDF: el XObject de 128x128 usa como
      // stream exactamente los fragmentos IDAT del PNG oficial.
      const logoOriginal = Buffer.from(LOGO_RECIBO_BASE64, 'base64');
      expect(
        crypto.createHash('sha256').update(logoOriginal).digest('hex')
      ).toBe(
        '2c8b16cdacd802be32b9b30850eefb3582438337614730299a1680d7b911da31'
      );
      const imagen = imagenDelPdf(pdfBytes);
      expect(imagen).not.toBeNull();
      expect(imagen.ancho).toBe(128);
      expect(imagen.alto).toBe(128);
      expect(imagen.conPredictor).toBe(true);
      expect(imagen.longitud).toBe(idatDelLogo().length);
      expect(imagen.datos).toEqual(idatDelLogo());
      await new Promise((resolve) => smtp.server.close(resolve));
    });

    test('un cupón liberado se aclara y no descuenta del total', async () => {
      smtp = await crearServidorSmtp();
      config.mail.transport = 'smtp';
      config.mail.host = '127.0.0.1';
      config.mail.port = smtp.port;
      reiniciarTransporte();

      const pedido = pedidoDePrueba();
      pedido.cupon.estado = 'LIBERADO';
      pedido.cupon.descuentoAplicado = 0;
      pedido.total = 3250;

      await enviarEmailReciboPedido({
        destinatario: 'ana@test.com',
        pedido,
      });

      const cuerpo = cuerpoLegible(smtp.recibidos[0].mensaje);
      expect(cuerpo).toContain('El cupón no se aplicó');
      expect(cuerpo).toContain('Total pagado: $3.250,00');
      await new Promise((resolve) => smtp.server.close(resolve));
    });

    test('un snapshot de personalización no JSON degrada sin lanzar', async () => {
      smtp = await crearServidorSmtp();
      config.mail.transport = 'smtp';
      config.mail.host = '127.0.0.1';
      config.mail.port = smtp.port;
      reiniciarTransporte();

      const pedido = pedidoDePrueba();
      pedido.items[0].observacion = 'snapshot legacy';

      await expect(
        enviarEmailReciboPedido({
          destinatario: 'ana@test.com',
          pedido,
        })
      ).resolves.toEqual({ enviado: true });
      expect(cuerpoLegible(smtp.recibidos[0].mensaje)).toContain(
        'Personalización: snapshot legacy'
      );
      await new Promise((resolve) => smtp.server.close(resolve));
    });
  });
});
