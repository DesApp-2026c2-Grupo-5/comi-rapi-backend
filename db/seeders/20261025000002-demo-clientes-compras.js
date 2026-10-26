'use strict';

// Clientes demo que compran en volumen + reseñas variadas del catálogo.
//
// Objetivo doble:
//   1. Dar volumen real a las estadísticas del admin (reportes de los últimos
//      30 días) y del superadmin (totales históricos + serie de 30 días).
//   2. Poblar la ficha de producto con varias reseñas de clientes distintos,
//      sin que todos reseñen todo.
//
// Los clientes son los personajes del catálogo demo (Sunny, Nephis, Cassie,
// Mordret, ...). Van sin apellido: la lista de clientes muestra
// `nombre + apellido`, así que un apellido inventado los mostraría como
// "Sunny Demo". Usan `@demo.com` y no `@test.com` a propósito:
// `scripts/limpiar-pedidos-de-prueba.js` borra los pedidos de cualquier
// `@test.com` y se llevaría puesto este volumen.
//
// Pedidos: 4 por cliente (172 en total), repartidos en los últimos 10 días para
// que entren en el rango por defecto de los reportes (30 días) y muevan la
// serie diaria. Alrededor del 5 % salen `cancelado`. Cada pedido lleva 5
// productos distintos con 1-3 unidades, así que además del total mueve el
// ranking de más vendidos.
//
// Reseñas: cada producto recibe entre 5 y 9 reseñas de clientes distintos, y
// cada cliente reseña sólo una parte del catálogo. El comentario y la nota
// salen de una bolsa por familia de producto, ordenada de forma intercalada,
// para que ningún producto quede con todas las notas iguales. Todos los
// orígenes son pedidos `entregado` reales que incluyen el producto.
//
// Idempotente: borra las reseñas de los clientes demo y los pedidos con
// observacion = 'SEED-RESENA' antes de recrearlos. Los usuarios se reutilizan
// por email (upsert), así los ids no cambian entre corridas.

const argon2 = require('argon2');

const MARCA = 'SEED-RESENA';
const MIN = 60 * 1000;
const DIA = 24 * 60 * MIN;

const PEDIDOS_POR_CLIENTE = 4;
const DIAS_VENTANA = 10;
const PRODUCTOS_POR_PEDIDO = 5;

const NOMBRES = [
  'Sunny',
  'Nephis',
  'Cassie',
  'Mordret',
  'Athenea',
  'Kai',
  'Rain',
  'Morgan',
  'Tyris',
  'Klein',
  'Audrey',
  'Fors',
  'Xio',
  'Alger',
  'Leonard',
  'Julien',
  'Ruri',
  'Valdrova',
  'Nia',
  'Sitri',
  'Ravie',
  'Elencia',
  'Elaina',
  'Xinci',
  'Rachel',
  'Hajin',
  'Nayun',
  'Suho',
  'Jean',
  'Elizabeth',
  'Elis',
  'Runoa',
  'Weiss',
  'Cynthia',
  'Lynokis',
  'Renzo',
  'Elodie',
  'Helena',
  'Frondier',
  'Azier',
  'Ellen',
  'Lia',
  'Altelicia',
];

const CLIENTES = NOMBRES.map((nombre, indice) => ({
  nombre,
  apellido: null,
  email: `${nombre.toLowerCase()}@demo.com`,
  telefono: `11-5555-${1101 + indice}`,
}));

/**
 * Direcciones de entrega de los pedidos demo, una por sucursal.
 *
 * Son snapshots (columnas sueltas en `Pedidos`), no filas de `Direcciones`: no
 * hace falta geocodificarlas porque el seeder no pasa por el checkout. Están
 * cerca de cada sucursal para que los pedidos sean coherentes si alguien los
 * abre en el detalle.
 */
const DIRECCIONES = {
  'Sucursal Oeste': {
    calle: 'Av. Rivadavia',
    altura: 22000,
    ciudad: 'Morón',
    codigoPostal: '1708',
    referencia: 'Pedido de demostración',
    latitud: -34.6534,
    longitud: -58.619,
  },
  'Sucursal Palermo': {
    calle: 'Av. Santa Fe',
    altura: 3700,
    ciudad: 'Palermo',
    codigoPostal: '1425',
    referencia: 'Pedido de demostración',
    latitud: -34.5885,
    longitud: -58.41,
  },
  'Sucursal Vergara': {
    calle: 'Av. Vergara',
    altura: 2500,
    ciudad: 'Hurlingham',
    codigoPostal: '1688',
    referencia: 'Pedido de demostración',
    latitud: -34.63,
    longitud: -58.64,
  },
};

