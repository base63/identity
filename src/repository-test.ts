import { expect, use } from 'chai'
import * as knex from 'knex'
import 'mocha'
import { MarshalFrom } from 'raynor'
import { raynorChai } from 'raynor-chai'

import { SessionState, Session } from '@base63/identity-sdk-js'
import { SessionToken } from '@base63/identity-sdk-js/session-token'
import { startupMigration } from '@base63/common-server-js'

import * as config from './config'
import { Repository } from './repository'


use(raynorChai);


describe('Repository', () => {
    let conn: knex|null;
    const rightNow: Date = new Date(Date.now());

    before('setup database', () => {
        startupMigration();
    });

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

    afterEach('clear out database', () => {
        const theConn = conn as knex;
        theConn('identity.user_events').delete();
        theConn('identity.user').delete();
        theConn('identity.session_events').delete();
        theConn('identity.session').delete();
    });

    it('can be created', () => {
        const repository = new Repository(conn as knex);
        expect(repository).is.not.null;
    });

    describe('getOrCreateSession', () => {
        it('should create a new token when there isn\'t one', async () => {
            const repository = new Repository(conn as knex);
            const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);

            // Look at the return values
            expect(sessionToken).is.not.null;
            expect(sessionToken).raynor(new (MarshalFrom(SessionToken))());
            expect(sessionToken.userToken).is.null;
            expect(session).raynor(new (MarshalFrom(Session))());
            expect(session.state).is.eql(SessionState.Active);
            expect(session.agreedToCookiePolicy).to.be.false;
            expect(session.user).to.be.null;
            expect(session.timeCreated.getTime()).to.be.gte(rightNow.getTime());
            expect(session.timeLastUpdated).to.eql(session.timeCreated);
            expect(session.hasUser()).to.be.false;
            expect(created).to.be.true;

            // Look at the state of the database
        });

        // it('should reuse an already existing token', async () => {
        //     const repository = new Repository(conn as knex);
        //     const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);
        //     const [newSessionToken, newSession, newCreated] = await repository.getOrCreateSession(sessionToken, rightNow);

        //     expect(created).to.be.true;
        //     expect(sessionToken).is.not.null;
        //     expect(session).is.not.null;
        //     expect(newSessionToken).is.not.null;
        //     expect(newSessionToken).to.eql(sessionToken);
        //     expect(newSession).to.eql(session);
        //     expect(newCreated).to.be.false;
        // });
    });
});
