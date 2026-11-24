'use strict';

// Las dos emisiones generadas durante las pruebas del proyecto, copiadas de su
// configuración real (emisiones 4 y 5 de la base de desarrollo, 2026-11-24).
// No se simplifica ninguna condición: mismo descuento, tope, vigencia, alcance
// resuelto, segmentación, período, mínimo de unidades, destinatarios, códigos y
// estado de envío.
//
// Se siembra detrás de los seeders de usuarios, catálogo, historial y
// `20261124000001-demo-cliente-elegible-cupones.js`, porque necesita el
// superadministrador, la categoría "Pizzas" y los pedidos entregados ya cargados.
//
// Los IDs de `destinatarios` son los de la emisión original; se usan sólo como
// etiqueta estable para resolver cada cliente por email en la base destino y
// congelar en el snapshot los IDs efectivamente creados. Así el seeder no depende
// de que la numeración de Usuarios coincida con la de desarrollo.
//
// Idempotente: si la emisión ya existe por nombre no la duplica; los cupones se
// insertan sólo por código ausente. El hash del preview ya consumido se copia
// tal cual (el token en claro nunca existió en la base); no se reaviva ningún
// token de un solo uso.
//
// No envía correos: los cupones quedan con `estadoEnvio: ENVIADO`, igual que en
// la emisión original, y con su `enviadoEn` histórico.

const argon2 = require('argon2');

const SUPERADMIN = {
  nombre: 'Superadmin',
  email: 'superadmin@test.com',
  password: '123456',
};
const CATEGORIA = 'Pizzas';
const CLIENTE_EMAIL = 'cliente@test.com';

// Destinatarios reales de las emisiones 4 y 5 (ID original → email estable).
const EMAIL_POR_ID = {
  1: 'cliente@test.com',
  5: 'sunny@demo.com',
  6: 'nephis@demo.com',
  7: 'cassie@demo.com',
  8: 'mordret@demo.com',
  9: 'athenea@demo.com',
  10: 'kai@demo.com',
  11: 'rain@demo.com',
  12: 'morgan@demo.com',
  14: 'klein@demo.com',
  15: 'audrey@demo.com',
  16: 'fors@demo.com',
  17: 'xio@demo.com',
  18: 'alger@demo.com',
  19: 'leonard@demo.com',
  20: 'julien@demo.com',
  21: 'ruri@demo.com',
  22: 'valdrova@demo.com',
  23: 'nia@demo.com',
  24: 'sitri@demo.com',
  25: 'ravie@demo.com',
  26: 'elencia@demo.com',
  27: 'elaina@demo.com',
  28: 'xinci@demo.com',
  29: 'rachel@demo.com',
  31: 'nayun@demo.com',
  32: 'suho@demo.com',
  33: 'jean@demo.com',
  34: 'elizabeth@demo.com',
  35: 'elis@demo.com',
  36: 'runoa@demo.com',
  37: 'weiss@demo.com',
  38: 'cynthia@demo.com',
  39: 'lynokis@demo.com',
  40: 'renzo@demo.com',
  41: 'elodie@demo.com',
  42: 'helena@demo.com',
  43: 'frondier@demo.com',
  44: 'azier@demo.com',
  45: 'ellen@demo.com',
  46: 'lia@demo.com',
};

