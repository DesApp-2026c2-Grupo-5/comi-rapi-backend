import db from '../lib/models';

const TRUNCATE_QUERY = `do
$$
declare
  l_stmt text;
begin
  select 'truncate ' || string_agg(format('%I.%I', schemaname, tablename), ',') || ' RESTART IDENTITY CASCADE'
    into l_stmt
  from pg_tables
  where schemaname in ('public') AND pg_tables.tablename not in ('SequelizeMeta', 'SequelizeData');
  execute l_stmt;
end;
$$`;

export async function cleanDb() {
  await db.sequelize.query(TRUNCATE_QUERY);
}

/**
 * Crea un usuario directamente en la base (con el hook de hashing de
 * contraseña), sin pasar por el registro público.
 *
 * El registro público siempre crea CLIENTE, así que los fixtures que
 * necesitan un ADMINISTRADOR (o cualquier otro rol) usan esta vía.
 */
export async function crearUsuario({
  nombre = 'Test',
  apellido = 'Test',
  email,
  password = '123456',
  telefono = null,
  fechaNacimiento = null,
  rol = 'CLIENTE',
  activo = true,
  sucursalId = null,
} = {}) {
  return db.Usuario.create({
    nombre,
    apellido,
    email,
    password,
    telefono,
    fechaNacimiento,
    rol,
    activo,
    sucursalId,
  });
}

/**
 * Carga parámetros de negocio en la base para aislar una suite de los valores
 * por defecto del catálogo. Solo escribe las claves indicadas; las demás siguen
 * cayendo al valor por defecto del catálogo.
 *
 * `cleanDb()` trunca `ParametrosSistema`, así que cada suite que necesite un
 * valor distinto al de producción llama a esta función después de limpiar.
 *
 * @param {Object} valores - { clave: valor } (número o string).
 */
export async function crearParametros(valores = {}) {
  const entradas = Object.entries(valores);
  if (entradas.length === 0) return;
  for (const [clave, valor] of entradas) {
    // `clave` es UNIQUE (no PK): upsert por `clave` con findOrCreate.
    const [fila, creada] = await db.ParametroSistema.findOrCreate({
      where: { clave },
      defaults: {
        clave,
        valor: String(valor),
        descripcion: `Parámetro de prueba ${clave}`,
      },
    });
    if (!creada && fila.valor !== String(valor)) {
      fila.valor = String(valor);
      await fila.save();
    }
  }
}
