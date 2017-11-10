exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE identity.user (
        -- Primary key
        id Serial,
        PRIMARY KEY (id),
        -- Core properties
        state SmallInt NOT NULL,
        role SmallInt NOT NULL,
        agreed_to_cookie_policy Boolean NOT NULL,
        -- Foreign key to external system
        auth0_user_id Varchar(128) NOT NULL,
        auth0_user_id_hash Char(64) NOT NULL,
        -- Denormalized data
        auth0_profile Jsonb NOT NULL,
        time_created Timestamp NOT NULL,
        time_last_updated Timestamp NOT NULL,
        time_removed Timestamp NULL
    );

    CREATE UNIQUE INDEX user_auth0_user_id_hash ON identity.user(auth0_user_id_hash);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS identity.user_auth0_user_id_hash;
    DROP TABLE IF EXISTS identity.user;
`);
