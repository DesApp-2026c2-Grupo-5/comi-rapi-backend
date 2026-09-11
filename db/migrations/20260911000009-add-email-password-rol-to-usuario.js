'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Extender tabla Usuarios
 *
 * El frontend requiere en el usuario: { id, nombre, email, password, rol }.
 * La tabla actual (template UNAHUR) tiene: nombre, apellido, fechaNacimiento, avatarUrl.
 *
 * Al implementar, agregar las columnas:
 *   - email: STRING, notNull, unique
 *   - password: STRING, notNull  (guardar SIEMPRE hasheado, nunca en texto plano)
 *   - rol: STRING, notNull, default 'CLIENTE'  (valores: 'CLIENTE' | 'ADMIN')
 *
 * Columnas del template que pueden dejarse opcionales o eliminarse:
 *   - apellido, fechaNacimiento, avatarUrl (el frontend no las usa actualmente)
 *
 * up:   queryInterface.addColumn('Usuarios', 'email', {...}) + addColum password + rol
 * down: queryInterface.removeColumn por cada una
 */