const DIRECCION_GENERICA = {
  calle: 'Av. Santa Fe',
  altura: 3253,
  ciudad: 'Palermo',
  codigoPostal: '1425',
  referencia: 'Pedido de demostración',
  latitud: -34.5885,
  longitud: -58.41,
};

/**
 * Comentarios por familia de producto. Cada entrada trae su nota para que la
 * puntuación acompañe al texto (un 5 no puede decir que llegó frío).
 *
 * Están escritos en orden intercalado (5, 4, 5, 3, ...) y cada producto toma
 * una ventana de la bolsa: así las notas quedan mezcladas y el promedio de cada
 * producto varía. No se nombran ingredientes que sólo tenga un producto de la
 * familia, para que el comentario sirva en cualquiera de ellos.
 */
const COMENTARIOS = {
  Hamburguesas: [
    {
      nota: 5,
      texto:
        'La carne estaba jugosa y en su punto. Se nota que no es una medallita congelada.',
    },
    {
      nota: 4,
      texto: 'Muy rica, aunque el pan se desarmó un poco hacia el final.',
    },
    {
      nota: 5,
      texto:
        'Llegó caliente y bien armada. Para pedir por delivery está muy bien.',
    },
    {
      nota: 3,
      texto: 'Estaba correcta, pero me pareció chica para el precio.',
    },
    {
      nota: 5,
      texto: 'El punto de la carne es perfecto y el queso se siente de verdad.',
    },
    {
      nota: 4,
      texto:
        'Buen sabor, aunque le faltó un poco de salsa. La volvería a pedir igual.',
    },
    {
      nota: 4,
      texto:
        'La porción llena y el sabor es parejo. El pan podría ser más fresco.',
    },
    {
      nota: 3,
      texto:
        'Rica, pero llegó tibia. El reparto tardó más de lo que decía la app.',
    },
    {
      nota: 5,
      texto: 'Una de las mejores que probé en la zona. Se nota la diferencia.',
    },
    {
      nota: 2,
      texto:
        'Me tocó una carne bastante seca y pasada. No era lo que esperaba.',
    },
    {
      nota: 5,
      texto: 'El pan estaba tierno y la carne bien condimentada. Muy completa.',
    },
    {
      nota: 5,
      texto:
        'Se nota la diferencia con otras hamburguesas de delivery. Volvería a pedir.',
    },
  ],
  Pizzas: [
    {
      nota: 5,
      texto: 'La masa quedó crocante en los bordes y el queso bien estirado.',
    },
    { nota: 4, texto: 'Muy rica, aunque llegó un poco fría por la demora.' },
    {
      nota: 5,
      texto: 'El punto de horno es perfecto. Se nota que es masa artesanal.',
    },
    { nota: 3, texto: 'Rica, pero con poca muzzarella para lo que cuesta.' },
    {
      nota: 5,
      texto: 'Ideal para compartir. La porción rinde bien entre dos.',
    },
    { nota: 4, texto: 'Buen sabor, aunque el centro vino un poco blando.' },
    {
      nota: 4,
      texto: 'Llegó caliente y bien cortada. Le faltó un toque de orégano.',
    },
    {
      nota: 3,
      texto: 'Correcta, sin más. El precio me pareció alto para el tamaño.',
    },
    { nota: 5, texto: 'La base aguanta bien el delivery, no se aplastó.' },
    {
      nota: 2,
      texto:
        'Llegó toda pegada a la caja y el queso se había ido a un costado.',
    },
    {
      nota: 5,
      texto:
        'Muy buena relación precio-calidad. La pediría de nuevo sin dudar.',
    },
    {
      nota: 5,
      texto: 'Se mantuvo caliente hasta que llegó y el queso seguía fundido.',
    },
  ],
  Combos: [
    {
      nota: 5,
      texto: 'Rinde muy bien y sale más barato que pedir todo suelto.',
    },
    { nota: 4, texto: 'Las papas llegaron calientes, la bebida no tanto.' },
    { nota: 5, texto: 'Ideal para una cena completa sin complicarse.' },
    {
      nota: 3,
      texto: 'Está bien, aunque la porción de papas me pareció chica.',
    },
    { nota: 5, texto: 'Pedimos para compartir y alcanzó justo. Buena opción.' },
    {
      nota: 4,
      texto:
        'Buena relación precio-calidad, aunque la bebida podría ser más grande.',
    },
    {
      nota: 4,
      texto: 'Llegó completo y bien embalado. La hamburguesa un poco fría.',
    },
    {
      nota: 3,
      texto: 'Algunas cosas llegaron tibias. El sabor igual estaba bien.',
    },
    { nota: 5, texto: 'Volvería a pedirlo. Es la opción que más conviene.' },
    {
      nota: 2,
      texto:
        'Faltaba uno de los productos. Lo resolvieron, pero tardó y se enfrió todo.',
    },
    {
      nota: 5,
      texto: 'Muy completo y bien pensado para compartir. Lo pediría otra vez.',
    },
    {
      nota: 5,
      texto: 'Las porciones del combo están bien balanceadas, no sobra nada.',
    },
  ],
  Papas: [
    {
      nota: 5,
      texto: 'Crocantes por fuera y tiernas por dentro. Bien logradas.',
    },
    { nota: 4, texto: 'Muy ricas, aunque había más papas chicas que grandes.' },
    {
      nota: 5,
      texto: 'La porción es enorme, alcanza para compartir entre tres.',
    },
    { nota: 3, texto: 'Ricas, pero un poco aceitosas para mi gusto.' },
    {
      nota: 5,
      texto: 'Llegaron crocantes, mejor de lo que esperaba para delivery.',
    },
    { nota: 4, texto: 'Buena cantidad y bien condimentadas.' },
    { nota: 4, texto: 'Buen sabor, aunque se enfriaron rápido.' },
    { nota: 3, texto: 'Correctas. Me parecieron caras para lo que traen.' },
    {
      nota: 5,
      texto: 'Las pedí para acompañar y terminaron siendo lo mejor del pedido.',
    },
    {
      nota: 2,
      texto: 'La mitad de la porción eran restos chicos. No da para el precio.',
    },
    { nota: 5, texto: 'Bien crocantes y con la sal justa. Muy ricas.' },
    {
      nota: 5,
      texto: 'Se mantuvieron crocantes hasta el final, algo raro en delivery.',
    },
  ],
  Chocolate: [
    {
      nota: 5,
      texto: 'El centro fundido es lo mejor. Se corta con la cuchara.',
    },
    { nota: 4, texto: 'Dulce sin empalagar, buen cierre para el pedido.' },
    { nota: 5, texto: 'El contraste de frío y calor es lo que lo hace.' },
    {
      nota: 3,
      texto: 'Rico, pero la porción me pareció chica para el precio.',
    },
    { nota: 5, texto: 'Se nota que es casero y no un postre industrial.' },
    {
      nota: 4,
      texto: 'Muy bueno, aunque llegó un poco desarmado del transporte.',
    },
    {
      nota: 4,
      texto: 'Bien de chocolate, aunque me hubiese gustado más salsa.',
    },
    { nota: 3, texto: 'Estaba rico pero demasiado dulce para mi gusto.' },
    { nota: 5, texto: 'Lo pediría de nuevo solo por este postre.' },
    {
      nota: 2,
      texto:
        'Llegó derretido y aplastado. El sabor estaba, pero la presentación no.',
    },
    { nota: 5, texto: 'Muy rico y con la porción justa. Lo volvería a pedir.' },
    {
      nota: 5,
      texto: 'El chocolate se siente de verdad, no es sabor artificial.',
    },
  ],
  Cheesecake: [
    {
      nota: 5,
      texto: 'Cremoso y con el punto justo de dulce. Muy bien logrado.',
    },
    { nota: 4, texto: 'Rico, aunque la base estaba un poco blanda.' },
    { nota: 5, texto: 'La salsa de frutos rojos le da un contraste muy rico.' },
    { nota: 3, texto: 'Buen sabor, pero la porción es chica para compartir.' },
    { nota: 5, texto: 'Se siente el queso, no es solo crema. Me gustó mucho.' },
    {
      nota: 4,
      texto: 'Llegó bien frío y entero. Le faltó un poco más de salsa.',
    },
    {
      nota: 4,
      texto:
        'Textura densa como corresponde. A mí me gustó, a mi hermano no tanto.',
    },
    { nota: 3, texto: 'Correcto, aunque me pareció caro para el tamaño.' },
    { nota: 5, texto: 'Uno de los mejores que pedí por delivery.' },
    {
      nota: 2,
      texto: 'Llegó con la base deshecha y tibio. No lo volvería a pedir.',
    },
    { nota: 5, texto: 'Muy bien logrado, se nota que está hecho en casa.' },
    { nota: 5, texto: 'La porción alcanza para dos si ya comiste. Muy rico.' },
  ],
  Rogel: [
    { nota: 5, texto: 'El merengue estaba perfecto, no demasiado dulce.' },
    {
      nota: 4,
      texto: 'Muy rico, aunque el dulce de leche se sentía un poco pesado.',
    },
    {
      nota: 5,
      texto:
        'Las capas de masa se mantuvieron crocantes, algo difícil en delivery.',
    },
    { nota: 3, texto: 'Rico, pero empalaga rápido. Mejor para compartir.' },
    { nota: 5, texto: 'Se nota que es casero. La porción es generosa.' },
    {
      nota: 4,
      texto: 'Buen sabor, aunque llegó un poco aplastado por el envoltorio.',
    },
    { nota: 4, texto: 'El merengue se mantuvo firme. Bien por eso.' },
    {
      nota: 3,
      texto: 'Estaba rico, pero para mi gusto tenía demasiado dulce de leche.',
    },
    { nota: 5, texto: 'Pediría dos la próxima vez. Muy bueno.' },
    { nota: 2, texto: 'Llegó todo derretido y pegado al papel. Una lástima.' },
    {
      nota: 5,
      texto:
        'El equilibrio entre masa, dulce de leche y merengue está muy bien.',
    },
    { nota: 5, texto: 'Muy rico. Lo pediría para una merienda con mate.' },
  ],
  Dulce: [
    {
      nota: 5,
      texto: 'La combinación dulce funciona mejor de lo que pensaba.',
    },
    {
      nota: 4,
      texto: 'Rica, aunque al final empalaga un poco. Para compartir.',
    },
    { nota: 5, texto: 'Muy original. No hay otra cosa parecida en la carta.' },
    {
      nota: 3,
      texto: 'Está bien, pero no es para cualquiera. A mí me resultó pesada.',
    },
    { nota: 5, texto: 'El pan dulce con el relleno combina perfecto.' },
    {
      nota: 4,
      texto: 'Buena idea y buena ejecución, aunque la porción es grande.',
    },
    {
      nota: 4,
      texto:
        'Me sorprendió para bien. No la pediría seguido, pero vale la pena.',
    },
    {
      nota: 3,
      texto: 'Demasiado dulce para mi gusto, aunque la textura estaba bien.',
    },
    { nota: 5, texto: 'La pedí por curiosidad y me encantó. Muy lograda.' },
    {
      nota: 2,
      texto: 'No era lo que esperaba. La textura estaba pesada y muy dulce.',
    },
    {
      nota: 5,
      texto: 'Muy rica y original. Vale la pena probarla al menos una vez.',
    },
    {
      nota: 5,
      texto: 'El relleno estaba bien logrado y no empalagó tanto como pensaba.',
    },
  ],
  Cafe: [
    {
      nota: 5,
      texto: 'El café se siente, no es solo azúcar. Muy bien balanceado.',
    },
    { nota: 4, texto: 'Rico, aunque la crema batida llegó un poco caída.' },
    { nota: 5, texto: 'El caramelo y la crema hacen que valga la pena.' },
    { nota: 3, texto: 'Estaba rico pero muy dulce para mi gusto.' },
    { nota: 5, texto: 'Tiene el punto justo de canela, no empalaga.' },
    {
      nota: 4,
      texto: 'Buen sabor, aunque llegó tibio y se esperaba más frío.',
    },
    { nota: 4, texto: 'Cremoso y bien servido. El tamaño es correcto.' },
    { nota: 3, texto: 'Me pareció chico para el precio.' },
    {
      nota: 5,
      texto: 'Ideal para la tarde. Mejor que el de las cadenas grandes.',
    },
    {
      nota: 2,
      texto: 'Llegó derramado y sin la crema. No lo volvería a pedir.',
    },
    {
      nota: 5,
      texto: 'Muy rico y bien frío. El café se siente en cada sorbo.',
    },
    { nota: 5, texto: 'La presentación llegó intacta y se veía muy bien.' },
  ],
  Refrescos: [
    { nota: 5, texto: 'Llegó bien fría, tal como la pedí.' },
    {
      nota: 4,
      texto: 'Rica, aunque el vaso vino transpirado y mojó la bolsa.',
    },
    { nota: 5, texto: 'Refresca de verdad y no es solo color. Muy rico.' },
    {
      nota: 3,
      texto: 'Estaba rica, pero se sentía mucho el hielo y poco sabor.',
    },
    { nota: 5, texto: 'La frutilla real se nota. Se agradece.' },
    {
      nota: 4,
      texto: 'Buena, aunque para el precio esperaba un vaso más grande.',
    },
    {
      nota: 4,
      texto: 'Refrescante y no demasiado dulce. La volvería a pedir.',
    },
    { nota: 3, texto: 'Llegó sin frío. Se ve que estuvo un rato esperando.' },
    { nota: 5, texto: 'Ideal para acompañar la comida. Bien cerrada la tapa.' },
    { nota: 2, texto: 'El vaso llegó medio vacío y derramado. No da.' },
    { nota: 5, texto: 'Muy rica y bien fría. Ideal para este calor.' },
    { nota: 5, texto: 'El sabor es natural y se nota. La volvería a pedir.' },
  ],
  Generico: [
    { nota: 5, texto: 'Muy bueno, cumplió con lo que esperaba.' },
    {
      nota: 4,
      texto: 'Rico, aunque la porción podría ser un poco más generosa.',
    },
    { nota: 5, texto: 'Llegó en tiempo y en buen estado.' },
    { nota: 3, texto: 'Correcto, sin más.' },
    { nota: 5, texto: 'Lo volvería a pedir sin dudar.' },
    { nota: 4, texto: 'Buen sabor, aunque llegó un poco frío.' },
    { nota: 4, texto: 'Relación precio-calidad correcta.' },
    { nota: 3, texto: 'Me pareció caro para lo que es.' },
    { nota: 5, texto: 'Me sorprendió para bien.' },
    { nota: 2, texto: 'No era lo que esperaba.' },
    {
      nota: 5,
      texto: 'Muy buena experiencia en general. Repetiría el pedido.',
    },
    { nota: 5, texto: 'Llegó antes de lo estimado y en perfecto estado.' },
  ],
};

