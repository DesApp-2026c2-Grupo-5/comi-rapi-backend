/**
 * Verificación end-to-end del canal de tiempo real, a nivel protocolo.
 *
 * A diferencia de `lib/realtime/conexion.test.js`, que levanta su propio
 * servidor en un puerto efímero, esto habla contra el backend de desarrollo
 * como lo haría un navegador real: cookie de sesión, CSRF y sockets de verdad.
 *
 * Requisitos: backend levantado (`npm start` o `npm run dev`).
 * Uso: `npm run test:tiempo-real`
 *
 * Fija el contrato que el frontend da por sentado:
 *   1. crear un pedido no notifica a nadie
 *   2. al confirmar el pago, el admin recibe `pedido_actualizado`
 *   3. el aviso llega solo con el pedidoId; los datos se leen por REST
 *   4. un cliente no escucha pedidos ajenos
 *   5. sin sesión no se entra
 *   6. si la base falla, no se emite nada
 *   7. al reconectar hay que volver a suscribirse
 *   8. re-suscribirse de más no duplica el aviso
 */
const {
  asegurarDireccion,
  conectar,
  contar,
  cortarYEsperarReconexion,
  crearReporte,
  esperar,
  limpiarPedidosDePrueba,
  sesionDe,
  suscribir,
} = require('./ayudas');

const sockets = [];

const abrir = async (sid, opciones) => {
  const socket = await conectar(sid, opciones);
  sockets.push(socket);
  return socket;
};

