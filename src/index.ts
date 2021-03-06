import * as auth0 from 'auth0'
import * as express from 'express'
import * as knex from 'knex'

import * as config from './config'
import { newIdentityRouter } from './identity-router'
import { Repository } from './repository'


async function main() {
    const auth0Client = new auth0.AuthenticationClient({
        clientId: config.AUTH0_CLIENT_ID,
        domain: config.AUTH0_DOMAIN
    });
    const conn = knex({
        client: 'pg',
        connection: config.DATABASE_URL
    });
    const repository = new Repository(conn);
    await repository.init();

    const identityRouter = newIdentityRouter({
        env: config.ENV,
        name: config.NAME,
        clients: config.CLIENTS,
        forceDisableLogging: false,
        logglyToken: config.LOGGLY_TOKEN,
        logglySubdomain: config.LOGGLY_SUBDOMAIN,
        rollbarToken: config.ROLLBAR_TOKEN
    }, auth0Client, repository);

    const app = express();
    app.disable('x-powered-by');
    app.use('/', identityRouter);
    app.listen(config.PORT, config.ADDRESS, () => {
        console.log(`Started ${config.NAME} service on ${config.ADDRESS}:${config.PORT}`);
    });
}


main();
