import { expect, use } from 'chai'
import * as knex from 'knex'
import 'mocha'
import { MarshalFrom } from 'raynor'
import { raynorChai } from 'raynor-chai'
import * as uuid from 'uuid'

import { PrivateUser, PublicUser, Role, SessionState, Session, UserState } from '@base63/identity-sdk-js'
import { SessionEventType, UserEventType } from '@base63/identity-sdk-js/events'
import { SessionToken } from '@base63/identity-sdk-js/session-token'
import { startupMigration } from '@base63/common-server-js'

import { Auth0Profile } from './auth0-profile'
import * as config from './config'
import {
    Repository,
    RepositoryError,
    SessionNotFoundError,
    UserNotFoundError,
    XsrfTokenMismatchError
} from './repository'


use(raynorChai);


describe('RepositoryError', () => {
    it('should construct a proper error', () => {
        const error = new RepositoryError('A problem');
        expect(error.name).to.eql('RepositoryError');
        expect(error.message).to.eql('A problem');
        expect(error.stack).to.be.not.null;
    });
});


describe('SessionNotFoundError', () => {
    it('should construct a proper error', () => {
        const error = new SessionNotFoundError('A problem');
        expect(error.name).to.eql('SessionNotFoundError');
        expect(error.message).to.eql('A problem');
        expect(error.stack).to.be.not.null;
    });
});


describe('XsrfTokenMismatchError', () => {
    it('should construct a proper error', () => {
        const error = new XsrfTokenMismatchError('A problem');
        expect(error.name).to.eql('XsrfTokenMismatchError');
        expect(error.message).to.eql('A problem');
        expect(error.stack).to.be.not.null;
    });
});


describe('UserNotFoundError', () => {
    it('should construct a proper error', () => {
        const error = new UserNotFoundError('A problem');
        expect(error.name).to.eql('UserNotFoundError');
        expect(error.message).to.eql('A problem');
        expect(error.stack).to.be.not.null;
    });
});