const EMISIONES = [
  {
    nombre: 'Descuento en pizzas',
    descripcion: null,
    tipoDescuento: 'PORCENTAJE',
    valorDescuento: 15,
    compraMinima: 0,
    descuentoMaximo: 20000,
    fechaInicio: '2026-11-24T20:16:00.000Z',
    fechaFin: '2026-12-06T20:12:00.000Z',
    maxDestinatarios: 50,
    periodoAnalisisDias: 30,
    tiposCliente: ['ACTIVO'],
    minUnidadesCompradas: 2,
    usosPermitidos: 1,
    creadoEn: '2026-11-24T20:14:23.871Z',
    creadaEn: '2026-11-24T20:14:23.881Z',
    actualizadaEn: '2026-11-24T20:16:10.090Z',
    cuponesCreadosEn: '2026-11-24T20:14:24.202Z',
    preview: {
      creadoEn: '2026-11-24T20:14:23.821Z',
      usadoEn: '2026-11-24T20:14:23.821Z',
      expiraEn: '2026-11-24T20:44:15.496Z',
      tokenHash:
        'c5baa2bce769093552fe46032176125032e2178e2ffbfb49860dd614e33d01d1',
    },
    enviadoEn: '2026-11-24T20:16:05.717Z',
    destinatarios: [
      [1, 'CR-MXP7HT7ZWW'],
      [5, 'CR-UF738CYQK3'],
      [7, 'CR-ABU2A9K3FZ'],
      [8, 'CR-G9R5Z82BJH'],
      [9, 'CR-U98UVKWGH4'],
      [10, 'CR-8X9ERNYE7B'],
      [11, 'CR-Z538GNQECV'],
      [12, 'CR-9YWBY3SJ89'],
      [14, 'CR-AWRHPEMTEN'],
      [15, 'CR-8W8R7UCLY3'],
      [16, 'CR-QU9TN2JQS7'],
      [17, 'CR-WFKGEM5BAF'],
      [18, 'CR-EE48XSC563'],
      [19, 'CR-R5GVYMSGUF'],
      [20, 'CR-64FMTHRJHK'],
      [21, 'CR-ZYDLLEE9D3'],
      [22, 'CR-GK4XRNQR46'],
      [24, 'CR-9RZ358XWKQ'],
      [25, 'CR-6NVY9C33DQ'],
      [26, 'CR-DQFDWF8ARJ'],
      [27, 'CR-VJALXWG396'],
      [28, 'CR-N2XCH4F32H'],
      [29, 'CR-BLLJ6H5MFP'],
      [31, 'CR-9R3ZA2BQFT'],
      [32, 'CR-7KR2EUQVAF'],
      [33, 'CR-EH7X9BGJQT'],
      [34, 'CR-9NG255E5MZ'],
      [35, 'CR-6LYCJQTCE3'],
      [36, 'CR-9DJNEMJ6DT'],
      [37, 'CR-V7BY99MEEB'],
      [38, 'CR-8GQHUE5C4V'],
      [39, 'CR-WTAZCA7J7G'],
      [41, 'CR-62QR3BFSUE'],
      [42, 'CR-DCGDZX3L7T'],
      [44, 'CR-9WPQGPGCK6'],
      [45, 'CR-JHVMUJZZ45'],
      [46, 'CR-DT5VWWTFGF'],
    ],
  },
  {
    nombre: '-2000$ en pizzas',
    descripcion: null,
    tipoDescuento: 'MONTO_FIJO',
    valorDescuento: 2000,
    compraMinima: 0,
    descuentoMaximo: 10000,
    fechaInicio: '2026-11-24T20:25:00.000Z',
    fechaFin: '2026-12-06T20:21:00.000Z',
    maxDestinatarios: 50,
    periodoAnalisisDias: 20,
    tiposCliente: ['ACTIVO'],
    minUnidadesCompradas: 1,
    usosPermitidos: 1,
    creadoEn: '2026-11-24T20:23:38.714Z',
    creadaEn: '2026-11-24T20:23:38.720Z',
    actualizadaEn: '2026-11-24T20:25:06.208Z',
    cuponesCreadosEn: '2026-11-24T20:23:39.081Z',
    preview: {
      creadoEn: '2026-11-24T20:23:38.688Z',
      usadoEn: '2026-11-24T20:23:38.688Z',
      expiraEn: '2026-11-24T20:53:28.413Z',
      tokenHash:
        'fcbb74763466d1abd4229a57982d147e988fcf91ad2471aa18abe8b6e48d667b',
    },
    enviadoEn: '2026-11-24T20:25:01.265Z',
    destinatarios: [
      [1, 'CR-B6X4ZWVE79'],
      [5, 'CR-XJ4M6DFB55'],
      [6, 'CR-L9KDJ97TTX'],
      [7, 'CR-7A3JDC3GYK'],
      [8, 'CR-4KVK5E75MB'],
      [9, 'CR-DQ38AGGRRL'],
      [10, 'CR-DYXAJKMG7Y'],
      [11, 'CR-YZ8QH97H54'],
      [12, 'CR-MWLCQB85FD'],
      [14, 'CR-5SE4SGWCAP'],
      [15, 'CR-NYVKQRZCZL'],
      [16, 'CR-XFRVHFDEGB'],
      [17, 'CR-D7Y25RK824'],
      [18, 'CR-H9FW2ZYXGU'],
      [19, 'CR-XKPBA6G4NQ'],
      [20, 'CR-BSQGJA6QSY'],
      [21, 'CR-BE4KFKWETX'],
      [22, 'CR-4BTEHUMXW2'],
      [23, 'CR-KF3FFNQCGB'],
      [24, 'CR-25MWZHED8D'],
      [25, 'CR-M4GJEC4CXY'],
      [26, 'CR-JEBSE2ESDU'],
      [27, 'CR-5XDCQNW574'],
      [28, 'CR-YQKTRS4KRQ'],
      [29, 'CR-GUL3ZYJ3W9'],
      [31, 'CR-VZFN2WU86G'],
      [32, 'CR-LQB7A2N9T8'],
      [33, 'CR-7636UJ3CHN'],
      [34, 'CR-BKM96APA6K'],
      [35, 'CR-KCGP87U7HL'],
      [36, 'CR-WT59AMKS88'],
      [37, 'CR-SYJHF5EM5P'],
      [38, 'CR-A9QYV6LKB7'],
      [39, 'CR-BETPPX4JR9'],
      [40, 'CR-S8ZV4M98NR'],
      [41, 'CR-8LTGRYGYWR'],
      [42, 'CR-WE82NUWSGZ'],
      [43, 'CR-TSJNYBUUSX'],
      [44, 'CR-8KGLCAVMP9'],
      [45, 'CR-QT4HH87A68'],
      [46, 'CR-8ZBGEQQKM3'],
    ],
  },
];

