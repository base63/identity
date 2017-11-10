import * as auth0 from 'auth0'
import { wrap } from 'async-middleware'
import * as compression from 'compression'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'
import * as knex from 'knex'
import { ArrayOf, MarshalFrom } from 'raynor'
import * as r from 'raynor'

import { isLocal } from '@neoncity/common-js'
import {
    AuthInfoLevel,
    newAuthInfoMiddleware,
    newCheckOriginMiddleware,
    newCheckXsrfTokenMiddleware,
    newErrorsMiddleware,
    newJsonContentMiddleware,
    newLoggingMiddleware,
    newRequestTimeMiddleware,
    startupMigration
} from '@neoncity/common-server-js'
import {
    AuthInfo,
    AuthInfoAndSessionResponse,
    SessionResponse,
    UsersInfoResponse
} from '@neoncity/identity-sdk-js'

import { Auth0Profile } from './auth0-profile'
import { IdentityRequest } from './identity-request'
import * as config from './config'
import { Repository } from './repository'


async function main() {
    startupMigration();

    const app = express();
    const auth0Client = new auth0.AuthenticationClient({
        clientId: config.AUTH0_CLIENT_ID,
        domain: config.AUTH0_DOMAIN
    });
    const conn = knex({
        client: 'pg',
        connection: process.env.DATABASE_URL
    });
    const repository = new Repository(conn);

    const auth0ProfileMarshaller = new (MarshalFrom(Auth0Profile))();
    const authInfoAndSessionResponseMarshaller = new (MarshalFrom(AuthInfoAndSessionResponse))();
    const sessionResponseMarshaller = new (MarshalFrom(SessionResponse))();
    const usersInfoResponseMarshaller = new (MarshalFrom(UsersInfoResponse))();
    const idsMarshaller = new (ArrayOf(r.IdMarshaller))();

    app.disable('x-powered-by');
    app.use(newRequestTimeMiddleware());
    app.use(newCheckOriginMiddleware(config.CLIENTS));
    app.use(newJsonContentMiddleware());
    app.use(newLoggingMiddleware(config.NAME, config.ENV, config.LOGGLY_TOKEN, config.LOGGLY_SUBDOMAIN));
    app.use(newErrorsMiddleware(config.NAME, config.ENV, config.ROLLBAR_TOKEN));

    if (!isLocal(config.ENV)) {
        app.use(compression());
    }

    app.post('/session', newAuthInfoMiddleware(AuthInfoLevel.None), wrap(async (req: IdentityRequest, res: express.Response) => {
        try {
            const [authInfo, session, created] = await repository.getOrCreateSession(req.authInfo, req.requestTime);

            const authInfoAndSessionResponse = new AuthInfoAndSessionResponse();
            authInfoAndSessionResponse.authInfo = authInfo;
            authInfoAndSessionResponse.session = session;

            res.write(JSON.stringify(authInfoAndSessionResponseMarshaller.pack(authInfoAndSessionResponse)));
            res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
            res.end();
        } catch (e) {
            req.log.error(e);
            req.errorLog.error(e);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.end();
        }
    }));

    app.get('/session', newAuthInfoMiddleware(AuthInfoLevel.SessionId), wrap(async (req: IdentityRequest, res: express.Response) => {
        try {
            const session = await repository.getSession(req.authInfo as AuthInfo);

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

    app.delete('/session', [
        newAuthInfoMiddleware(AuthInfoLevel.SessionId),
        newCheckXsrfTokenMiddleware(true)
    ], wrap(async (req: IdentityRequest, res: express.Response) => {
        try {
            await repository.expireSession(req.authInfo as AuthInfo, req.requestTime, req.xsrfToken as string);

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

    app.post('/session/agree-to-cookie-policy', [
        newAuthInfoMiddleware(AuthInfoLevel.SessionId),
        newCheckXsrfTokenMiddleware(true)
    ], wrap(async (req: IdentityRequest, res: express.Response) => {
        try {
            const session = await repository.agreeToCookiePolicyForSession(req.authInfo as AuthInfo, req.requestTime, req.xsrfToken as string);

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

    app.post('/user', [
        newAuthInfoMiddleware(AuthInfoLevel.SessionIdAndAuth0AccessToken),
        newCheckXsrfTokenMiddleware(true)
    ], wrap(async (req: IdentityRequest, res: express.Response) => {
        let auth0Profile: Auth0Profile | null = null;
        try {
            const auth0AccessToken = (req.authInfo as AuthInfo).auth0AccessToken as string;
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
            const [authInfo, session, created] = await repository.getOrCreateUserOnSession(req.authInfo as AuthInfo, auth0Profile, req.requestTime, req.xsrfToken as string);

            const authInfoAndSessionResponse = new AuthInfoAndSessionResponse();
            authInfoAndSessionResponse.authInfo = authInfo;
            authInfoAndSessionResponse.session = session;

            res.write(JSON.stringify(authInfoAndSessionResponseMarshaller.pack(authInfoAndSessionResponse)));
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

    app.get('/user', newAuthInfoMiddleware(AuthInfoLevel.SessionIdAndAuth0AccessToken), wrap(async (req: IdentityRequest, res: express.Response) => {
        let auth0Profile: Auth0Profile | null = null;
        try {
            const auth0AccessToken = (req.authInfo as AuthInfo).auth0AccessToken as string;
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
            const session = await repository.getUserOnSession(req.authInfo as AuthInfo, auth0Profile);

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

    app.get('/users-info', newAuthInfoMiddleware(AuthInfoLevel.SessionId), wrap(async (req: IdentityRequest, res: express.Response) => {
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
            const usersInfo = await repository.getUsersInfo(req.authInfo as AuthInfo, ids);
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

    app.listen(config.PORT, config.ADDRESS, () => {
        console.log(`Started identity service on ${config.ADDRESS}:${config.PORT}`);
    });
}


main();
