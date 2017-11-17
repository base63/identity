import * as auth0 from 'auth0'
import { expect } from 'chai'
import * as HttpStatus from 'http-status-codes'
import 'mocha'
import { MarshalFrom } from 'raynor'
import * as td from 'testdouble'
import { agent } from 'supertest'
import * as uuid from 'uuid'

import { Env } from '@base63/common-js'
import { SESSION_TOKEN_COOKIE_NAME, SESSION_TOKEN_HEADER_NAME } from '@base63/identity-sdk-js/client'
import { SessionAndTokenResponse } from '@base63/identity-sdk-js/dtos'
import { Session, SessionState } from '@base63/identity-sdk-js/entities'
import { SessionToken } from '@base63/identity-sdk-js/session-token'

import { AppConfig, newApp } from './app'
import { Repository } from './repository'


describe('App', () => {
    const localAppConfig: AppConfig = {
        env: Env.Local,
        name: 'identity',
        clients: ['core'],
        forceDisableLogging: true,
        logglyToken: null,
        logglySubdomain: null,
        rollbarToken: null
    };

    const rightNow: Date = new Date(Date.now());

    const sessionTokenMarshaller = new (MarshalFrom(SessionToken))();
    const sessionAndTokenResponseMarshaller = new (MarshalFrom(SessionAndTokenResponse))();

    const theSessionToken = new SessionToken(uuid());
    const theSession =  new Session();
    theSession.state = SessionState.Active;
    theSession.xsrfToken = ('0' as any).repeat(64);
    theSession.agreedToCookiePolicy = false;
    theSession.timeCreated = rightNow;
    theSession.timeLastUpdated = rightNow;

    it('can be constructed', () => {
        const auth0Client = td.object({});
        const repository = td.object({});

        const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);

        expect(app).is.not.null;
    });

    describe('/session POST', () => {
        it('should return the newly created session when is no session information', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getOrCreateSession: (_t: SessionToken | null, _c: Date) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.getOrCreateSession(null, td.matchers.isA(Date))).thenReturn([theSessionToken, theSession, true]);

            await appAgent
                .post('/session')
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.CREATED)
                .then(response => {
                    const result = sessionAndTokenResponseMarshaller.extract(response.body);
                    expect(result.sessionToken).to.eql(theSessionToken);
                    expect(result.session).to.eql(theSession);
                });
        });

        it('should return a newly created session when is bad session information', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getOrCreateSession: (_t: SessionToken | null, _c: Date) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.getOrCreateSession(null, td.matchers.isA(Date))).thenReturn([theSessionToken, theSession, true]);

            await appAgent
                .post('/session')
                .set(SESSION_TOKEN_HEADER_NAME, 'bad data here')
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.CREATED)
                .then(response => {
                    const result = sessionAndTokenResponseMarshaller.extract(response.body);
                    expect(result.sessionToken).to.eql(theSessionToken);
                    expect(result.session).to.eql(theSession);
                });
        });

        it('should return an already existing session when it is attached via a cookie', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getOrCreateSession: (_t: SessionToken | null, _c: Date) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.getOrCreateSession(theSessionToken, td.matchers.isA(Date))).thenReturn([theSessionToken, theSession, false]);

            await appAgent
                .post('/session')
                .set('Cookie', `${SESSION_TOKEN_COOKIE_NAME}=${JSON.stringify(sessionTokenMarshaller.pack(theSessionToken))}`)
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.OK)
                .then(response => {
                    const result = sessionAndTokenResponseMarshaller.extract(response.body);
                    expect(result.sessionToken).to.eql(theSessionToken);
                    expect(result.session).to.eql(theSession);
                });
        });

        it('should return an already existing session when it is attached via the header', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getOrCreateSession: (_t: SessionToken | null, _c: Date) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.getOrCreateSession(theSessionToken, td.matchers.isA(Date))).thenReturn([theSessionToken, theSession, false]);

            await appAgent
                .post('/session')
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionToken)))
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.OK)
                .then(response => {
                    const result = sessionAndTokenResponseMarshaller.extract(response.body);
                    expect(result.sessionToken).to.eql(theSessionToken);
                    expect(result.session).to.eql(theSession);
                });
        });

        it('should return BAD_REQUEST when there is no origin', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getOrCreateSession: (_t: SessionToken | null, _c: Date) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            await appAgent
                .post('/session')
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).to.have.length(0);
                });

            td.verify(repository.getOrCreateSession(td.matchers.anything(), td.matchers.anything()), { times: 0 });
        });

        it('should return BAD_REQUEST when the origin is not allowed', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getOrCreateSession: (_t: SessionToken | null, _c: Date) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            await appAgent
                .post('/session')
                .set('Origin', 'bad-origin')
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).to.have.length(0);
                });

            td.verify(repository.getOrCreateSession(td.matchers.anything(), td.matchers.anything()), { times: 0 });
        });

        it('should return INTERNAL_SERVER_ERROR when the repository throws', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getOrCreateSession: (_t: SessionToken | null, _c: Date) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.getOrCreateSession(null, td.matchers.isA(Date))).thenThrow(new Error('Something bad happened'));

            await appAgent
                .post('/session')
                .set('Origin', 'core')
                .expect(HttpStatus.INTERNAL_SERVER_ERROR)
                .then(response => {
                    expect(response.text).to.have.length(0);
                });
        });
    });
});