async function asegurarSuperadmin(queryInterface) {
  const [
    filas,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "Usuarios" WHERE email = :email LIMIT 1`,
    { replacements: { email: SUPERADMIN.email } }
  );
  if (filas.length) return filas[0].id;

  const password = await argon2.hash(SUPERADMIN.password, { timeCost: 2 });
  await queryInterface.bulkInsert('Usuarios', [
    {
      nombre: SUPERADMIN.nombre,
      apellido: null,
      email: SUPERADMIN.email,
      password,
      telefono: null,
      fechaNacimiento: null,
      rol: 'SUPERADMINISTRADOR',
      activo: true,
      sucursalId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  const [
    creados,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "Usuarios" WHERE email = :email LIMIT 1`,
    { replacements: { email: SUPERADMIN.email } }
  );
  return creados[0].id;
}

async function resolverAlcance(queryInterface) {
  const [
    categorias,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "Categorias" WHERE nombre = :nombre LIMIT 1`,
    { replacements: { nombre: CATEGORIA } }
  );
  if (!categorias.length) {
    throw new Error(
      `Seeder de emisiones: no se encontró la categoría "${CATEGORIA}". Ejecutar los seeders previos.`
    );
  }
  const categoriaId = Number(categorias[0].id);
  const [productos] = await queryInterface.sequelize.query(
    `SELECT id FROM "Productos"
      WHERE "categoriaId" = :categoriaId AND activo = TRUE AND tipo <> 'COMBO'
      ORDER BY id`,
    { replacements: { categoriaId } }
  );
  const productoIdsResueltos = productos.map((producto) => Number(producto.id));
  if (productoIdsResueltos.length === 0) {
    throw new Error(
      `Seeder de emisiones: la categoría "${CATEGORIA}" no tiene productos vigentes.`
    );
  }
  return { categoriaId, productoIdsResueltos };
}

async function resolverDestinatarios(queryInterface) {
  const emails = [
    ...new Set(
      EMISIONES.flatMap((emision) =>
        emision.destinatarios.map(([idOriginal]) => {
          const email = EMAIL_POR_ID[idOriginal];
          if (!email) {
            throw new Error(
              `Seeder de emisiones: falta el email del destinatario original ${idOriginal}.`
            );
          }
          return email;
        })
      )
    ),
  ];
  const [
    filas,
  ] = await queryInterface.sequelize.query(
    `SELECT id, email, rol, activo FROM "Usuarios" WHERE email IN (:emails)`,
    { replacements: { emails } }
  );
  const porEmail = new Map(filas.map((fila) => [fila.email, fila]));
  const invalidos = emails.filter((email) => {
    const fila = porEmail.get(email);
    return !fila || fila.rol !== 'CLIENTE' || !fila.activo;
  });
  if (invalidos.length) {
    throw new Error(
      `Seeder de emisiones: destinatarios inexistentes o no elegibles: ${invalidos.join(
        ', '
      )}.`
    );
  }
  return new Map(filas.map((fila) => [fila.email, Number(fila.id)]));
}

const construirSnapshot = (emision, alcance, idPorEmail) => ({
  nombre: emision.nombre,
  descripcion: emision.descripcion,
  fechaInicio: emision.fechaInicio,
  fechaFin: emision.fechaFin,
  descuento: {
    tipo: emision.tipoDescuento,
    valor: emision.valorDescuento,
    maximo: emision.descuentoMaximo,
    compraMinima: emision.compraMinima,
  },
  seleccion: {
    criterio: 'unidades de productos alcanzados, descendente',
    estadoPedido: 'entregado',
    tiposCliente: emision.tiposCliente,
    periodoAnalisisDias: emision.periodoAnalisisDias,
    minUnidadesCompradas: emision.minUnidadesCompradas,
  },
  usosPermitidos: emision.usosPermitidos,
  destinatariosIds: emision.destinatarios.map(([idOriginal]) =>
    idPorEmail.get(EMAIL_POR_ID[idOriginal])
  ),
  maxDestinatarios: emision.maxDestinatarios,
  alcance: {
    productoIds: [],
    categoriaIds: [alcance.categoriaId],
    productoIdsResueltos: alcance.productoIdsResueltos,
  },
  creadoEn: emision.creadoEn,
  previewToken: {
    ...emision.preview,
    usado: true,
  },
});

async function asegurarEmision(
  queryInterface,
  emision,
  alcance,
  creadaPorUsuarioId,
  idPorEmail
) {
  const [
    existentes,
  ] = await queryInterface.sequelize.query(
    `SELECT id FROM "CuponEmisiones" WHERE nombre = :nombre LIMIT 1`,
    { replacements: { nombre: emision.nombre } }
  );
  let emisionId;
  if (existentes.length) {
    emisionId = existentes[0].id;
  } else {
    const snapshot = construirSnapshot(emision, alcance, idPorEmail);
    const [creadas] = await queryInterface.sequelize.query(
      `INSERT INTO "CuponEmisiones"
         ("creadaPorUsuarioId","nombre","descripcion","tipoDescuento",
          "valorDescuento","compraMinima","descuentoMaximo","fechaInicio",
          "fechaFin","maxDestinatarios","periodoAnalisisDias",
          "cantidadElegibles","cantidadCupones","cantidadEnviados",
          "cantidadFallidos","estado","configuracionSnapshot",
          "bloqueoToken","bloqueoExpiraEn","previewTokenHash",
          "createdAt","updatedAt")
       VALUES
         (:creadaPorUsuarioId,:nombre,:descripcion,:tipoDescuento,
          :valorDescuento,:compraMinima,:descuentoMaximo,:fechaInicio,
          :fechaFin,:maxDestinatarios,:periodoAnalisisDias,
          :cantidad,:cantidad,:cantidad,
          0,'COMPLETADA',:snapshot::jsonb,
          NULL,NULL,:tokenHash,
          :creadaEn,:actualizadaEn)
       RETURNING id`,
      {
        replacements: {
          creadaPorUsuarioId,
          nombre: emision.nombre,
          descripcion: emision.descripcion,
          tipoDescuento: emision.tipoDescuento,
          valorDescuento: emision.valorDescuento,
          compraMinima: emision.compraMinima,
          descuentoMaximo: emision.descuentoMaximo,
          fechaInicio: emision.fechaInicio,
          fechaFin: emision.fechaFin,
          maxDestinatarios: emision.maxDestinatarios,
          periodoAnalisisDias: emision.periodoAnalisisDias,
          cantidad: emision.destinatarios.length,
          snapshot: JSON.stringify(snapshot),
          tokenHash: emision.preview.tokenHash,
          creadaEn: emision.creadaEn,
          actualizadaEn: emision.actualizadaEn,
        },
      }
    );
    emisionId = creadas[0].id;
  }

  const alcanceSnapshot = {
    global: false,
    productoIds: [],
    categoriaIds: [alcance.categoriaId],
    productoIdsResueltos: alcance.productoIdsResueltos,
  };
  for (const [idOriginal, codigo] of emision.destinatarios) {
    const email = EMAIL_POR_ID[idOriginal];
    const usuarioId = idPorEmail.get(email);
    if (!usuarioId) {
      throw new Error(
        `Seeder de emisiones: no se resolvió el destinatario ${email} en la base destino.`
      );
    }
    const [
      existentesCodigo,
    ] = await queryInterface.sequelize.query(
      `SELECT id FROM "Cupones" WHERE codigo = :codigo LIMIT 1`,
      { replacements: { codigo } }
    );
    if (existentesCodigo.length) continue;
    await queryInterface.sequelize.query(
      `INSERT INTO "Cupones"
         ("emisionId","usuarioId","codigo","tipoDescuento","valorDescuento",
          "compraMinima","descuentoMaximo","fechaInicio","fechaFin",
          "usosPermitidos","activo","estadoEnvio","enviadoEn",
          "alcanceSnapshot","createdAt","updatedAt")
       VALUES
         (:emisionId,:usuarioId,:codigo,:tipoDescuento,:valorDescuento,
          :compraMinima,:descuentoMaximo,:fechaInicio,:fechaFin,
          :usosPermitidos,TRUE,'ENVIADO',:enviadoEn,
          :alcance::jsonb,:creadoEn,:actualizadaEn)`,
      {
        replacements: {
          emisionId,
          usuarioId,
          codigo,
          tipoDescuento: emision.tipoDescuento,
          valorDescuento: emision.valorDescuento,
          compraMinima: emision.compraMinima,
          descuentoMaximo: emision.descuentoMaximo,
          fechaInicio: emision.fechaInicio,
          fechaFin: emision.fechaFin,
          usosPermitidos: emision.usosPermitidos,
          enviadoEn: emision.enviadoEn,
          alcance: JSON.stringify(alcanceSnapshot),
          creadoEn: emision.cuponesCreadosEn,
          actualizadaEn: emision.actualizadaEn,
        },
      }
    );
  }

  const [totales] = await queryInterface.sequelize.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE "estadoEnvio" = 'ENVIADO')::int AS enviados
       FROM "Cupones" WHERE "emisionId" = :emisionId`,
    { replacements: { emisionId } }
  );
  await queryInterface.sequelize.query(
    `UPDATE "CuponEmisiones"
        SET "cantidadElegibles" = :total,
            "cantidadCupones" = :total,
            "cantidadEnviados" = :enviados,
            "cantidadFallidos" = 0,
            estado = 'COMPLETADA',
            "updatedAt" = :actualizadaEn
      WHERE id = :emisionId`,
    {
      replacements: {
        emisionId,
        total: totales[0].total,
        enviados: totales[0].enviados,
        actualizadaEn: emision.actualizadaEn,
      },
    }
  );
  return emisionId;
}

