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
    SESSION_TOKEN_HEADER_NAME,
    XSRF_TOKEN_HEADER_NAME
} from '@base63/identity-sdk-js/client'
import { SessionAndTokenResponse, SessionResponse } from '@base63/identity-sdk-js/dtos'
import { PrivateUser, Role, Session, SessionState, UserState } from '@base63/identity-sdk-js/entities'
import { SessionToken } from '@base63/identity-sdk-js/session-token'

import { AppConfig, newApp } from './app'
import { Auth0Profile } from './auth0-profile'
import {
    Repository,
    SessionNotFoundError,
    UserNotFoundError,
    XsrfTokenMismatchError
} from './repository'


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
    const auth0ProfileMarshaller = new (MarshalFrom(Auth0Profile))();

    const theSessionToken = new SessionToken(uuid());

    const theSession = new Session();
    theSession.state = SessionState.Active;
    theSession.xsrfToken = ('0' as any).repeat(64);
    theSession.agreedToCookiePolicy = false;
    theSession.timeCreated = rightNow;
    theSession.timeLastUpdated = rightNow;

    const theSessionWithAgreement = new Session();
    theSessionWithAgreement.state = SessionState.Active;
    theSessionWithAgreement.xsrfToken = ('0' as any).repeat(64);
    theSessionWithAgreement.agreedToCookiePolicy = true;
    theSessionWithAgreement.timeCreated = rightNow;
    theSessionWithAgreement.timeLastUpdated = rightNow;

    const theSessionTokenWithUser = new SessionToken(uuid(), 'x0bjohntok');

    const theSessionWithUser = new Session();
    theSessionWithUser.state = SessionState.ActiveAndLinkedWithUser;
    theSessionWithUser.xsrfToken = ('0' as any).repeat(64);
    theSessionWithUser.agreedToCookiePolicy = false;
    theSessionWithUser.timeCreated = rightNow;
    theSessionWithUser.timeLastUpdated = rightNow;
    theSessionWithUser.user = new PrivateUser();
    theSessionWithUser.user.id = 1;
    theSessionWithUser.user.state = UserState.Active;
    theSessionWithUser.user.role = Role.Regular;
    theSessionWithUser.user.name = 'John Doe';
    theSessionWithUser.user.pictureUri = 'https://example.com/picture.jpg';
    theSessionWithUser.user.agreedToCookiePolicy = false;
    theSessionWithUser.user.language = 'en';
    theSessionWithUser.user.timeCreated = rightNow;
    theSessionWithUser.user.timeLastUpdated = rightNow;
    theSessionWithUser.user.userIdHash = ('f' as any).repeat(64);

    const auth0ProfileJohnDoe: Auth0Profile = new Auth0Profile();
    auth0ProfileJohnDoe.name = 'John Doe';
    auth0ProfileJohnDoe.picture = 'https://example.com/picture.jpg';
    auth0ProfileJohnDoe.userId = 'x0bjohn';
    auth0ProfileJohnDoe.language = 'en';

    it('can be constructed', () => {
        const auth0Client = td.object({});
        const repository = td.object({});

        const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);

        expect(app).is.not.null;
    });

    describe('/session POST', () => {
        it('should return the newly created session when there is no session information', async () => {
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

        it('should return an already existing session', async () => {
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
        it('should return an existing session', async () => {
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
        it('should succeed', async () => {
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

    describe('/session/agree-to-cookie-policy POST', () => {
        it('should succeed', async () => {
            const auth0Client = td.object({});
            const repository = td.object({
                agreeToCookiePolicyForSession: (_t: SessionToken, _d: Date, _x: string) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(repository.agreeToCookiePolicyForSession(theSessionToken, td.matchers.isA(Date), theSession.xsrfToken)).thenReturn(theSessionWithAgreement);

            await appAgent
                .post('/session/agree-to-cookie-policy')
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionToken)))
                .set(XSRF_TOKEN_HEADER_NAME, theSession.xsrfToken)
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.OK)
                .then(response => {
                    const result = sessionResponseMarshaller.extract(response.body);
                    expect(result.session).to.eql(theSessionWithAgreement);
                });
        });

        badOrigins('/session/agree-to-cookie-policy', 'post');
        badSessionToken('/session/agree-to-cookie-policy', 'post');
        badXsrfToken('/session/agree-to-cookie-policy', 'post');
        badRepository('/session/agree-to-cookie-policy', 'post', { agreeToCookiePolicyForSession: (_t: SessionToken, _d: Date, _x: string) => { } }, {
            'NOT_FOUND when the session is not present': [new SessionNotFoundError('Not found'), HttpStatus.NOT_FOUND],
            'NOT_FOUND when the user is not present': [new UserNotFoundError('Not found'), HttpStatus.NOT_FOUND],
            'BAD_REQUEST when the XSRF token is mismatched': [new XsrfTokenMismatchError('Invalid token'), HttpStatus.BAD_REQUEST],
            'INTERNAL_SERVER_ERROR when the repository errors': [new Error('An error occurred'), HttpStatus.INTERNAL_SERVER_ERROR]
        });
    });

    describe('/user POST', () => {
        it('should return a new user when there isn\'t one', async () => {
            const auth0Client = td.object({
                getProfile: (_t: string) => { }
            });
            const repository = td.object({
                getOrCreateUserOnSession: (_t: SessionToken, _a: Auth0Profile, _d: Date, _x: string) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(auth0Client.getProfile(theSessionTokenWithUser.userToken as string))
                .thenReturn(JSON.stringify(auth0ProfileMarshaller.pack(auth0ProfileJohnDoe)));
            td.when(repository.getOrCreateUserOnSession(theSessionTokenWithUser, auth0ProfileJohnDoe, td.matchers.isA(Date), theSessionWithUser.xsrfToken))
                .thenReturn([theSessionTokenWithUser, theSessionWithUser, true]);

            await appAgent
                .post('/user')
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionTokenWithUser)))
                .set(XSRF_TOKEN_HEADER_NAME, theSessionWithUser.xsrfToken)
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.CREATED)
                .then(response => {
                    const result = sessionAndTokenResponseMarshaller.extract(response.body);
                    expect(result.sessionToken).to.eql(theSessionTokenWithUser);
                    expect(result.session).to.eql(theSessionWithUser);
                });
        });

        it('should return an existing user when there is one', async () => {
            const auth0Client = td.object({
                getProfile: (_t: string) => { }
            });
            const repository = td.object({
                getOrCreateUserOnSession: (_t: SessionToken, _a: Auth0Profile, _d: Date, _x: string) => { }
            });

            const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
            const appAgent = agent(app);

            td.when(auth0Client.getProfile(theSessionTokenWithUser.userToken as string))
                .thenReturn(JSON.stringify(auth0ProfileMarshaller.pack(auth0ProfileJohnDoe)));
            td.when(repository.getOrCreateUserOnSession(theSessionTokenWithUser, auth0ProfileJohnDoe, td.matchers.isA(Date), theSessionWithUser.xsrfToken))
                .thenReturn([theSessionTokenWithUser, theSessionWithUser, false]);

            await appAgent
                .post('/user')
                .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionTokenWithUser)))
                .set(XSRF_TOKEN_HEADER_NAME, theSessionWithUser.xsrfToken)
                .set('Origin', 'core')
                .expect('Content-Type', 'application/json; charset=utf-8')
                .expect(HttpStatus.OK)
                .then(response => {
                    const result = sessionAndTokenResponseMarshaller.extract(response.body);
                    expect(result.sessionToken).to.eql(theSessionTokenWithUser);
                    expect(result.session).to.eql(theSessionWithUser);
                });
        });

        badOrigins('/user', 'post');
        badSessionToken('/user', 'post');
        badXsrfToken('/user', 'post');

        badAuth0('/user', 'post', {
            'UNAUTHORIZED when the token was not accepted': ['Unauthorized', HttpStatus.UNAUTHORIZED],
            'INTERNAL_SERVER_ERROR when the result could not be parsed': ['A bad response', HttpStatus.INTERNAL_SERVER_ERROR]
        });
        badRepository('/user', 'post', { getOrCreateUserOnSession: (_t: SessionToken, _a: Auth0Profile, _d: Date, _x: string) => { } }, {
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

        it('should return BAD_REQUEST when the session token is bad', async () => {
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

    function badAuth0(uri: string, method: Method, cases: Map<string, [string, number]>) {
        for (let oneCase of Object.keys(cases)) {
            const [getProfileResult, statusCode] = (cases as any)[oneCase]; // sigh
            it(`should return ${oneCase}`, async () => {
                const auth0Client = td.object({
                    getProfile: (_t: string) => { }
                });
                const repository = td.object({});

                const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
                const restOfTest = newAgent(app, uri, method);

                td.when(auth0Client.getProfile(theSessionTokenWithUser.userToken as string))
                    .thenReturn(getProfileResult);

                await restOfTest
                    .set(SESSION_TOKEN_HEADER_NAME, JSON.stringify(sessionTokenMarshaller.pack(theSessionTokenWithUser)))
                    .set(XSRF_TOKEN_HEADER_NAME, theSessionWithUser.xsrfToken)
                    .set('Origin', 'core')
                    .expect('Content-Type', 'application/json; charset=utf-8')
                    .expect(statusCode)
                    .then(response => {
                        expect(response.text).to.have.length(0);
                    });
            });
        }
    }

    function badRepository(uri: string, method: Method, repositoryTemplate: object, cases: Map<string, [Error, number]>) {
        for (let oneCase of Object.keys(cases)) {
            const methodName = Object.keys(repositoryTemplate)[0]
            const [error, statusCode] = (cases as any)[oneCase]; // sigh
            it(`should return ${oneCase}`, async () => {
                const auth0Client = td.object({
                    getProfile: (_t: string) => { }
                });
                const repository = td.object(repositoryTemplate);

                const app = newApp(localAppConfig, auth0Client as auth0.AuthenticationClient, repository as Repository);
                const restOfTest = newAgent(app, uri, method);

                td.when(auth0Client.getProfile(td.matchers.anything()))
                    .thenReturn(JSON.stringify(auth0ProfileMarshaller.pack(auth0ProfileJohnDoe)));
                td.when((repository as any)[methodName](), { ignoreExtraArgs: true }).thenThrow(error);

                await restOfTest
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