(async () => {
  const reporte = crearReporte(
    'Canal de tiempo real — verificación end-to-end'
  );

  const admin = await sesionDe('admin');
  const cliente = await sesionDe('cliente');
  const cliente2 = await sesionDe('cliente2');
  const productoId = (await cliente.get('/api/productos')).body.data[0].id;
  // `cliente2` no crea pedidos (es el intruso del caso 4), pero se le deja
  // dirección para que los dos usuarios de prueba sean equivalentes.
  const direccion = await asegurarDireccion(cliente);
  await asegurarDireccion(cliente2);

  // El backend espera `direccionEntrega` (no `direccion`) y con `ciudad`, no
  // `localidad`. Es el mismo mapeo que hace `payloadBackend` en el frontend.
  const direccionEntrega = {
    calle: direccion.calle,
    altura: direccion.altura,
    ciudad: direccion.localidad,
    codigoPostal: direccion.codigoPostal,
    referencia: direccion.referencia,
  };

  const nuevoPedido = () =>
    cliente.post('/api/pedidos', {
      productos: [{ productoId, cantidad: 1 }],
      direccionEntrega,
    });

  /** Crea un pedido y lo deja en `confirmado`, que es cuando entra en juego. */
  const pedidoConfirmado = async () => {
    const creada = await nuevoPedido();
    if (creada.status !== 201) {
      throw new Error(`No se pudo crear el pedido: HTTP ${creada.status}`);
    }
    const id = creada.body.data.id;
    const confirmado = await cliente.patch(`/api/pedidos/${id}/estado`, {
      estado: 'confirmado',
      medioPago: 'TARJETA',
    });
    if (confirmado.status !== 200) {
      throw new Error(
        `No se pudo confirmar el pedido: HTTP ${confirmado.status}`
      );
    }
    return id;
  };

  // ------------------------------------------------------------------ caso 1
  reporte.seccion('1. Crear un pedido no notifica a nadie');
  {
    const espia = await abrir(admin.sid);
    const espera = esperar(espia, 'pedido_actualizado');
    const creada = await nuevoPedido();
    reporte.check(
      'el pedido se crea en `pendiente`',
      creada.status === 201,
      `HTTP ${creada.status}`
    );
    reporte.check('no se emitió ningún evento', (await espera) === null);
  }

  // ------------------------------------------------------------------ caso 2
  reporte.seccion('2. El admin se entera al confirmarse el pago');
  {
    const espia = await abrir(admin.sid);
    const creada = await nuevoPedido();
    const pedidoId = creada.body.data.id;

    const leido = (await admin.get(`/api/pedidos/${pedidoId}`)).body.data;
    // El snapshot va en columnas sueltas del pedido, no en un objeto anidado.
    reporte.check(
      'el pedido guarda la dirección de entrega del cliente',
      leido.calle === direccion.calle &&
        Number(leido.altura) === Number(direccion.altura) &&
        leido.ciudad === direccion.localidad &&
        leido.codigoPostal === direccion.codigoPostal,
      `calle=${leido.calle} altura=${leido.altura} ciudad=${leido.ciudad} cp=${leido.codigoPostal}`
    );

    const espera = esperar(espia, 'pedido_actualizado');
    const confirmado = await cliente.patch(`/api/pedidos/${pedidoId}/estado`, {
      estado: 'confirmado',
      medioPago: 'TARJETA',
    });
    reporte.check(
      'el cliente confirma el pago',
      confirmado.status === 200,
      `HTTP ${confirmado.status}`
    );

    const payload = await espera;
    reporte.check(
      'el admin recibe pedido_actualizado',
      !!payload,
      'no llegó nada'
    );
    reporte.check(
      'el payload trae SOLO pedidoId',
      !!payload && Object.keys(payload).join() === 'pedidoId',
      JSON.stringify(payload)
    );
  }

  // ------------------------------------------------------------------ caso 3
  reporte.seccion('3. Varios admins conectados reciben sin suscribirse');
  {
    const espia1 = await abrir(admin.sid);
    const espia2 = await abrir(admin.sid);
    const espera1 = esperar(espia1, 'pedido_actualizado');
    const espera2 = esperar(espia2, 'pedido_actualizado');

    const id = await pedidoConfirmado();
    reporte.check(
      'ambos reciben la confirmación',
      (await espera1)?.pedidoId === id && (await espera2)?.pedidoId === id,
      `${JSON.stringify(await espera1)} / ${JSON.stringify(await espera2)}`
    );
  }

  // ------------------------------------------------------------------ caso 4
  reporte.seccion('4. Un cliente no escucha pedidos ajenos');
  {
    const id = await pedidoConfirmado();
    const dueno = await abrir(cliente.sid);
    const intruso = await abrir(cliente2.sid);

    const ack = await suscribir(intruso, id);
    reporte.check(
      'la suscripción a un pedido ajeno se rechaza',
      ack.success === false && ack.error === 'Acceso denegado',
      JSON.stringify(ack)
    );

    reporte.check(
      'el dueño sí se suscribe a su pedido',
      (await suscribir(dueno, id)).success === true
    );

    const esperaIntruso = esperar(intruso, 'pedido_actualizado');
    const esperaDueno = esperar(dueno, 'pedido_actualizado');
    const cambio = await admin.patch(`/api/pedidos/${id}/estado`, {
      estado: 'en_preparacion',
    });
    reporte.check(
      'el admin avanza el estado',
      cambio.status === 200,
      `HTTP ${cambio.status}`
    );

    reporte.check(
      'el dueño recibe el cambio',
      (await esperaDueno)?.pedidoId === id
    );
    reporte.check('el intruso no recibe nada', (await esperaIntruso) === null);
  }

  // ------------------------------------------------------------------ caso 5
  reporte.seccion('5. REST sigue siendo la fuente de verdad');
  {
    const id = await pedidoConfirmado();
    await admin.patch(`/api/pedidos/${id}/estado`, {
      estado: 'en_preparacion',
    });
    const res = await admin.get(`/api/pedidos/${id}`);
    reporte.check(
      'el estado nuevo se lee por REST',
      res.body.data && res.body.data.estado === 'en_preparacion',
      res.body.data && res.body.data.estado
    );
  }

  // ------------------------------------------------------------------ caso 6
  reporte.seccion('6. Sin sesión no se entra');
  {
    let rechazado = false;
    try {
      await conectar(null);
    } catch (error) {
      rechazado = error.message === 'No autorizado';
    }
    reporte.check('el handshake se rechaza sin cookie de sesión', rechazado);
  }

  // ------------------------------------------------------------------ caso 7
  reporte.seccion('7. Si la base falla, no se emite nada');
  {
    const espia = await abrir(admin.sid);
    const espera = esperar(espia, 'pedido_actualizado');
    const invalido = await cliente.post('/api/pedidos', { productos: [] });
    reporte.check(
      'la petición inválida devuelve 400',
      invalido.status === 400,
      `HTTP ${invalido.status}`
    );
    reporte.check('no se emitió el evento', (await espera) === null);
  }

  // ------------------------------------------------------------------ caso 8
  reporte.seccion(
    '8. Reconexión: las rooms se pierden y hay que re-suscribirse'
  );
  {
    const id = await pedidoConfirmado();
    const dueno = await abrir(cliente.sid, { reconexion: true });
    await suscribir(dueno, id);

    // Control positivo: antes de la caída el aviso llega. Sin esto, el test
    // podría pasar por inercia si el evento no se emitiera nunca.
    const antesDeCaer = esperar(dueno, 'pedido_actualizado');
    await admin.patch(`/api/pedidos/${id}/estado`, {
      estado: 'en_preparacion',
    });
    reporte.check(
      'antes de la caída recibe el evento',
      (await antesDeCaer)?.pedidoId === id
    );

    const { idAnterior, idNuevo } = await cortarYEsperarReconexion(dueno);
    reporte.check(
      'el socketId cambió',
      !!idNuevo && idNuevo !== idAnterior,
      `${idNuevo} vs ${idAnterior}`
    );

    const sinResuscripcion = esperar(dueno, 'pedido_actualizado');
    await admin.patch(`/api/pedidos/${id}/estado`, {
      estado: 'listo_para_entregar',
    });
    reporte.check(
      'sin re-suscribirse deja de recibir',
      (await sinResuscripcion) === null
    );

    await suscribir(dueno, id);
    const conResuscripcion = esperar(dueno, 'pedido_actualizado');
    await admin.patch(`/api/pedidos/${id}/estado`, { estado: 'en_camino' });
    const payload = await conResuscripcion;
    reporte.check(
      're-suscribiéndose vuelve a recibir',
      payload?.pedidoId === id,
      JSON.stringify(payload)
    );

    const estado = (await admin.get(`/api/pedidos/${id}`)).body.data.estado;
    reporte.check(
      'el refetch por REST trae el estado al día',
      estado === 'en_camino',
      estado
    );
  }

  // ------------------------------------------------------------------ caso 9
  reporte.seccion('9. Re-suscribirse de más no duplica el aviso');
  {
    const id = await pedidoConfirmado();
    const dueno = await abrir(cliente.sid);
    await suscribir(dueno, id);
    await suscribir(dueno, id);
    await suscribir(dueno, id);

    const conteo = contar(dueno, 'pedido_actualizado', 2000);
    await admin.patch(`/api/pedidos/${id}/estado`, {
      estado: 'en_preparacion',
    });
    reporte.check('llega exactamente una vez', (await conteo) === 1);
  }

  sockets.forEach((socket) => socket.close());
  limpiarPedidosDePrueba();
  process.exit(reporte.resumen() === 0 ? 0 : 1);
})().catch((error) => {
  sockets.forEach((socket) => socket.close());
  limpiarPedidosDePrueba();
  console.error(`\nError inesperado: ${error.message}`);
  process.exit(1);
});
