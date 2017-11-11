import { expect } from 'chai'
import * as knex from 'knex'
import 'mocha'

import * as config from './config'
import { Repository } from './repository'


describe('Repository', () => {
    let conn: knex|null;
    const rightNow: Date = new Date(Date.now());

    before('create connection', () => {
        conn = knex({
            client: 'pg',
            connection: config.DATABASE_URL,
            pool: {
                min: 0,
                max: 1
            },
            acquireConnectionTimeout: 100
        });
    });

    after('destroy connection', () => {
        (conn as knex).destroy();
    });

    it('can be created', () => {
        const repository = new Repository(conn as knex);
        expect(repository).is.not.null;
    });

    describe('getOrCreateSession', () => {
        it('should create a new token when there isn\'t one', async () => {
            const repository = new Repository(conn as knex);
            const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);

            expect(created).to.be.true;
            expect(sessionToken).is.not.null;
            expect(session).is.not.null;
        });
    });
});