/**
 * Familia de comentarios. "Bebidas" y "Postres" son categorías muy amplias
 * (café, gaseosa, cheesecake, rogel), así que se abren por producto para que el
 * comentario no hable de algo que el producto no tiene.
 */
const familiaDe = (producto) => {
  const nombre = producto.nombre.toLowerCase();
  if (producto.categoria === 'Bebidas') {
    return /frappuccino|latte|café/.test(nombre) ? 'Cafe' : 'Refrescos';
  }
  if (producto.categoria === 'Postres') {
    if (nombre.includes('rogel')) return 'Rogel';
    if (nombre.includes('cheesecake')) return 'Cheesecake';
    if (nombre.includes('hamburguesa')) return 'Dulce';
    return 'Chocolate';
  }
  return COMENTARIOS[producto.categoria] ? producto.categoria : 'Generico';
};

/** PRNG lineal determinista: mismas reseñas en cada corrida. */
const generador = (semilla) => {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return estado / 4294967296;
  };
};

const mezclar = (lista, semilla) => {
  const copia = [...lista];
  const aleatorio = generador(semilla);
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(aleatorio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
};

const ESTADOS_ENTREGADO = [
  { nombre: 'pendiente', minutos: 0 },
  { nombre: 'confirmado', minutos: 2 },
  { nombre: 'en_preparacion', minutos: 5 },
  { nombre: 'listo_para_entregar', minutos: 20 },
  { nombre: 'en_camino', minutos: 30 },
  { nombre: 'entregado', minutos: 50 },
];

const ESTADOS_CANCELADO = [
  { nombre: 'pendiente', minutos: 0 },
  { nombre: 'confirmado', minutos: 3 },
  { nombre: 'cancelado', minutos: 12 },
];

async function upsertCliente(queryInterface, cliente, password) {
  const [filas] = await queryInterface.sequelize.query(
    `INSERT INTO "Usuarios"
       ("nombre","apellido","email","password","telefono","fechaNacimiento",
        "rol","activo","createdAt","updatedAt")
     VALUES
       (:nombre,:apellido,:email,:password,:telefono,NULL,'CLIENTE',TRUE,NOW(),NOW())
     ON CONFLICT (email) DO UPDATE SET
       "nombre" = EXCLUDED."nombre",
       "apellido" = EXCLUDED."apellido",
       "password" = EXCLUDED."password",
       "telefono" = EXCLUDED."telefono",
       "rol" = 'CLIENTE',
       "activo" = TRUE,
       "updatedAt" = NOW()
     RETURNING id`,
    { replacements: { ...cliente, password } }
  );
  return filas[0].id;
}

async function borrarSeedPrevio(queryInterface, emails) {
  const [
    pedidos,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "Pedidos" WHERE observacion = :marca`,
    { replacements: { marca: MARCA } }
  );
  const ids = pedidos.map((p) => p.id);

  // Las reseñas de los clientes demo se borran siempre (no sólo las de los
  // pedidos marcados): si una corrida anterior reseñó sobre otro pedido, la
  // nueva tiene que reemplazarla sin chocar con el UNIQUE.
  await queryInterface.sequelize.query(
    `DELETE FROM "Resenas"
      WHERE "usuarioId" IN (SELECT id FROM "Usuarios" WHERE email IN (:emails))`,
    { replacements: { emails } }
  );

  if (!ids.length) return;
  const lista = ids.join(',');
  await queryInterface.sequelize.query(
    `DELETE FROM "Resenas" WHERE "pedidoId" IN (${lista})`
  );
  await queryInterface.sequelize.query(
    `DELETE FROM "PedidoPromociones" WHERE "pedidoId" IN (${lista})`
  );
  await queryInterface.sequelize.query(
    `DELETE FROM "PedidoEstadoHistorials" WHERE "pedidoId" IN (${lista})`
  );
  await queryInterface.sequelize.query(
    `DELETE FROM "PedidoItems" WHERE "pedidoId" IN (${lista})`
  );
  await queryInterface.sequelize.query(
    `DELETE FROM "Pedidos" WHERE id IN (${lista})`
  );
}

async function crearPedido(queryInterface, datos) {
  const [filas] = await queryInterface.sequelize.query(
    `INSERT INTO "Pedidos"
       ("usuarioId","sucursalId","fechaHora","estadoId","costoEnvio","total",
        "medioPago","observacion","calle","altura","ciudad","codigoPostal",
        "referencia","latitud","longitud","etaMinutos","etaCalculadoEn",
        "horaEstimadaLlegada","createdAt","updatedAt")
     VALUES
       (:usuarioId,:sucursalId,:fechaHora,:estadoId,:costoEnvio,:total,
        :medioPago,:observacion,:calle,:altura,:ciudad,:codigoPostal,
        :referencia,:latitud,:longitud,NULL,NULL,NULL,:fechaHora,:fechaHora)
     RETURNING id`,
    {
      replacements: {
        usuarioId: datos.usuarioId,
        sucursalId: datos.sucursalId,
        fechaHora: datos.fechaHora,
        estadoId: datos.estadoId,
        costoEnvio: datos.costoEnvio,
        total: datos.total,
        medioPago: datos.medioPago,
        observacion: MARCA,
        calle: datos.direccion.calle,
        altura: datos.direccion.altura,
        ciudad: datos.direccion.ciudad,
        codigoPostal: datos.direccion.codigoPostal,
        referencia: datos.direccion.referencia,
        latitud: datos.direccion.latitud,
        longitud: datos.direccion.longitud,
      },
    }
  );
  return filas[0].id;
}

module.exports = {
  up: async (queryInterface) => {
    const emails = CLIENTES.map((cliente) => cliente.email);

    // Datos que ya tienen que existir (seeders previos).
    const [sucursales] = await queryInterface.sequelize.query(
      `SELECT id, nombre FROM "Sucursales" WHERE activa = TRUE ORDER BY id`
    );
    if (!sucursales.length) {
      throw new Error(
        'Seeder de clientes demo: no hay sucursales activas. Ejecutar los seeders previos.'
      );
    }

    const [estados] = await queryInterface.sequelize.query(
      `SELECT id, nombre FROM "EstadoPedidos" WHERE nombre IN
        ('entregado','cancelado','pendiente','confirmado','en_preparacion',
         'listo_para_entregar','en_camino')`
    );
    const idEstado = new Map(estados.map((e) => [e.nombre, e.id]));
    for (const nombre of [
      'entregado',
      'cancelado',
      'pendiente',
      'confirmado',
      'en_preparacion',
      'listo_para_entregar',
      'en_camino',
    ]) {
      if (!idEstado.has(nombre)) {
        throw new Error(
          `Seeder de clientes demo: falta el estado "${nombre}". Ejecutar 20260915000001.`
        );
      }
    }

    // Sólo productos reales del catálogo: los de prueba que se hayan creado a
    // mano tienen imagen de placeholder y no deberían recibir reseñas.
    const [productos] = await queryInterface.sequelize.query(
      `SELECT p.id, p.nombre, p.precio, p.tipo, c.nombre AS categoria
         FROM "Productos" p
         JOIN "Categorias" c ON c.id = p."categoriaId"
        WHERE p.activo = TRUE
          AND (p.imagen IS NULL OR p.imagen NOT LIKE '%via.placeholder.com%')
        ORDER BY p.id`
    );
    if (!productos.length) {
      throw new Error(
        'Seeder de clientes demo: no hay productos activos. Ejecutar los seeders previos.'
      );
    }
    productos.forEach((producto) => {
      producto.precio = Number(producto.precio);
    });

    // Recién con todo resuelto se limpia la corrida anterior.
    await borrarSeedPrevio(queryInterface, emails);

    const password = await argon2.hash('123456', { timeCost: 2 });
    const clientes = [];
    for (const cliente of CLIENTES) {
      const id = await upsertCliente(queryInterface, cliente, password);
      clientes.push({ ...cliente, id });
    }

    const ahora = Date.now();
    // productoId -> [{ clienteId, pedidoId, fechaHora }] de pedidos entregados.
    const elegiblesPorProducto = new Map();

    for (let c = 0; c < clientes.length; c += 1) {
      const cliente = clientes[c];

      for (let i = 0; i < PEDIDOS_POR_CLIENTE; i += 1) {
        const sucursal = sucursales[(i + c) % sucursales.length];
        // ~5 % de pedidos cancelados, repartidos entre todos los clientes.
        const esCancelado = (c * PEDIDOS_POR_CLIENTE + i) % 19 === 0;
        // 2 a 3,5 horas atrás como mínimo: el historial de un entregado suma
        // 50 minutos y no queremos estados en el futuro.
        const minutosAtras = 120 + ((i * 7 + c) % 90);
        const fechaHora = new Date(
          ahora - ((i + c) % DIAS_VENTANA) * DIA - minutosAtras * MIN
        );

        const cantidadItems = Math.min(PRODUCTOS_POR_PEDIDO, productos.length);
        const inicio = (c * PRODUCTOS_POR_PEDIDO + i * 3) % productos.length;
        const items = [];
        for (let k = 0; k < cantidadItems; k += 1) {
          const producto = productos[(inicio + k) % productos.length];
          const cantidad = 1 + ((i + k) % 3);
          items.push({
            productoId: producto.id,
            nombreProducto: producto.nombre,
            precioUnitario: producto.precio,
            cantidad,
            subtotal: producto.precio * cantidad,
          });
        }

        const costoEnvio = (i + c) % 2 === 0 ? 0 : 500;
        const total =
          items.reduce((acc, item) => acc + item.subtotal, 0) + costoEnvio;

        const pedidoId = await crearPedido(queryInterface, {
          usuarioId: cliente.id,
          sucursalId: sucursal.id,
          fechaHora,
          estadoId: esCancelado
            ? idEstado.get('cancelado')
            : idEstado.get('entregado'),
          costoEnvio,
          total,
          medioPago: (i + c) % 2 === 0 ? 'MERCADO_PAGO' : 'TARJETA',
          direccion: DIRECCIONES[sucursal.nombre] || DIRECCION_GENERICA,
        });

        await queryInterface.bulkInsert(
          'PedidoItems',
          items.map((item) => ({
            ...item,
            pedidoId,
            observacion: null,
            createdAt: fechaHora,
            updatedAt: fechaHora,
          }))
        );

        const historial = esCancelado ? ESTADOS_CANCELADO : ESTADOS_ENTREGADO;
        await queryInterface.bulkInsert(
          'PedidoEstadoHistorials',
          historial.map((paso) => ({
            pedidoId,
            estadoId: idEstado.get(paso.nombre),
            usuarioId: cliente.id,
            fechaHora: new Date(fechaHora.getTime() + paso.minutos * MIN),
            observacion: MARCA,
            createdAt: fechaHora,
            updatedAt: fechaHora,
          }))
        );

        if (!esCancelado) {
          for (const item of items) {
            let lista = elegiblesPorProducto.get(item.productoId);
            if (!lista) {
              lista = [];
              elegiblesPorProducto.set(item.productoId, lista);
            }
            // Un origen por cliente y producto: alcanza para habilitar la
            // reseña y evita duplicados en el UNIQUE (usuarioId, productoId).
            if (!lista.some((elegible) => elegible.clienteId === cliente.id)) {
              lista.push({ clienteId: cliente.id, pedidoId, fechaHora });
            }
          }
        }
      }
    }

    // Reseñas: 5 a 9 clientes distintos por producto, elegidos entre quienes
    // tienen un pedido entregado con ese producto. El comentario sale de la
    // bolsa de la familia, en ventana corrida por producto para variar notas.
    const resenas = [];
    for (const producto of productos) {
      const elegibles = elegiblesPorProducto.get(producto.id) || [];
      if (!elegibles.length) continue;

      const bolsa = COMENTARIOS[familiaDe(producto)] || COMENTARIOS.Generico;
      const cantidad = Math.min(
        5 + ((producto.id * 7) % 5),
        elegibles.length,
        bolsa.length
      );
      const candidatos = mezclar(elegibles, producto.id * 31 + 7).slice(
        0,
        cantidad
      );
      // 7 es coprimo con el largo de las bolsas (12), así cada producto arranca
      // en una posición distinta y no se repiten las mismas notas.
      const inicio = (producto.id * 7) % bolsa.length;

      for (let k = 0; k < cantidad; k += 1) {
        const { nota, texto } = bolsa[(inicio + k) % bolsa.length];
        const origen = candidatos[k];
        const creadaEn = new Date(
          Math.min(
            ahora - MIN,
            origen.fechaHora.getTime() + (90 + k * 43) * MIN
          )
        );
        resenas.push({
          usuarioId: origen.clienteId,
          productoId: producto.id,
          pedidoId: origen.pedidoId,
          puntuacion: nota,
          comentario: texto,
          createdAt: creadaEn,
          updatedAt: creadaEn,
        });
      }
    }

    // Ningún cliente demo queda sin reseñar: si el azar no lo eligió, se le
    // asigna un producto que haya comprado y que todavía tenga lugar.
    const yaResenan = new Set(resenas.map((resena) => resena.usuarioId));
    for (const cliente of clientes) {
      if (yaResenan.has(cliente.id)) continue;

      for (const producto of productos) {
        const elegibles = elegiblesPorProducto.get(producto.id) || [];
        const origen = elegibles.find(
          (elegible) => elegible.clienteId === cliente.id
        );
        if (!origen) continue;

        const bolsa = COMENTARIOS[familiaDe(producto)] || COMENTARIOS.Generico;
        const usadas = resenas.filter(
          (resena) => resena.productoId === producto.id
        ).length;
        if (usadas >= Math.min(9, bolsa.length)) continue;

        const { nota, texto } = bolsa[
          (producto.id * 7 + usadas) % bolsa.length
        ];
        const creadaEn = new Date(
          Math.min(
            ahora - MIN,
            origen.fechaHora.getTime() + (90 + usadas * 43) * MIN
          )
        );
        resenas.push({
          usuarioId: cliente.id,
          productoId: producto.id,
          pedidoId: origen.pedidoId,
          puntuacion: nota,
          comentario: texto,
          createdAt: creadaEn,
          updatedAt: creadaEn,
        });
        yaResenan.add(cliente.id);
        break;
      }
    }

    if (resenas.length) {
      await queryInterface.bulkInsert('Resenas', resenas);
    }

    const cancelados = (clientes.length * PEDIDOS_POR_CLIENTE) / 19;
    console.log(
      `Clientes demo: ${clientes.length} clientes, ${
        clientes.length * PEDIDOS_POR_CLIENTE
      } pedidos (~${Math.round(cancelados)} cancelados) y ${
        resenas.length
      } reseñas en ${productos.length} productos.`
    );
  },

  down: async (queryInterface) => {
    const emails = CLIENTES.map((cliente) => cliente.email);
    await borrarSeedPrevio(queryInterface, emails);
    await queryInterface.sequelize.query(
      `DELETE FROM "Usuarios" WHERE email IN (:emails)`,
      { replacements: { emails } }
    );
  },
};
