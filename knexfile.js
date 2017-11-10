module.exports = {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: {
	      min: 2,
	      max: 10
    },
    migrations: {
	      directory: process.env.DATABASE_MIGRATIONS_DIR,
	      tableName: process.env.DATABASE_MIGRATIONS_TABLE
    }
}
