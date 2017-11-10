exports.up = (knex, Promise) => knex.schema.raw(
    'CREATE SCHEMA identity'
);

exports.down = (knex, Promise) => knex.schema.raw(
    'DROP SCHEMA IF EXISTS identity'
);
