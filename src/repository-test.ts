import { expect, use } from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
import * as knex from 'knex'
import 'mocha'
import { MarshalFrom } from 'raynor'
import { raynorChai } from 'raynor-chai'
import * as uuid from 'uuid'

import { SessionState, Session } from '@base63/identity-sdk-js'
import { SessionEventType } from '@base63/identity-sdk-js/events'
import { SessionToken } from '@base63/identity-sdk-js/session-token'
import { startupMigration } from '@base63/common-server-js'

import * as config from './config'
import { Repository } from './repository'


use(raynorChai);
use(chaiAsPromised);


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
                max: 10
            },
            acquireConnectionTimeout: 1000
        });
    });

    after('destroy connection', () => {
        (conn as knex).destroy();
    });

    afterEach('clear out database', async () => {
        const theConn = conn as knex;
        await theConn('identity.user_event').delete();
        await theConn('identity.user').delete();
        await theConn('identity.session_event').delete();
        await theConn('identity.session').delete();
    });

    it('can be created', () => {
        const repository = new Repository(conn as knex);
        expect(repository).is.not.null;
    });

    describe('getOrCreateSession', () => {
        it('should create a new token when there Ian\'t one', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);

            // Look at the return values
            expect(sessionToken).is.not.null;
            expect(sessionToken).to.be.raynor(new (MarshalFrom(SessionToken))());
            expect(sessionToken.userToken).is.null;
            expect(session).to.be.raynor(new (MarshalFrom(Session))());
            expect(session.state).is.eql(SessionState.Active);
            expect(session.agreedToCookiePolicy).to.be.false;
            expect(session.user).to.be.null;
            expect(session.timeCreated.getTime()).to.be.gte(rightNow.getTime());
            expect(session.timeLastUpdated).to.eql(session.timeCreated);
            expect(session.hasUser()).to.be.false;
            expect(created).to.be.true;

            // Look at the state of the database
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select();
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(1);
            expect(sessions[0]).to.have.keys("id", "state", "xsrf_token", "agreed_to_cookie_policy", "user_id", "time_created", "time_last_updated", "time_removed");
            expect(sessions[0].id).to.be.eql(sessionToken.sessionId);
            expect(sessions[0].state).to.be.eql(session.state);
            expect(sessions[0].agreed_to_cookie_policy).to.be.false;
            expect(sessions[0].user_id).to.be.null;
            expect(new Date(sessions[0].time_created)).to.be.eql(session.timeCreated);
            expect(new Date(sessions[0].time_last_updated)).to.be.eql(session.timeLastUpdated);
            expect(sessions[0].time_removed).to.be.null;
            const sessionEvents = await theConn('identity.session_event').select();
            expect(sessionEvents).to.have.length(1);
            expect(sessionEvents[0]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[0].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[0].timestamp).to.eql(session.timeCreated);
            expect(sessionEvents[0].data).to.be.null;
            expect(sessionEvents[0].session_id).to.eql(sessionToken.sessionId);
        });

        it('should reuse an already existing token', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);
            const [newSessionToken, newSession, newCreated] = await repository.getOrCreateSession(sessionToken, rightNow);

            // Look at the return values.
            expect(created).to.be.true;
            expect(newSessionToken).is.not.null;
            expect(newSessionToken).to.eql(sessionToken);
            expect(newSession).to.eql(session);
            expect(newCreated).to.be.false;

            // Look at the state of the database. Just cursory.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select();
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(1);
            const sessionEvents = await theConn('identity.session_event').select();
            expect(sessionEvents).to.have.length(1);
        });

        it('should create a new session when the one it is supplied does not exist', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);
            const badSessionToken = new SessionToken(uuid());
            const [newSessionToken, newSession, newCreated] = await repository.getOrCreateSession(badSessionToken, rightNow);

            // Look at the return values.
            expect(created).to.be.true;
            expect(newSessionToken).is.not.null;
            expect(newSessionToken).is.not.eql(sessionToken);
            expect(newSessionToken).is.not.eql(badSessionToken);
            expect(newSession).is.not.eql(session);
            expect(newCreated).is.true;

            // Look at the state of the database. Just cursory.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select();
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(2);
            const sessionEvents = await theConn('identity.session_event').select();
            expect(sessionEvents).to.have.length(2);
        });
    });

    describe('getSession', () => {
        it('should return an existing session', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            const retrievedSession = await repository.getSession(sessionToken);

            // Look at the return values.
            expect(retrievedSession).is.not.null;
            expect(retrievedSession).to.eql(session);
        });

        it('should throw when the session is missing', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const badSessionToken = new SessionToken(uuid());
            expect(repository.getSession(badSessionToken)).to.eventually.throw('Session does not exist');
        });
    });

    describe('expireSession', () => {
        it('should archive an existing session', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            await repository.expireSession(sessionToken, rightNow, session.xsrfToken);

            // Read from the db and check that everything's OK.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select();
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(1);
            expect(sessions[0]).to.have.keys("id", "state", "xsrf_token", "agreed_to_cookie_policy", "user_id", "time_created", "time_last_updated", "time_removed");
            expect(sessions[0].id).to.be.eql(sessionToken.sessionId);
            expect(sessions[0].state).to.be.eql(SessionState.Removed);
            expect(sessions[0].agreed_to_cookie_policy).to.be.false;
            expect(sessions[0].user_id).to.be.null;
            expect(new Date(sessions[0].time_created)).to.be.eql(session.timeCreated);
            expect(new Date(sessions[0].time_last_updated)).to.be.eql(session.timeLastUpdated);
            expect(new Date(sessions[0].time_removed)).to.be.eql(rightNow);
            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(2);
            expect(sessionEvents[0]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[0].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[0].timestamp).to.eql(session.timeCreated);
            expect(sessionEvents[0].data).to.be.null;
            expect(sessionEvents[0].session_id).to.eql(sessionToken.sessionId);
            expect(sessionEvents[1]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[1].type).to.eql(SessionEventType.Removed);
            expect(sessionEvents[1].timestamp).to.eql(rightNow);
            expect(sessionEvents[1].data).to.be.null;
            expect(sessionEvents[1].session_id).to.eql(sessionToken.sessionId);

            // The session should not be retrievable.
            expect(repository.getSession(sessionToken)).to.eventually.throw('Session does not exist');
        });

        it('should throw when the session is missing', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const badSessionToken = new SessionToken(uuid());
            expect(repository.expireSession(badSessionToken, rightNow, 'A BAD TOKEN')).to.eventually.throw('Session does not exist');
        });

        it('should throw when the XSRF token is bad', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken] = await repository.getOrCreateSession(null, rightNow);
            expect(repository.expireSession(sessionToken, rightNow, 'A BAD TOKEN')).to.eventually.throw('XSRF tokens do not match');
        });
    });
});
