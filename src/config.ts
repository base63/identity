import { readFileSync } from 'fs'
import { config } from 'dotenv'

import { Env, parseEnv, isLocal, isOnServer } from '@base63/common-js'
import { getFromEnv } from '@base63/common-server-js'

config();

export const NAME: string = 'identity';
export const ENV: Env = parseEnv(getFromEnv('ENV'));
export const ADDRESS: string = getFromEnv('ADDRESS');
export const PORT: number = parseInt(getFromEnv('PORT'), 10);
export const DATABASE_URL: string = getFromEnv('DATABASE_URL');
export const DATABASE_MIGRATIONS_DIR: string = getFromEnv('DATABASE_MIGRATIONS_DIR');
export const DATABASE_MIGRATIONS_TABLE: string = getFromEnv('DATABASE_MIGRATIONS_TABLE');
export const ORIGIN: string = getFromEnv('ORIGIN');
export const CLIENTS: string[] = getFromEnv('CLIENTS').split(',');

export let AUTH0_CLIENT_ID: string;
export let AUTH0_DOMAIN: string;
export let LOGGLY_TOKEN: string|null;
export let LOGGLY_SUBDOMAIN: string|null;
export let ROLLBAR_TOKEN: string|null;

if (isLocal(ENV)) {
    const secrets = JSON.parse(readFileSync(getFromEnv('SECRETS_PATH'), 'utf-8'));

    AUTH0_CLIENT_ID = secrets['AUTH0_CLIENT_ID'];
    AUTH0_DOMAIN = secrets['AUTH0_DOMAIN'];
} else {
    AUTH0_CLIENT_ID = getFromEnv('AUTH0_CLIENT_ID');
    AUTH0_DOMAIN = getFromEnv('AUTH0_DOMAIN');
}

if (isOnServer(ENV)) {
    LOGGLY_TOKEN = getFromEnv('LOGGLY_TOKEN');
    LOGGLY_SUBDOMAIN = getFromEnv('LOGGLY_SUBDOMAIN');
    ROLLBAR_TOKEN = getFromEnv('ROLLBAR_TOKEN');
} else {
    LOGGLY_TOKEN = null;
    LOGGLY_SUBDOMAIN = null;
    ROLLBAR_TOKEN = null;
}
