exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE identity.session (
        -- Primary key
        id Uuid,
        PRIMARY KEY (id),
        -- Core properties
        state SmallInt NOT NULL,
        xsrf_token Char(64) NOT NULL,
        agreed_to_cookie_policy Boolean NOT NULL,
        -- Foreign key
        user_id Int NULL REFERENCES identity.user(id),
        -- Denormalized data
        time_created Timestamp NOT NULL,
        time_last_updated Timestamp NOT NULL,
        time_removed Timestamp NULL
    );
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP TABLE IF EXISTS identity.session;
`);