module.exports = {
  up: async (queryInterface) => {
    const creadaPorUsuarioId = await asegurarSuperadmin(queryInterface);
    const alcance = await resolverAlcance(queryInterface);
    const idPorEmail = await resolverDestinatarios(queryInterface);

    // `cliente@test.com` es destinatario de ambas; si el seeder de elegibilidad
    // no corrió antes, falla fuerte en vez de sembrar un cupón inútil.
    const clienteId = idPorEmail.get(CLIENTE_EMAIL);
    const [elegibles] = await queryInterface.sequelize.query(
      `SELECT COUNT(*)::int AS unidades
         FROM "Pedidos" p
         JOIN "PedidoItems" i ON i."pedidoId" = p.id
         JOIN "EstadoPedidos" e ON e.id = p."estadoId"
        WHERE p."usuarioId" = :usuarioId
          AND e.nombre = 'entregado'
          AND i."productoId" IN (:productoIds)
          AND p."fechaHora" >= :desde`,
      {
        replacements: {
          usuarioId: clienteId,
          productoIds: alcance.productoIdsResueltos,
          desde: new Date(
            new Date('2026-11-24T20:14:23.871Z').getTime() -
              20 * 24 * 60 * 60 * 1000
          ),
        },
      }
    );
    if (!elegibles.length || Number(elegibles[0].unidades) < 2) {
      throw new Error(
        'Seeder de emisiones: cliente@test.com no tiene 2 unidades ENTREGADAS de pizza en el período. Ejecutar antes 20261124000001-demo-cliente-elegible-cupones.js.'
      );
    }

    for (const emision of EMISIONES) {
      await asegurarEmision(
        queryInterface,
        emision,
        alcance,
        creadaPorUsuarioId,
        idPorEmail
      );
    }
  },

  down: async (queryInterface) => {
    const nombres = EMISIONES.map((emision) => emision.nombre);
    const [
      emisiones,
    ] = await queryInterface.sequelize.query(
      `SELECT id FROM "CuponEmisiones" WHERE nombre IN (:nombres)`,
      { replacements: { nombres } }
    );
    const ids = emisiones.map((emision) => emision.id);
    if (ids.length === 0) return;

    const [
      cupones,
    ] = await queryInterface.sequelize.query(
      `SELECT id FROM "Cupones" WHERE "emisionId" IN (:ids)`,
      { replacements: { ids } }
    );
    const cuponIds = cupones.map((cupon) => cupon.id);
    if (cuponIds.length) {
      await queryInterface.sequelize.query(
        `DELETE FROM "PedidoCupones" WHERE "cuponId" IN (:ids)`,
        { replacements: { ids: cuponIds } }
      );
      await queryInterface.sequelize.query(
        `DELETE FROM "Cupones" WHERE id IN (:ids)`,
        { replacements: { ids: cuponIds } }
      );
    }
    await queryInterface.sequelize.query(
      `DELETE FROM "CuponEmisiones" WHERE id IN (:ids)`,
      { replacements: { ids } }
    );
  },
};