describe('Repository', () => {
    let conn: knex | null;
    const rightNow: Date = new Date(Date.now());
    const rightLater: Date = new Date(Date.now() + 3600);
    const rightEvenLater: Date = new Date(Date.now() + 7200);
    const rightTooLate: Date = new Date(Date.now() + 10000);

    const auth0ProfileJohnDoe: Auth0Profile = new Auth0Profile();
    auth0ProfileJohnDoe.name = 'John Doe';
    auth0ProfileJohnDoe.picture = 'https://example.com/picture.jpg';
    auth0ProfileJohnDoe.userId = 'x0bjohn';
    auth0ProfileJohnDoe.language = 'en';

    const auth0ProfileJohnnyDoe: Auth0Profile = new Auth0Profile();
    auth0ProfileJohnnyDoe.name = 'Johnny Doe';
    auth0ProfileJohnnyDoe.picture = 'https://example.com/picture.jpg';
    auth0ProfileJohnnyDoe.userId = 'x0bjohn';
    auth0ProfileJohnnyDoe.language = 'en';

    const auth0ProfileJaneDoe: Auth0Profile = new Auth0Profile();
    auth0ProfileJaneDoe.name = 'Jane Doe';
    auth0ProfileJaneDoe.picture = 'https://example.com/picture-jane.jpg';
    auth0ProfileJaneDoe.userId = 'x0bjane';
    auth0ProfileJaneDoe.language = 'en';

    const auth0ProfileMarshaller = new (MarshalFrom(Auth0Profile))();

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
        await theConn('identity.session_event').delete();
        await theConn('identity.session').delete();
        await theConn('identity.user_event').delete();
        await theConn('identity.user').delete();
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
            expect(sessionToken).to.be.raynor(new (MarshalFrom(SessionToken))());
            expect(sessionToken.userToken).is.null;
            expect(session).to.be.raynor(new (MarshalFrom(Session))());
            expect(session.state).is.eql(SessionState.Active);
            expect(session.agreedToCookiePolicy).to.be.false;
            expect(session.user).to.be.null;
            expect(session.timeCreated).to.be.eql(rightNow);
            expect(session.timeLastUpdated).to.eql(session.timeCreated);
            expect(session.hasUser()).to.be.false;
            expect(created).to.be.true;

            // Look at the state of the database
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(1);
            expect(sessions[0]).to.have.keys("id", "state", "xsrf_token", "agreed_to_cookie_policy", "user_id", "time_created", "time_last_updated", "time_removed");
            expect(sessions[0].id).to.be.eql(sessionToken.sessionId);
            expect(sessions[0].state).to.be.eql(SessionState.Active);
            expect(sessions[0].agreed_to_cookie_policy).to.be.false;
            expect(sessions[0].user_id).to.be.null;
            expect(sessions[0].time_created).to.be.eql(rightNow);
            expect(sessions[0].time_last_updated).to.be.eql(rightNow);
            expect(sessions[0].time_removed).to.be.null;
            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(1);
            expect(sessionEvents[0]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[0].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[0].timestamp).to.eql(rightNow);
            expect(sessionEvents[0].data).to.be.null;
            expect(sessionEvents[0].session_id).to.eql(sessionToken.sessionId);
        });

        it('should reuse an already existing token', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);
            const [newSessionToken, newSession, newCreated] = await repository.getOrCreateSession(sessionToken, rightLater);

            // Look at the return values.
            expect(created).to.be.true;
            expect(newSessionToken).to.eql(sessionToken);
            expect(newSession).to.eql(session);
            expect(newCreated).to.be.false;

            // Look at the state of the database. Just cursory.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(1);
            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(1);
        });

        it('should create a new session when the one it is supplied does not exist', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);
            const badSessionToken = new SessionToken(uuid());
            const [newSessionToken, newSession, newCreated] = await repository.getOrCreateSession(badSessionToken, rightLater);

            // Look at the return values.
            expect(created).to.be.true;
            expect(newSessionToken).is.not.eql(sessionToken);
            expect(newSessionToken).is.not.eql(badSessionToken);
            expect(newSession).is.not.eql(session);
            expect(newCreated).is.true;

            // Look at the state of the database. Just cursory.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(2);
            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(2);
        });

        it('should create a new session when the one it is supplied has been removed', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionToken, session, created] = await repository.getOrCreateSession(null, rightNow);
            await repository.removeSession(sessionToken, rightNow, session.xsrfToken);
            const [newSessionToken, newSession, newCreated] = await repository.getOrCreateSession(sessionToken, rightLater);

            // Look at the return values.
            expect(created).to.be.true;
            expect(newSessionToken).is.not.eql(sessionToken);
            expect(newSession).is.not.eql(session);
            expect(newCreated).is.true;

            // Look at the state of the database. Just cursory.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(2);
            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(3);
        });
    });

    describe('getSession', () => {
        it('should return an existing session', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            const retrievedSession = await repository.getSession(sessionToken);

            // Look at the return values.
            expect(retrievedSession).to.eql(session);
        });

        it('should differentiate between two sessions', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken1, session1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionToken2, session2] = await repository.getOrCreateSession(null, rightNow);

            const retrievedSession1 = await repository.getSession(sessionToken1);
            const retrievedSession2 = await repository.getSession(sessionToken2);

            expect(retrievedSession1).to.eql(session1);
            expect(retrievedSession2).to.eql(session2);
            expect(retrievedSession1).to.not.eql(retrievedSession2);
        });

        it('should throw when the session is missing', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const badSessionToken = new SessionToken(uuid());
            try {
                await repository.getSession(badSessionToken);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the session has been removed', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            await repository.removeSession(sessionToken, rightNow, session.xsrfToken);
            try {
                await repository.getSession(sessionToken);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });
    });

    describe('removeSession', () => {
        it('should archive an existing session', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            await repository.removeSession(sessionToken, rightLater, session.xsrfToken);

            // Read from the db and check that everything's OK.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(1);
            expect(sessions[0]).to.have.keys("id", "state", "xsrf_token", "agreed_to_cookie_policy", "user_id", "time_created", "time_last_updated", "time_removed");
            expect(sessions[0].id).to.be.eql(sessionToken.sessionId);
            expect(sessions[0].state).to.be.eql(SessionState.Removed);
            expect(sessions[0].agreed_to_cookie_policy).to.be.false;
            expect(sessions[0].user_id).to.be.null;
            expect(sessions[0].time_created).to.be.eql(rightNow);
            expect(sessions[0].time_last_updated).to.be.eql(rightLater);
            expect(sessions[0].time_removed).to.be.eql(rightLater);
            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(2);
            expect(sessionEvents[0]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[0].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[0].timestamp).to.eql(rightNow);
            expect(sessionEvents[0].data).to.be.null;
            expect(sessionEvents[0].session_id).to.eql(sessionToken.sessionId);
            expect(sessionEvents[1]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[1].type).to.eql(SessionEventType.Removed);
            expect(sessionEvents[1].timestamp).to.eql(rightLater);
            expect(sessionEvents[1].data).to.be.null;
            expect(sessionEvents[1].session_id).to.eql(sessionToken.sessionId);

            // The session should not be retrievable.
            try {
                await repository.getSession(sessionToken);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the session is missing', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const badSessionToken = new SessionToken(uuid());
            try {
                await repository.removeSession(badSessionToken, rightNow, 'A BAD TOKEN');
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the session has been removed', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            await repository.removeSession(sessionToken, rightLater, session.xsrfToken);
            try {
                await repository.removeSession(sessionToken, rightLater, session.xsrfToken);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the XSRF token is bad', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken] = await repository.getOrCreateSession(null, rightNow);
            try {
                await repository.removeSession(sessionToken, rightLater, 'A BAD TOKEN');
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('XSRF tokens do not match');
            }
        });
    });

    describe('agreeToCookiePolicyForSession', () => {
        it('should change the session agreement to true', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            const newSession = await repository.agreeToCookiePolicyForSession(sessionToken, rightLater, session.xsrfToken);

            // Look at the return values.
            expect(newSession).to.be.raynor(new (MarshalFrom(Session))());
            expect(newSession.state).is.eql(SessionState.Active);
            expect(newSession.agreedToCookiePolicy).to.be.true;
            expect(newSession.user).to.be.null;
            expect(newSession.timeCreated).to.be.eql(rightNow);
            expect(newSession.timeLastUpdated).to.eql(rightLater);
            expect(session.hasUser()).to.be.false;

            // Read from the db and check that everything's OK.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(0);
            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(0);
            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(1);
            expect(sessions[0]).to.have.keys("id", "state", "xsrf_token", "agreed_to_cookie_policy", "user_id", "time_created", "time_last_updated", "time_removed");
            expect(sessions[0].id).to.be.eql(sessionToken.sessionId);
            expect(sessions[0].state).to.be.eql(SessionState.Active);
            expect(sessions[0].agreed_to_cookie_policy).to.be.true;
            expect(sessions[0].user_id).to.be.null;
            expect(sessions[0].time_created).to.be.eql(rightNow);
            expect(sessions[0].time_last_updated).to.be.eql(rightLater);
            expect(sessions[0].time_removed).to.be.null;
            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(2);
            expect(sessionEvents[0]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[0].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[0].timestamp).to.eql(rightNow);
            expect(sessionEvents[0].data).to.be.null;
            expect(sessionEvents[0].session_id).to.eql(sessionToken.sessionId);
            expect(sessionEvents[1]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[1].type).to.eql(SessionEventType.AgreedToCookiePolicy);
            expect(sessionEvents[1].timestamp).to.eql(rightLater);
            expect(sessionEvents[1].data).to.be.null;
            expect(sessionEvents[1].session_id).to.eql(sessionToken.sessionId);

            // The session change should be visible.
            const retrievedSession = await repository.getSession(sessionToken);
            expect(retrievedSession.agreedToCookiePolicy).is.true;
        });

        it('should throw when the session is missing', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const badSessionToken = new SessionToken(uuid());
            try {
                await repository.agreeToCookiePolicyForSession(badSessionToken, rightNow, 'A BAD TOKEN');
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the session is inactive', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            await repository.removeSession(sessionToken, rightNow, session.xsrfToken);
            try {
                await repository.agreeToCookiePolicyForSession(sessionToken, rightLater, session.xsrfToken);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the XSRF token is bad', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken] = await repository.getOrCreateSession(null, rightNow);
            try {
                await repository.agreeToCookiePolicyForSession(sessionToken, rightLater, 'A BAD TOKEN');
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('XSRF tokens do not match');
            }
        });

        // it('should change the user session agreement to true', async () => {
        //     const theConn = conn as knex;
        //     const repository = new Repository(theConn);
        //     const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
        //     const [newSessionToken, newSession, newCreated] = await repository.getOrCreateUserOnSession(sessionToken, auth0Profile, rightLater, session.xsrfToken);
        //     const lastSession = await repository.agreeToCookiePolicyForSession(sessionToken, rightEvenLater, session.xsrfToken);
        // });

        // it('should throw when the user cannot be found', async () => {
        //     expect(true).to.be.false;
        // });
    });

    describe('getOrCreateUserOnSession', () => {
        it('should create a new user', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            const [newSessionToken, newSession, newCreated] = await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnDoe, rightLater, session.xsrfToken);

            // Look at the return values.
            expect(newSessionToken).to.eql(sessionToken);
            expect(newSession).to.be.raynor(new (MarshalFrom(Session))());
            expect(newSession.state).is.eql(SessionState.ActiveAndLinkedWithUser);
            expect(newSession.agreedToCookiePolicy).to.be.false;
            expect(newSession.user).to.be.raynor(new (MarshalFrom(PrivateUser))());
            expect((newSession.user as PrivateUser).state).to.eql(UserState.Active);
            expect((newSession.user as PrivateUser).role).to.eql(Role.Regular);
            expect((newSession.user as PrivateUser).name).to.eql(auth0ProfileJohnDoe.name);
            expect((newSession.user as PrivateUser).pictureUri).to.eql(auth0ProfileJohnDoe.picture);
            expect((newSession.user as PrivateUser).language).to.eql(auth0ProfileJohnDoe.language);
            expect((newSession.user as PrivateUser).timeCreated).to.eql(rightLater);
            expect((newSession.user as PrivateUser).timeLastUpdated).to.eql(rightLater);
            expect((newSession.user as PrivateUser).isAdmin()).to.be.false;
            expect((newSession.user as PrivateUser).agreedToCookiePolicy).to.be.false;
            expect((newSession.user as PrivateUser).userIdHash).to.eql(auth0ProfileJohnDoe.getUserIdHash());
            expect(newSession.hasUser()).to.be.true;
            expect(newSession.timeCreated).to.eql(rightNow);
            expect(newSession.timeLastUpdated).to.eql(rightLater);
            expect(newCreated).to.be.true;

            // Look at the state of the database.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(1);
            expect(users[0]).to.have.keys(
                'id', 'state', 'role', 'agreed_to_cookie_policy', 'provider_user_id', 'provider_user_id_hash',
                'provider_profile', 'time_created', 'time_last_updated', 'time_removed');
            expect(users[0].state).to.eql(UserState.Active);
            expect(users[0].role).to.eql(Role.Regular);
            expect(users[0].agreed_to_cookie_policy).to.be.false;
            expect(users[0].provider_user_id).to.eql(auth0ProfileJohnDoe.userId);
            expect(users[0].provider_user_id_hash).to.eql(auth0ProfileJohnDoe.getUserIdHash());
            expect(users[0].provider_profile).to.eql(auth0ProfileMarshaller.pack(auth0ProfileJohnDoe));
            expect(users[0].time_created).to.eql(rightLater);
            expect(users[0].time_last_updated).to.eql(rightLater);
            expect(users[0].time_removed).to.be.null;

            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(1);
            expect(userEvents[0].type).to.eql(UserEventType.Created);
            expect(userEvents[0].timestamp).to.eql(rightLater);
            expect(userEvents[0].data).to.be.null;
            expect(userEvents[0].user_id).to.eql(users[0].id);

            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(1);
            expect(sessions[0]).to.have.keys("id", "state", "xsrf_token", "agreed_to_cookie_policy", "user_id", "time_created", "time_last_updated", "time_removed");
            expect(sessions[0].id).to.be.eql(sessionToken.sessionId);
            expect(sessions[0].state).to.be.eql(SessionState.ActiveAndLinkedWithUser);
            expect(sessions[0].agreed_to_cookie_policy).to.be.false;
            expect(sessions[0].user_id).to.eql(users[0].id);
            expect(sessions[0].time_created).to.be.eql(rightNow);
            expect(sessions[0].time_last_updated).to.be.eql(rightLater);
            expect(sessions[0].time_removed).to.be.null;

            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(2);
            expect(sessionEvents[0]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[0].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[0].timestamp).to.eql(rightNow);
            expect(sessionEvents[0].data).to.be.null;
            expect(sessionEvents[0].session_id).to.eql(sessionToken.sessionId);
            expect(sessionEvents[1]).to.have.keys("id", "type", "timestamp", "data", "session_id");
            expect(sessionEvents[1].type).to.eql(SessionEventType.LinkedWithUser);
            expect(sessionEvents[1].timestamp).to.eql(rightLater);
            expect(sessionEvents[1].data).to.be.null;
            expect(sessionEvents[1].session_id).to.eql(sessionToken.sessionId);
        });

        it('should throw when the session is missing', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const badSessionToken = new SessionToken(uuid());

            try {
                await repository.getOrCreateUserOnSession(badSessionToken, auth0ProfileJohnDoe, rightNow, 'A BAD TOKEN');
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the session has been removed', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            await repository.removeSession(sessionToken, rightLater, session.xsrfToken);

            try {
                await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnDoe, rightLater, session.xsrfToken);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the XSRF token is bad', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken] = await repository.getOrCreateSession(null, rightNow);

            try {
                await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnDoe, rightLater, 'A BAD TOKEN');
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('XSRF tokens do not match');
            }
        });

        it('should throw when the session is already associated with a user', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn1, sessionJohn1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionTokenJohn2, sessionJohn2] = await repository.getOrCreateUserOnSession(sessionTokenJohn1, auth0ProfileJohnDoe, rightLater, sessionJohn1.xsrfToken);
            const [sessionTokenJane1, sessionJane1] = await repository.getOrCreateSession(null, rightLater);
            const [sessionTokenJane2, sessionJane2] = await repository.getOrCreateUserOnSession(sessionTokenJane1, auth0ProfileJaneDoe, rightEvenLater, sessionJane1.xsrfToken);

            try {
                await repository.getOrCreateUserOnSession(sessionTokenJohn2, auth0ProfileJaneDoe, rightTooLate, sessionJohn2.xsrfToken);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session associated with another user already');
            }

            try {
                await repository.getOrCreateUserOnSession(sessionTokenJane2, auth0ProfileJohnDoe, rightTooLate, sessionJane2.xsrfToken);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session associated with another user already');
            }

        });

        it('should recreate a user which already exists with new info', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            const [newSessionToken, newSession] = await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnDoe, rightLater, session.xsrfToken);
            const [lastSessionToken, lastSession, lastCreated] = await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnnyDoe, rightEvenLater, session.xsrfToken);

            // Look at the return values.
            expect(newSessionToken).to.eql(sessionToken);
            expect(lastSessionToken).to.eql(sessionToken);
            expect(lastSession.state).is.eql(SessionState.ActiveAndLinkedWithUser);
            expect(lastSession.agreedToCookiePolicy).to.be.false;
            expect(lastSession.user).to.be.raynor(new (MarshalFrom(PrivateUser))());
            expect((lastSession.user as PrivateUser).state).to.eql(UserState.Active);
            expect((lastSession.user as PrivateUser).role).to.eql(Role.Regular);
            expect((lastSession.user as PrivateUser).name).to.eql(auth0ProfileJohnnyDoe.name);
            expect((lastSession.user as PrivateUser).pictureUri).to.eql(auth0ProfileJohnnyDoe.picture);
            expect((lastSession.user as PrivateUser).language).to.eql(auth0ProfileJohnnyDoe.language);
            expect((lastSession.user as PrivateUser).timeCreated).to.eql(rightLater);
            expect((lastSession.user as PrivateUser).timeLastUpdated).to.eql(rightEvenLater);
            expect((lastSession.user as PrivateUser).isAdmin()).to.be.false;
            expect((lastSession.user as PrivateUser).agreedToCookiePolicy).to.be.false;
            expect((lastSession.user as PrivateUser).userIdHash).to.eql((newSession.user as PrivateUser).userIdHash);
            expect((lastSession.user as PrivateUser).userIdHash).to.eql(auth0ProfileJohnnyDoe.getUserIdHash());
            expect(lastSession.hasUser()).to.be.true;
            expect(lastSession.timeCreated).to.eql(rightNow);
            expect(lastSession.timeLastUpdated).to.eql(rightLater);
            expect(lastCreated).to.be.false;

            // Look at the state of the database.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(1);
            expect(users[0].provider_profile).to.eql(auth0ProfileMarshaller.pack(auth0ProfileJohnnyDoe));

            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(2);

            expect(userEvents[1].type).to.eql(UserEventType.Recreated);
            expect(userEvents[1].timestamp).to.eql(rightEvenLater);
            expect(userEvents[1].data).to.be.null;
            expect(userEvents[1].user_id).to.eql(users[0].id);

            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(2);
        });

        it('should agree to the cookie policy if creating and the session had agreed', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            await repository.agreeToCookiePolicyForSession(sessionToken, rightNow, session.xsrfToken);
            const [newSessionToken, newSession] = await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnDoe, rightEvenLater, session.xsrfToken);

            // Look at the return values.
            expect(newSessionToken).to.eql(sessionToken);
            expect(newSession.agreedToCookiePolicy).to.be.true;

            // Look at the state of the database.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(1);
            expect(users[0].agreed_to_cookie_policy).to.be.true;

            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(2);

            expect(userEvents[1].type).to.eql(UserEventType.AgreedToCookiePolicy);
            expect(userEvents[1].timestamp).to.eql(rightEvenLater);
            expect(userEvents[1].data).to.be.null;
            expect(userEvents[1].user_id).to.eql(users[0].id);
        });

        it('should agree to the cookie policy if recreating and the session had agreed', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            const [newSessionToken, newSession] = await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnDoe, rightLater, session.xsrfToken);
            await repository.agreeToCookiePolicyForSession(sessionToken, rightEvenLater, session.xsrfToken);
            const [lastSessionToken, lastSession] = await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnnyDoe, rightTooLate, session.xsrfToken);

            // Look at the return values.
            expect(newSessionToken).to.eql(sessionToken);
            expect(lastSessionToken).to.eql(sessionToken);
            expect(newSession.agreedToCookiePolicy).to.be.false;
            expect(lastSession.agreedToCookiePolicy).to.be.true;
            expect(lastSession.timeLastUpdated).to.eql(rightEvenLater);
            expect((lastSession.user as PrivateUser).timeLastUpdated).to.eql(rightTooLate);

            // Look at the state of the database.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(1);
            expect(users[0].agreed_to_cookie_policy).to.be.true;

            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(3);

            expect(userEvents[1].type).to.eql(UserEventType.AgreedToCookiePolicy);
            expect(userEvents[1].timestamp).to.eql(rightEvenLater);
            expect(userEvents[1].data).to.be.null;
            expect(userEvents[1].user_id).to.eql(users[0].id);

            expect(userEvents[2].type).to.eql(UserEventType.Recreated);
            expect(userEvents[2].timestamp).to.eql(rightTooLate);
            expect(userEvents[2].data).to.be.null;
            expect(userEvents[2].user_id).to.eql(users[0].id);
        });

        it('should associate another session with the same user if the userId matches', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken1, session1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionToken2, session2] = await repository.getOrCreateSession(null, rightLater);

            const [newSessionToken1, newSession1, newCreated1] = await repository.getOrCreateUserOnSession(sessionToken1, auth0ProfileJohnDoe, rightEvenLater, session1.xsrfToken);
            const [newSessionToken2, newSession2, newCreated2] = await repository.getOrCreateUserOnSession(sessionToken2, auth0ProfileJohnDoe, rightTooLate, session2.xsrfToken);

            // Look at the return values.
            expect(newSessionToken2).to.not.eql(newSessionToken1);
            expect((newSession1.user as PrivateUser).id).to.eql((newSession2.user as PrivateUser).id);
            expect(newCreated1).to.be.true;
            expect(newCreated2).to.be.false;

            // Look at the state of the database.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(1);

            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(2);

            expect(userEvents[1].type).to.eql(UserEventType.Recreated);
            expect(userEvents[1].timestamp).to.eql(rightTooLate);
            expect(userEvents[1].data).to.be.null;
            expect(userEvents[1].user_id).to.eql(users[0].id);

            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(2);
            expect(sessions[0].user_id).to.eql(users[0].id);
            expect(sessions[1].user_id).to.eql(users[0].id);

            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(4);
            expect(sessionEvents[0].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[0].session_id).to.eql(sessions[0].id);
            expect(sessionEvents[1].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[1].session_id).to.eql(sessions[1].id);
            expect(sessionEvents[2].type).to.eql(SessionEventType.LinkedWithUser);
            expect(sessionEvents[2].session_id).to.eql(sessions[0].id);
            expect(sessionEvents[3].type).to.eql(SessionEventType.LinkedWithUser);
            expect(sessionEvents[3].session_id).to.eql(sessions[1].id);
        });

        it('should not make the session agree to the cookie policy if the user had agreed previously', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken1, session1] = await repository.getOrCreateSession(null, rightNow);
            const [newSessionToken1] = await repository.getOrCreateUserOnSession(sessionToken1, auth0ProfileJohnDoe, rightLater, session1.xsrfToken);
            await repository.agreeToCookiePolicyForSession(sessionToken1, rightLater, session1.xsrfToken);

            const [sessionToken2, session2] = await repository.getOrCreateSession(null, rightEvenLater);
            const [newSessionToken2, newSession2, newCreated2] = await repository.getOrCreateUserOnSession(sessionToken2, auth0ProfileJohnDoe, rightTooLate, session2.xsrfToken);

            // Look at the return values.
            expect(newSessionToken2).to.not.eql(newSessionToken1);
            expect(newSession2.agreedToCookiePolicy).is.false;
            expect((newSession2.user as PrivateUser).agreedToCookiePolicy).is.true;
            expect(newCreated2).to.be.false;

            // Look at the state of the database.
            const users = await theConn('identity.user').select();
            expect(users).to.have.length(1);

            const userEvents = await theConn('identity.user_event').select().orderBy('timestamp', 'asc');
            expect(userEvents).to.have.length(3);

            expect(userEvents[1].type).to.eql(UserEventType.AgreedToCookiePolicy);
            expect(userEvents[1].timestamp).to.eql(rightLater);
            expect(userEvents[1].data).to.be.null;
            expect(userEvents[1].user_id).to.eql(users[0].id);

            expect(userEvents[2].type).to.eql(UserEventType.Recreated);
            expect(userEvents[2].timestamp).to.eql(rightTooLate);
            expect(userEvents[2].data).to.be.null;
            expect(userEvents[2].user_id).to.eql(users[0].id);

            const sessions = await theConn('identity.session').select();
            expect(sessions).to.have.length(2);
            expect(sessions[0].user_id).to.eql(users[0].id);
            expect(sessions[1].user_id).to.eql(users[0].id);

            const sessionEvents = await theConn('identity.session_event').select().orderBy('timestamp', 'asc');
            expect(sessionEvents).to.have.length(5);
            expect(sessionEvents[0].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[0].session_id).to.eql(sessions[0].id);
            expect(sessionEvents[1].type).to.eql(SessionEventType.LinkedWithUser);
            expect(sessionEvents[1].session_id).to.eql(sessions[0].id);
            expect(sessionEvents[2].type).to.eql(SessionEventType.AgreedToCookiePolicy);
            expect(sessionEvents[2].session_id).to.eql(sessions[0].id);

            expect(sessionEvents[3].type).to.eql(SessionEventType.Created);
            expect(sessionEvents[3].session_id).to.eql(sessions[1].id);
            expect(sessionEvents[4].type).to.eql(SessionEventType.LinkedWithUser);
            expect(sessionEvents[4].session_id).to.eql(sessions[1].id);
        });
    });

    describe('getUserOnSession', () => {
        it('should return an existing user', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken1, session1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionToken2, session2] = await repository.getOrCreateUserOnSession(sessionToken1, auth0ProfileJohnDoe, rightLater, session1.xsrfToken);

            const retrievedSession = await repository.getUserOnSession(sessionToken2, auth0ProfileJohnDoe);

            expect(retrievedSession).to.eql(session2);
        });

        it('should return an existing user and integrate new name', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);
            const [sessionToken1, session1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionToken2, session2] = await repository.getOrCreateUserOnSession(sessionToken1, auth0ProfileJohnDoe, rightLater, session1.xsrfToken);

            const retrievedSession = await repository.getUserOnSession(sessionToken2, auth0ProfileJohnnyDoe);

            expect(retrievedSession.user).to.be.raynor(new (MarshalFrom(PrivateUser))());
            expect((retrievedSession.user as PrivateUser).state).to.eql(UserState.Active);
            expect((retrievedSession.user as PrivateUser).role).to.eql(Role.Regular);
            expect((retrievedSession.user as PrivateUser).name).to.eql(auth0ProfileJohnnyDoe.name);
            expect((retrievedSession.user as PrivateUser).pictureUri).to.eql(auth0ProfileJohnnyDoe.picture);
            expect((retrievedSession.user as PrivateUser).language).to.eql(auth0ProfileJohnnyDoe.language);
            expect((retrievedSession.user as PrivateUser).timeCreated).to.eql(rightLater);
            expect((retrievedSession.user as PrivateUser).timeLastUpdated).to.eql(rightLater);
            expect((retrievedSession.user as PrivateUser).isAdmin()).to.be.false;
            expect((retrievedSession.user as PrivateUser).agreedToCookiePolicy).to.be.false;
            expect((retrievedSession.user as PrivateUser).userIdHash).to.eql((session2.user as PrivateUser).userIdHash);
            expect((retrievedSession.user as PrivateUser).userIdHash).to.eql(auth0ProfileJohnnyDoe.getUserIdHash());
        });

        it('should differentiate between two users', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn1, sessionJohn1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionTokenJohn2, sessionJohn2] = await repository.getOrCreateUserOnSession(sessionTokenJohn1, auth0ProfileJohnDoe, rightLater, sessionJohn1.xsrfToken);
            const [sessionTokenJane1, sessionJane1] = await repository.getOrCreateSession(null, rightLater);
            const [sessionTokenJane2, sessionJane2] = await repository.getOrCreateUserOnSession(sessionTokenJane1, auth0ProfileJaneDoe, rightEvenLater, sessionJane1.xsrfToken);

            const retrievedJohn = await repository.getUserOnSession(sessionTokenJohn2, auth0ProfileJohnDoe);
            const retrievedJane = await repository.getUserOnSession(sessionTokenJane2, auth0ProfileJaneDoe);

            expect(retrievedJohn).to.eql(sessionJohn2);
            expect(retrievedJane).to.eql(sessionJane2);
        });

        it('should throw when the user is missing', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const badSessionToken = new SessionToken(uuid());

            try {
                await repository.getUserOnSession(badSessionToken, auth0ProfileJohnDoe);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('User does not exist');
            }
        });

        it('should throw when the user has been removed', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn1, sessionJohn1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionTokenJohn2, sessionJohn2] = await repository.getOrCreateUserOnSession(sessionTokenJohn1, auth0ProfileJohnDoe, rightLater, sessionJohn1.xsrfToken);

            // Hacky way to go about this.
            await theConn('identity.user').update({ state: UserState.Removed }).where({ id: (sessionJohn2.user as PrivateUser).id });

            try {
                await repository.getUserOnSession(sessionTokenJohn2, auth0ProfileJohnDoe);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('User does not exist');
            }
        });

        it('should throw when the session is missing', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn1, sessionJohn1] = await repository.getOrCreateSession(null, rightNow);
            await repository.getOrCreateUserOnSession(sessionTokenJohn1, auth0ProfileJohnDoe, rightLater, sessionJohn1.xsrfToken);

            const badSessionToken = new SessionToken(uuid());

            try {
                await repository.getUserOnSession(badSessionToken, auth0ProfileJohnDoe);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the session has been removed', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn1, sessionJohn1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionTokenJohn2] = await repository.getOrCreateUserOnSession(sessionTokenJohn1, auth0ProfileJohnDoe, rightLater, sessionJohn1.xsrfToken);

            await repository.removeSession(sessionTokenJohn1, rightLater, sessionJohn1.xsrfToken);

            try {
                await repository.getUserOnSession(sessionTokenJohn2, auth0ProfileJohnDoe);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the session is not marked as linked', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn1, sessionJohn1] = await repository.getOrCreateSession(null, rightNow);
            const [sessionTokenJohn2] = await repository.getOrCreateUserOnSession(sessionTokenJohn1, auth0ProfileJohnDoe, rightLater, sessionJohn1.xsrfToken);

            // Hacky way to go about this.
            await theConn('identity.session').update({ state: SessionState.Active }).where({ id: (sessionTokenJohn1.sessionId) });

            try {
                await repository.getUserOnSession(sessionTokenJohn2, auth0ProfileJohnDoe);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session does not exist');
            }
        });

        it('should throw when the session is not linked with the user', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn, sessionJohn] = await repository.getOrCreateSession(null, rightNow);
            await repository.getOrCreateUserOnSession(sessionTokenJohn, auth0ProfileJohnDoe, rightLater, sessionJohn.xsrfToken);
            const [sessionTokenJane, sessionJane] = await repository.getOrCreateSession(null, rightEvenLater);
            await repository.getOrCreateUserOnSession(sessionTokenJane, auth0ProfileJaneDoe, rightTooLate, sessionJane.xsrfToken);

            try {
                await repository.getUserOnSession(sessionTokenJane, auth0ProfileJohnDoe);
                expect(false).to.be.true;
            } catch (e) {
                expect(e.message).to.eql('Session and user do not match');
            }
        });
    });

    describe('getUsersInfo', () => {
        it('should return one user', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionToken, session] = await repository.getOrCreateSession(null, rightNow);
            const [, newSession] = await repository.getOrCreateUserOnSession(sessionToken, auth0ProfileJohnDoe, rightLater, session.xsrfToken);

            const users = await repository.getUsersInfo([(newSession.user as PrivateUser).id]);

            expect(users).to.have.length(1);
            expect(users[0]).to.be.raynor(new (MarshalFrom(PublicUser))());
            expect(users[0].id).to.eql((newSession.user as PrivateUser).id);
            expect(users[0].state).to.eql(UserState.Active);
            expect(users[0].role).to.eql(Role.Regular);
            expect(users[0].name).to.eql(auth0ProfileJohnDoe.name);
            expect(users[0].pictureUri).to.eql(auth0ProfileJohnDoe.picture);
            expect(users[0].language).to.eql(auth0ProfileJohnDoe.language);
            expect(users[0].timeCreated).to.eql(rightLater);
            expect(users[0].timeLastUpdated).to.eql(rightLater);
        });

        it('should return two users', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn, sessionJohn] = await repository.getOrCreateSession(null, rightNow);
            const [, newSessionJohn] = await repository.getOrCreateUserOnSession(sessionTokenJohn, auth0ProfileJohnDoe, rightLater, sessionJohn.xsrfToken);

            const [sessionTokenJane, sessionJane] = await repository.getOrCreateSession(null, rightEvenLater);
            const [, newSessionJane] = await repository.getOrCreateUserOnSession(sessionTokenJane, auth0ProfileJaneDoe, rightTooLate, sessionJane.xsrfToken);

            const users = await repository.getUsersInfo([(newSessionJohn.user as PrivateUser).id, (newSessionJane.user as PrivateUser).id]);

            expect(users).to.have.length(2);
            expect(users[0]).to.be.raynor(new (MarshalFrom(PublicUser))());
            expect(users[0].id).to.eql((newSessionJohn.user as PrivateUser).id);
            expect(users[0].state).to.eql(UserState.Active);
            expect(users[0].role).to.eql(Role.Regular);
            expect(users[0].name).to.eql(auth0ProfileJohnDoe.name);
            expect(users[0].pictureUri).to.eql(auth0ProfileJohnDoe.picture);
            expect(users[0].language).to.eql(auth0ProfileJohnDoe.language);
            expect(users[0].timeCreated).to.eql(rightLater);
            expect(users[0].timeLastUpdated).to.eql(rightLater);
            expect(users[1]).to.be.raynor(new (MarshalFrom(PublicUser))());
            expect(users[1].id).to.eql((newSessionJane.user as PrivateUser).id);
            expect(users[1].state).to.eql(UserState.Active);
            expect(users[1].role).to.eql(Role.Regular);
            expect(users[1].name).to.eql(auth0ProfileJaneDoe.name);
            expect(users[1].pictureUri).to.eql(auth0ProfileJaneDoe.picture);
            expect(users[1].language).to.eql(auth0ProfileJaneDoe.language);
            expect(users[1].timeCreated).to.eql(rightTooLate);
            expect(users[1].timeLastUpdated).to.eql(rightTooLate);
        });

        it('should skip over an inactive user', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn, sessionJohn] = await repository.getOrCreateSession(null, rightNow);
            const [, newSessionJohn] = await repository.getOrCreateUserOnSession(sessionTokenJohn, auth0ProfileJohnDoe, rightLater, sessionJohn.xsrfToken);

            const [sessionTokenJane, sessionJane] = await repository.getOrCreateSession(null, rightEvenLater);
            const [, newSessionJane] = await repository.getOrCreateUserOnSession(sessionTokenJane, auth0ProfileJaneDoe, rightTooLate, sessionJane.xsrfToken);

            await theConn('identity.user').update({ state: UserState.Removed }).where({ id: (newSessionJohn.user as PrivateUser).id });

            const users = await repository.getUsersInfo([(newSessionJane.user as PrivateUser).id]);

            expect(users).to.have.length(1);
            expect(users[0]).to.be.raynor(new (MarshalFrom(PublicUser))());
            expect(users[0].id).to.eql((newSessionJane.user as PrivateUser).id);
            expect(users[0].state).to.eql(UserState.Active);
            expect(users[0].role).to.eql(Role.Regular);
            expect(users[0].name).to.eql(auth0ProfileJaneDoe.name);
            expect(users[0].pictureUri).to.eql(auth0ProfileJaneDoe.picture);
            expect(users[0].language).to.eql(auth0ProfileJaneDoe.language);
            expect(users[0].timeCreated).to.eql(rightTooLate);
            expect(users[0].timeLastUpdated).to.eql(rightTooLate);
        });

        it('should throw when there are too many users to retrieve', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            try {
                await repository.getUsersInfo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
                expect(true).to.be.false;
            } catch (e) {
                expect(e.message).to.eql('Can\'t retrieve 21 users');
            }
        });

        it('should throw when not enough users are retrieved', async () => {
            const theConn = conn as knex;
            const repository = new Repository(theConn);

            const [sessionTokenJohn, sessionJohn] = await repository.getOrCreateSession(null, rightNow);
            const [, newSessionJohn] = await repository.getOrCreateUserOnSession(sessionTokenJohn, auth0ProfileJohnDoe, rightLater, sessionJohn.xsrfToken);

            const [sessionTokenJane, sessionJane] = await repository.getOrCreateSession(null, rightEvenLater);
            const [, newSessionJane] = await repository.getOrCreateUserOnSession(sessionTokenJane, auth0ProfileJaneDoe, rightTooLate, sessionJane.xsrfToken);

            await theConn('identity.user').update({ state: UserState.Removed }).where({ id: (newSessionJohn.user as PrivateUser).id });

            const id1 = (newSessionJohn.user as PrivateUser).id;
            const id2 = (newSessionJane.user as PrivateUser).id;

            try {
                await repository.getUsersInfo([id1, id2]);
                expect(true).to.be.false;
            } catch (e) {
                expect(e.message).to.eql(`Looking for ids [${id1},${id2}] but got [${id2}]`);
            }
        });
    });
});
