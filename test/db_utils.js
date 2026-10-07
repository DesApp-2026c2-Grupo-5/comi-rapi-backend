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
