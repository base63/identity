import * as auth0 from 'auth0'
import { expect } from 'chai'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'
import 'mocha'
import { MarshalFrom } from 'raynor'
import * as td from 'testdouble'
import { agent, Test } from 'supertest'
import * as uuid from 'uuid'

import { Env } from '@base63/common-js'
import {
    SESSION_TOKEN_COOKIE_NAME,
    SESSION_TOKEN_HEADER_NAME,
    XSRF_TOKEN_HEADER_NAME
} from '@base63/identity-sdk-js/client'
import { SessionAndTokenResponse, SessionResponse } from '@base63/identity-sdk-js/dtos'
import { Session, SessionState } from '@base63/identity-sdk-js/entities'
import { SessionToken } from '@base63/identity-sdk-js/session-token'

import { AppConfig, newApp } from './app'
import { Repository, SessionNotFoundError, XsrfTokenMismatchError } from './repository'


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
    const sessionResponseMarshaller = new (MarshalFrom(SessionResponse))();

    const theSessionToken = new SessionToken(uuid());
    const theSession = new Session();
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

        it('should return a newly created session with bad session information', async () => {
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

        badOrigins('/session', 'post');
        badRepository('/session', 'post', { getOrCreateSession: (_t: SessionToken | null, _c: Date) => { } }, {
            'INTERNAL_SERVER_ERROR when the repository errors': [new Error('An error occured'), HttpStatus.INTERNAL_SERVER_ERROR]
        });
    });

    describe('/session GET', () => {
        it('should return an existing session with the session token in the cookie', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getSession: (_t: SessionToken) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.getSession(theSessionToken)).thenReturn(theSession);

            await appAgent
                .get('/session')
                .set('Cookie', `${SESSION_TOKEN_COOKIE_NAME}=${JSON.stringify(sessionTokenMarshaller.pack(theSessionToken))}`)
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.OK)
                .then(response => {
                    const result = sessionResponseMarshaller.extract(response.body);
                    expect(result.session).to.eql(theSession);
                });
        });

        it('should return an existing session with the session token in the header', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                getSession: (_t: SessionToken) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.getSession(theSessionToken)).thenReturn(theSession);

            await appAgent
                .get('/session')
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionToken)))
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.OK)
                .then(response => {
                    const result = sessionResponseMarshaller.extract(response.body);
                    expect(result.session).to.eql(theSession);
                });
        });

        badOrigins('/session', 'get');
        badSessionToken('/session', 'get');
        badRepository('/session', 'get', { getSession: (_t: SessionToken) => { } }, {
            'NOT_FOUND when the session is not present': [new SessionNotFoundError('Not found'), HttpStatus.NOT_FOUND],
            'INTERNAL_SERVER_ERROR when the repository errors': [new Error('An error occurred'), HttpStatus.INTERNAL_SERVER_ERROR]
        });
    });

    describe('/session DELETE', () => {
        it('should succeed when the session token is in the cookie', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                removeSession: (_t: SessionToken, _d: Date, _x: string) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.removeSession(theSessionToken, td.matchers.isA(Date), theSession.xsrfToken)).thenReturn();

            await appAgent
                .delete('/session')
                .set('Cookie', `${SESSION_TOKEN_COOKIE_NAME}=${JSON.stringify(sessionTokenMarshaller.pack(theSessionToken))}`)
                .set(XSRF_TOKEN_HEADER_NAME, theSession.xsrfToken)
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.NO_CONTENT)
                .then(response => {
                    expect(response.text).to.have.length(0);
                });
        });

        it('should succeed when the session token is in the header', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                removeSession: (_t: SessionToken, _d: Date, _x: string) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.removeSession(theSessionToken, td.matchers.isA(Date), theSession.xsrfToken)).thenReturn();

            await appAgent
                .delete('/session')
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionToken)))
                .set(XSRF_TOKEN_HEADER_NAME, theSession.xsrfToken)
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.NO_CONTENT)
                .then(response => {
                    expect(response.text).to.have.length(0);
                });
        });

        badOrigins('/session', 'delete');
        badSessionToken('/session', 'delete');
        badXsrfToken('/session', 'delete');
        badRepository('/session', 'delete', { removeSession: (_t: SessionToken, _d: Date, _x: string) => { } }, {
            'NOT_FOUND when the session is not present': [new SessionNotFoundError('Not found'), HttpStatus.NOT_FOUND],
            'BAD_REQUEST when the XSRF token is mismatched': [new XsrfTokenMismatchError('Invalid token'), HttpStatus.BAD_REQUEST],
            'INTERNAL_SERVER_ERROR when the repository errors': [new Error('An error occurred'), HttpStatus.INTERNAL_SERVER_ERROR]
        });
    });

    type Method = 'post' | 'get' | 'delete';

    function newAgent(app: express.Express, uri: string, method: Method): Test {
        const appAgent = agent(app);

        switch (method) {
            case 'post':
                return appAgent.post(uri);
            case 'get':
                return appAgent.get(uri);
            case 'delete':
                return appAgent.delete(uri);
        }
    }

    function badOrigins(uri: string, method: Method) {
        it('should return BAD_REQUEST when there is no origin', async () => {
            const auth0Client = td.object({});
            const repository = td.object({});

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const restOfTest = newAgent(app, uri, method);

            await restOfTest
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).to.have.length(0);
                });
        });

        it('should return BAD_REQUEST when the origin is not allowed', async () => {
            const auth0Client = td.object({});
            const repository = td.object({});

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const restOfTest = newAgent(app, uri, method);

            await restOfTest
                .set('Origin', 'bad-origin')
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).to.have.length(0);
                });
        });
    }

    function badSessionToken(uri: string, method: Method) {
        it('should return BAD_REQUEST when there is no session token', async () => {
            const auth0Client = td.object({});
            const repository = td.object({});

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const restOfTest = newAgent(app, uri, method);

            await restOfTest
                .set('Origin', 'core')
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).has.length(0);
                });
        });

        it('should return BAD_REQUEST when the cookie session token is bad', async () => {
            const auth0Client = td.object({});
            const repository = td.object({});

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const restOfTest = newAgent(app, uri, method);

            await restOfTest
                .set('Cookie', `${SESSION_TOKEN_COOKIE_NAME}=badtoken`)
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionToken))) // Doesn't matter we have the good one here
                .set('Origin', 'core')
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).has.length(0);
                });
        });

        it('should return BAD_REQUEST when the header session token is bad', async () => {
            const auth0Client = td.object({});
            const repository = td.object({});

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const restOfTest = newAgent(app, uri, method);

            await restOfTest
                .set(SESSION_TOKEN_HEADER_NAME, 'bad token')
                .set('Origin', 'core')
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).has.length(0);
                });
        });
    }

    function badXsrfToken(uri: string, method: Method) {
        it('should return BAD_REQUEST when the xsrf token is missing', async () => {
            const auth0Client = td.object({});
            const repository = td.object({});

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const restOfTest = newAgent(app, uri, method);

            await restOfTest
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionToken)))
                .set('Origin', 'core')
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).has.length(0);
                });
        });

        it('should return BAD_REQUEST when the xsrf token is invalid', async () => {
            const auth0Client = td.object({});
            const repository = td.object({});

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const restOfTest = newAgent(app, uri, method);

            await restOfTest
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionToken)))
                .set(XSRF_TOKEN_HEADER_NAME, 'A BAD TOKEN')
                .set('Origin', 'core')
                .expect(HttpStatus.BAD_REQUEST)
                .then(response => {
                    expect(response.text).has.length(0);
                });
        })
    }

    function badRepository(uri: string, method: Method, repositoryTemplate: object, cases: Map<string, [Error, number]>) {
        for (let oneCase of Object.keys(cases)) {
            const methodName = Object.keys(repositoryTemplate)[0]
            const [error, statusCode] = (cases as any)[oneCase]; // sigh
            it(`should return ${oneCase}`, async () => {
                const auth0Client = td.object({});
                const repository = td.object(repositoryTemplate);

                const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
                const restOfTest = newAgent(app, uri, method);

                td.when((repository as any)[methodName](), { ignoreExtraArgs: true }).thenThrow(error);

                await (restOfTest as Test)
                    .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionToken)))
                    .set(XSRF_TOKEN_HEADER_NAME, theSession.xsrfToken)
                    .set('Origin', 'core')
                    .expect(statusCode)
                    .then(response => {
                        expect(response.text).to.have.length(0);
                    });
            });
        }
    }
});
