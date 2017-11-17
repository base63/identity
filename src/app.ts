import * as auth0 from 'auth0'
import { wrap } from 'async-middleware'
import * as cookieParser from 'cookie-parser'
import * as compression from 'compression'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'
import { ArrayOf, MarshalFrom } from 'raynor'
import * as r from 'raynor'

import { Env, isLocal } from '@base63/common-js'
import {
    newCommonApiServerMiddleware,
    newCommonServerMiddleware,
    newLocalCommonServerMiddleware,
    Request
} from '@base63/common-server-js'
import { XsrfTokenMarshaller } from '@base63/identity-sdk-js/entities'
import {
    SESSION_TOKEN_COOKIE_NAME,
    SESSION_TOKEN_HEADER_NAME,
    XSRF_TOKEN_HEADER_NAME
} from '@base63/identity-sdk-js/client'
import {
    SessionAndTokenResponse,
    SessionResponse,
    UsersInfoResponse
} from '@base63/identity-sdk-js/dtos'
import {
    SessionToken
} from '@base63/identity-sdk-js/session-token'

import { Auth0Profile } from './auth0-profile'
import { Repository } from './repository'


export interface AppConfig {
    env: Env;
    name: string;
    clients: string[];
    forceDisableLogging: boolean;
    logglyToken: string | null;
    logglySubdomain: string | null;
    rollbarToken: string | null;
}


