import * as auth0 from 'auth0'
import { expect } from 'chai'
import 'mocha'
import * as td from 'testdouble'

import { Env } from '@base63/common-js'

import { AppConfig, newApp } from './app'
import { Repository } from './repository'


describe('App', () => {
    const config: AppConfig = {
        env: Env.Local,
        name: 'identity',
        clients: ['core'],
        logglyToken: null,
        logglySubdomain: null,
        rollbarToken: null
    };

    it('can be constructed', () => {
        const auth0Client = td.object({});
        const repository = td.object({});

        const app = newApp(config, auth0Client as auth0.AuthenticationClient, repository as Repository);

        expect(app).is.not.null;
    });
});
