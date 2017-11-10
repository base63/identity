exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE identity.user_event (
        -- Primary key
        id Serial,
        PRIMARY KEY (id),
        -- Core properties
        type SmallInt NOT NULL,
        timestamp Timestamp NOT NULL,
        data Jsonb NULL,
        -- Foreign key
        user_id Int NOT NULL REFERENCES identity.user(id)
    );

    CREATE INDEX user_event_user_id ON identity.user_event(user_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS identity.user_event_user_id;
    DROP TABLE IF EXISTS identity.user_event;
`);