export function newApp(
    config: AppConfig,
    auth0Client: auth0.AuthenticationClient,
    repository: Repository): express.Express {
    const sessionTokenMarshaller = new (MarshalFrom(SessionToken))();
    const xsrfTokenMarshaller = new XsrfTokenMarshaller();
    const auth0ProfileMarshaller = new (MarshalFrom(Auth0Profile))();
    const sessionAndTokenResponseMarshaller = new (MarshalFrom(SessionAndTokenResponse))();
    const sessionResponseMarshaller = new (MarshalFrom(SessionResponse))();
    const usersInfoResponseMarshaller = new (MarshalFrom(UsersInfoResponse))();
    const idsMarshaller = new (ArrayOf(r.IdMarshaller))();

    const app = express();

    app.disable('x-powered-by');
    app.use(cookieParser());
    if (isLocal(config.env)) {
        app.use(newLocalCommonServerMiddleware(config.name, config.env, config.forceDisableLogging));
    } else {
        app.use(newCommonServerMiddleware(
            config.name,
            config.env,
            config.logglyToken as string,
            config.logglySubdomain as string,
            config.rollbarToken as string));
        app.use(compression());
    }
    app.use(newCommonApiServerMiddleware(config.clients));

    app.post('/session', wrap(async (req: Request, res: express.Response) => {
        const currentSessionToken = extractSessionToken(req);

        try {
            const [sessionToken, session, created] = await repository.getOrCreateSession(currentSessionToken, req.requestTime);

            const sessionAndTokenResponse = new SessionAndTokenResponse();
            sessionAndTokenResponse.sessionToken = sessionToken;
            sessionAndTokenResponse.session = session;

            res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
            res.write(JSON.stringify(sessionAndTokenResponseMarshaller.pack(sessionAndTokenResponse)));
            res.end();
        } catch (e) {
            req.log.error(e);
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
        }
    }));

    app.get('/session', wrap(async (req: Request, res: express.Response) => {
        const currentSessionToken = extractSessionToken(req);
        if (currentSessionToken == null) {
            req.log.warn('Expected a session token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        try {
            const session = await repository.getSession(currentSessionToken);

            const sessionResponse = new SessionResponse();
            sessionResponse.session = session;

            res.write(JSON.stringify(sessionResponseMarshaller.pack(sessionResponse)));
            res.status(HttpStatus.OK);
            res.end();
        } catch (e) {
            if (e.name == 'SessionNotFoundError') {
                res.status(HttpStatus.NOT_FOUND);
                res.end();
                return;
            }

            req.log.error(e);
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
        }
    }));

    app.delete('/session', wrap(async (req: Request, res: express.Response) => {
        const currentSessionToken = extractSessionToken(req);
        if (currentSessionToken == null) {
            req.log.warn('Expected a session token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        const xsrfToken = extractXsrfToken(req);
        if (xsrfToken == null) {
            req.log.warn('Expected a XSRF token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        try {
            await repository.removeSession(currentSessionToken, req.requestTime, xsrfToken);

            res.status(HttpStatus.NO_CONTENT);
            res.end();
        } catch (e) {
            if (e.name == 'SessionNotFoundError') {
                res.status(HttpStatus.NOT_FOUND);
                res.end();
                return;
            }

            if (e.name == 'XsrfTokenMismatchError') {
                res.status(HttpStatus.BAD_REQUEST);
                res.end();
                return;
            }

            req.log.error(e);
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
        }
    }));

    app.post('/session/agree-to-cookie-policy', wrap(async (req: Request, res: express.Response) => {
        const currentSessionToken = extractSessionToken(req);
        if (currentSessionToken == null) {
            req.log.warn('Expected a session token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        const xsrfToken = extractXsrfToken(req);
        if (xsrfToken == null) {
            req.log.warn('Expected a XSRF token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        try {
            const session = await repository.agreeToCookiePolicyForSession(currentSessionToken, req.requestTime, xsrfToken);

            const sessionResponse = new SessionResponse();
            sessionResponse.session = session;

            res.write(JSON.stringify(sessionResponseMarshaller.pack(sessionResponse)));
            res.status(HttpStatus.OK);
            res.end();
        } catch (e) {
            if (e.name == 'SessionNotFoundError') {
                res.status(HttpStatus.NOT_FOUND);
                res.end();
                return;
            }

            if (e.name == 'UserNotFoundError') {
                res.status(HttpStatus.NOT_FOUND);
                res.end();
                return;
            }

            if (e.name == 'XsrfTokenMismatchError') {
                res.status(HttpStatus.BAD_REQUEST);
                res.end();
                return;
            }

            req.log.error(e);
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
        }
    }));

    app.post('/user', wrap(async (req: Request, res: express.Response) => {
        const currentSessionToken = extractSessionToken(req);
        if (currentSessionToken == null) {
            req.log.warn('Expected a session token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        const xsrfToken = extractXsrfToken(req);
        if (xsrfToken == null) {
            req.log.warn('Expected a XSRF token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        let auth0Profile: Auth0Profile | null = null;
        try {
            const auth0AccessToken = currentSessionToken.userToken as string;
            const auth0ProfileSerialized = await auth0Client.getProfile(auth0AccessToken);

            if (auth0ProfileSerialized == 'Unauthorized') {
                req.log.warn('Token was not accepted by Auth0');
                res.status(HttpStatus.UNAUTHORIZED);
                res.end();
                return;
            }

            auth0Profile = auth0ProfileMarshaller.extract(JSON.parse(auth0ProfileSerialized));
        } catch (e) {
            req.log.error(e, 'Auth0 Error');
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
            return;
        }

        try {
            const [sessionToken, session, created] = await repository.getOrCreateUserOnSession(currentSessionToken, auth0Profile, req.requestTime, xsrfToken);

            const sessionTokenAndSessionResponse = new SessionAndTokenResponse();
            sessionTokenAndSessionResponse.sessionToken = sessionToken;
            sessionTokenAndSessionResponse.session = session;

            res.write(JSON.stringify(sessionAndTokenResponseMarshaller.pack(sessionTokenAndSessionResponse)));
            res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
            res.end();
        } catch (e) {
            if (e.name == 'SessionNotFoundError') {
                res.status(HttpStatus.NOT_FOUND);
                res.end();
                return;
            }

            if (e.name == 'XsrfTokenMismatchError') {
                res.status(HttpStatus.BAD_REQUEST);
                res.end();
                return;
            }

            req.log.error(e);
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
        }
    }));

    app.get('/user', wrap(async (req: Request, res: express.Response) => {
        const currentSessionToken = extractSessionToken(req);
        if (currentSessionToken == null) {
            req.log.warn('Expected a session token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        let auth0Profile: Auth0Profile | null = null;
        try {
            const auth0AccessToken = currentSessionToken.userToken as string;
            const auth0ProfileSerialized = await auth0Client.getProfile(auth0AccessToken);

            if (auth0ProfileSerialized == 'Unauthorized') {
                req.log.warn('Token was not accepted by Auth0');
                res.status(HttpStatus.UNAUTHORIZED);
                res.end();
                return;
            }

            auth0Profile = auth0ProfileMarshaller.extract(JSON.parse(auth0ProfileSerialized));
        } catch (e) {
            req.log.error(e, 'Auth0 Error');
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
            return;
        }

        try {
            const session = await repository.getUserOnSession(currentSessionToken, auth0Profile);

            const sessionResponse = new SessionResponse();
            sessionResponse.session = session;

            res.write(JSON.stringify(sessionResponseMarshaller.pack(sessionResponse)));
            res.status(HttpStatus.CREATED);
            res.end();
        } catch (e) {
            if (e.name == 'UserNotFoundError') {
                res.status(HttpStatus.NOT_FOUND);
                res.end();
                return;
            }

            if (e.name == 'SessionNotFoundError') {
                res.status(HttpStatus.NOT_FOUND);
                res.end();
                return;
            }

            req.log.error(e);
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
        }
    }));

    app.get('/users-info', wrap(async (req: Request, res: express.Response) => {
        const currentSessionToken = extractSessionToken(req);
        if (currentSessionToken == null) {
            req.log.warn('Expected a session token to exist');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        if (req.query.ids === undefined) {
            req.log.warn('Missing required "ids" parameter');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        let ids: number[] | null = null;
        try {
            ids = idsMarshaller.extract(JSON.parse(decodeURIComponent(req.query.ids)));
        } catch (e) {
            req.log.warn('Could not decode "ids" parameter');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        if (ids.length > Repository.MAX_NUMBER_OF_USERS) {
            req.log.warn(`Can't retrieve ${ids.length} users`);
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        try {
            const usersInfo = await repository.getUsersInfo(ids);
            const usersInfoResponse = new UsersInfoResponse();
            usersInfoResponse.usersInfo = usersInfo;

            res.write(JSON.stringify(usersInfoResponseMarshaller.pack(usersInfoResponse)));
            res.status(HttpStatus.OK);
            res.end();
        } catch (e) {
            if (e.name == 'UserNotFoundError') {
                res.status(HttpStatus.NOT_FOUND);
                res.end();
                return;
            }

            req.log.error(e);
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
        }
    }));

    function extractSessionToken(req: Request): SessionToken | null {
        let sessionTokenSerialized: string | null = null;

        if (req.cookies[SESSION_TOKEN_COOKIE_NAME] != undefined) {
            sessionTokenSerialized = req.cookies[SESSION_TOKEN_COOKIE_NAME];
        } else if (req.header(SESSION_TOKEN_HEADER_NAME) != undefined) {
            sessionTokenSerialized = req.header(SESSION_TOKEN_HEADER_NAME) as string;
        } else {
            return null;
        }

        try {
            return sessionTokenMarshaller.extract(JSON.parse(sessionTokenSerialized as string));
        } catch (e) {
            console.log(e);
            return null;
        }
    }

    function extractXsrfToken(req: Request): string | null {
        try {
            const xsrfTokenRaw = req.header(XSRF_TOKEN_HEADER_NAME);
            return xsrfTokenMarshaller.extract(xsrfTokenRaw);
        } catch (e) {
            return null;
        }
    }

    return app;
}
