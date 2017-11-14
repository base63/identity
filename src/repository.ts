import * as knex from 'knex'
import { Marshaller, MarshalFrom } from 'raynor'
import * as uuid from 'uuid'

import { randomBytes } from 'crypto'

import {
    Role,
    PrivateUser,
    PublicUser,
    Session,
    SessionState,
    UserState
} from '@base63/identity-sdk-js'
import {
    SessionEventType,
    UserEventType
} from '@base63/identity-sdk-js/events'
import { SessionToken } from '@base63/identity-sdk-js/session-token'

import { Auth0Profile } from './auth0-profile'


export class RepositoryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RepositoryError';
    }
}


export class SessionNotFoundError extends RepositoryError {
    constructor(message: string) {
        super(message);
        this.name = 'SessionNotFoundError';
    }
}


export class XsrfTokenMismatchError extends RepositoryError {
    constructor(message: string) {
        super(message);
        this.name = 'XsrfTokenMismatchError';
    }
}


export class UserNotFoundError extends RepositoryError {
    constructor(message: string) {
        super(message);
        this.name = 'UserNotFoundError';
    }
}



export class Repository {
    public static readonly MAX_NUMBER_OF_USERS: number = 20;

    private static readonly _sessionFields = [
        'identity.session.id as session_id',
        'identity.session.state as session_state',
        'identity.session.xsrf_token as session_xsrf_token',
        'identity.session.agreed_to_cookie_policy as session_agreed_to_cookie_policy',
        'identity.session.user_id as session_user_id',
        'identity.session.time_created as session_time_created',
        'identity.session.time_last_updated as session_time_last_updated',
        'identity.session.time_removed as session_time_removed'
    ];

    private static readonly _userFields = [
        'identity.user.id as user_id',
        'identity.user.state as user_state',
        'identity.user.role as user_role',
        'identity.user.agreed_to_cookie_policy as user_agreed_to_cookie_policy',
        'identity.user.provider_user_id as user_provider_user_id',
        'identity.user.provider_user_id_hash as user_provider_user_id_hash',
        'identity.user.provider_profile as user_provider_profile',
        'identity.user.time_created as user_time_created',
        'identity.user.time_last_updated as user_time_last_updated',
        'identity.user.time_removed as user_time_removed'
    ];

    private readonly _conn: knex;
    private readonly _auth0ProfileMarshaller: Marshaller<Auth0Profile>;

    constructor(conn: knex) {
        this._conn = conn;
        this._auth0ProfileMarshaller = new (MarshalFrom(Auth0Profile))();
    }

    async getOrCreateSession(sessionToken: SessionToken | null, requestTime: Date): Promise<[SessionToken, Session, boolean]> {
        let dbSession: any | null = null;
        let needToCreateSession = sessionToken == null;

        await this._conn.transaction(async (trx) => {
            // If there's some auth info, might as well try to retrieve it.
            if (sessionToken != null) {
                const dbSessions = await trx
                    .from('identity.session')
                    .select(Repository._sessionFields)
                    .whereIn('state', [SessionState.Active, SessionState.ActiveAndLinkedWithUser])
                    .andWhere('id', sessionToken.sessionId)
                    .limit(1);

                // If we can't retrieve it we need to create a new session.
                if (dbSessions.length == 0) {
                    needToCreateSession = true;
                } else {
                    dbSession = dbSessions[0];
                }
            }

            // If we've determined we need to create a session, we should do so.
            if (needToCreateSession) {
                const sessionId = uuid();
                const xsrfToken = randomBytes(48).toString('base64');

                const dbSessions = await trx
                    .from('identity.session')
                    .returning(Repository._sessionFields)
                    .insert({
                        'id': sessionId,
                        'state': SessionState.Active,
                        'xsrf_token': xsrfToken,
                        'agreed_to_cookie_policy': false,
                        'user_id': null,
                        'time_created': requestTime,
                        'time_last_updated': requestTime,
                        'time_removed': null
                    });

                dbSession = dbSessions[0];

                await trx
                    .from('identity.session_event')
                    .insert({
                        'type': SessionEventType.Created,
                        'timestamp': requestTime,
                        'data': null,
                        'session_id': sessionId
                    });
            }
        });

        const newSessionToken = new SessionToken(dbSession['session_id']);
        return [newSessionToken, Repository._dbSessionToSession(dbSession), needToCreateSession];
    }

    async getSession(sessionToken: SessionToken): Promise<Session> {
        const dbSessions = await this._conn('identity.session')
            .select(Repository._sessionFields)
            .whereIn('state', [SessionState.Active, SessionState.ActiveAndLinkedWithUser])
            .andWhere('id', sessionToken.sessionId)
            .limit(1);

        if (dbSessions.length == 0) {
            throw new SessionNotFoundError('Session does not exist');
        }

        const dbSession = dbSessions[0];

        return Repository._dbSessionToSession(dbSession);
    }

    async expireSession(sessionToken: SessionToken, requestTime: Date, xsrfToken: string): Promise<void> {
        await this._conn.transaction(async (trx) => {
            const dbSessions = await trx
                .from('identity.session')
                .whereIn('state', [SessionState.Active, SessionState.ActiveAndLinkedWithUser])
                .andWhere('id', sessionToken.sessionId)
                .returning(['id', 'xsrf_token'])
                .update({
                    'state': SessionState.Removed,
                    'time_last_updated': requestTime,
                    'time_removed': requestTime
                });

            if (dbSessions.length == 0) {
                throw new SessionNotFoundError('Session does not exist');
            }

            const dbSession = dbSessions[0];

            if (dbSession['xsrf_token'] != xsrfToken) {
                throw new XsrfTokenMismatchError('XSRF tokens do not match');
            }

            await trx
                .from('identity.session_event')
                .insert({
                    'type': SessionEventType.Removed,
                    'timestamp': requestTime,
                    'data': null,
                    'session_id': sessionToken.sessionId
                });
        });
    }

    async agreeToCookiePolicyForSession(sessionToken: SessionToken, requestTime: Date, xsrfToken: string): Promise<Session> {
        let dbSession: any | null = null;

        await this._conn.transaction(async (trx) => {
            const dbSessions = await trx
                .from('identity.session')
                .whereIn('state', [SessionState.Active, SessionState.ActiveAndLinkedWithUser])
                .andWhere('id', sessionToken.sessionId)
                .returning(Repository._sessionFields)
                .update({
                    'agreed_to_cookie_policy': true,
                    'time_last_updated': requestTime
                });

            if (dbSessions.length == 0) {
                throw new SessionNotFoundError('Session does not exist');
            }

            dbSession = dbSessions[0];

            if (dbSession['session_xsrf_token'] != xsrfToken) {
                throw new XsrfTokenMismatchError('XSRF tokens do not match');
            }

            await trx
                .from('identity.session_event')
                .insert({
                    'type': SessionEventType.AgreedToCookiePolicy,
                    'timestamp': requestTime,
                    'data': null,
                    'session_id': sessionToken.sessionId
                });

            if (dbSession['session_user_id'] != null) {
                const dbUsers = await trx
                    .from('identity.user')
                    .where({ id: dbSession['session_user_id'], state: UserState.Active })
                    .returning(Repository._userFields)
                    .update({
                        'agreed_to_cookie_policy': true,
                        'time_last_updated': requestTime
                    });

                if (dbUsers.length == 0) {
                    throw new UserNotFoundError('User does not exist');
                }

                await trx
                    .from('identity.user_event')
                    .insert({
                        'type': UserEventType.AgreedToCookiePolicy,
                        'timestamp': requestTime,
                        'data': null,
                        'user_id': dbSession['session_user_id']
                    });
            }
        });

        return Repository._dbSessionToSession(dbSession);
    }

    async getOrCreateUserOnSession(sessionToken: SessionToken, auth0Profile: Auth0Profile, requestTime: Date, xsrfToken: string): Promise<[SessionToken, Session, boolean]> {
        const userId = auth0Profile.userId;
        const userIdHash = auth0Profile.getUserIdHash();

        let dbSession: any | null = null;
        let dbUserId: number = -1;
        let dbUserTimeCreated: Date = new Date();
        let dbUserAgreedToCookiePolicy: boolean = false;
        let userEventType: UserEventType = UserEventType.Unknown;

        await this._conn.transaction(async (trx) => {
            const dbSessions = await trx
                .from('identity.session')
                .select(Repository._sessionFields)
                .whereIn('state', [SessionState.Active, SessionState.ActiveAndLinkedWithUser])
                .andWhere('id', sessionToken.sessionId)
                .limit(1);

            if (dbSessions.length == 0) {
                throw new SessionNotFoundError('Session does not exist');
            }

            dbSession = dbSessions[0];

            if (dbSession['session_xsrf_token'] != xsrfToken) {
                throw new XsrfTokenMismatchError('XSRF tokens do not match');
            }

            const rawResponse = await trx.raw(`
                    insert into identity.user (state, role, agreed_to_cookie_policy, provider_user_id, provider_user_id_hash, provider_profile, time_created, time_last_updated)
                    values (?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (provider_user_id_hash)
                    do update
                    set time_last_updated = excluded.time_last_updated,
                        state=${UserState.Active},
                        agreed_to_cookie_policy = identity.user.agreed_to_cookie_policy OR excluded.agreed_to_cookie_policy,
                        provider_profile = excluded.provider_profile
                    returning id, time_created, agreed_to_cookie_policy`,
                [UserState.Active, Role.Regular, dbSession['session_agreed_to_cookie_policy'], userId, userIdHash, this._auth0ProfileMarshaller.pack(auth0Profile), requestTime, requestTime]);

            dbUserId = rawResponse.rows[0]['id'];
            dbUserTimeCreated = rawResponse.rows[0]['time_created'];
            dbUserAgreedToCookiePolicy = rawResponse.rows[0]['agreed_to_cookie_policy'];

            if (dbSession['session_user_id'] != null && dbSession['session_user_id'] != dbUserId) {
                throw new SessionNotFoundError('Session associated with another user already');
            }

            userEventType = rawResponse.rows[0]['time_created'] == rawResponse.rows[0]['time_last_updated']
                ? UserEventType.Created
                : UserEventType.Recreated;

            await trx
                .from('identity.user_event')
                .insert({
                    'type': userEventType,
                    'timestamp': requestTime,
                    'data': null,
                    'user_id': dbUserId
                });

            if (userEventType == UserEventType.Created && dbUserAgreedToCookiePolicy == true) {
                await trx
                    .from('identity.user_event')
                    .insert({
                        'type': UserEventType.AgreedToCookiePolicy,
                        'timestamp': requestTime,
                        'data': null,
                        'user_id': dbUserId
                    });
            } else if (userEventType == UserEventType.Recreated && dbUserAgreedToCookiePolicy == true) {
                const hasEventRaw = await trx.raw(`select count(*) as has_event from identity.user_event where user_id=? and type=${UserEventType.AgreedToCookiePolicy}`, [dbUserId]);

                if (hasEventRaw.rows[0]['has_event'] == 0) {
                    await trx
                        .from('identity.user_event')
                        .insert({
                            'type': UserEventType.AgreedToCookiePolicy,
                            'timestamp': requestTime,
                            'data': null,
                            'user_id': dbUserId
                        });
                }
            }

            if (dbSession['session_user_id'] == null) {
                await trx
                    .from('identity.session')
                    .where({ id: sessionToken.sessionId })
                    .update({
                        state: SessionState.ActiveAndLinkedWithUser,
                        agreed_to_cookie_policy: dbUserAgreedToCookiePolicy,
                        user_id: dbUserId,
                        time_last_updated: requestTime
                    });

                await trx
                    .from('identity.session_event')
                    .insert({
                        'type': SessionEventType.LinkedWithUser,
                        'timestamp': requestTime,
                        'data': null,
                        'session_id': dbSession['session_id']
                    });

                if (dbUserAgreedToCookiePolicy != dbSession['session_agreed_to_cookie_policy']) {
                    await trx
                        .from('identity.session_event')
                        .insert({
                            'type': SessionEventType.AgreedToCookiePolicy,
                            'timestamp': requestTime,
                            'data': null,
                            'session_id': sessionToken.sessionId
                        });
                }
            }
        });

        const session = new Session();
        session.state = SessionState.Active;
        session.xsrfToken = dbSession['session_xsrf_token'];
        session.agreedToCookiePolicy = dbSession['session_agreed_to_cookie_policy'];
        session.user = new PrivateUser();
        session.user.id = dbUserId;
        session.user.state = UserState.Active;
        session.user.role = Role.Regular;
        session.user.name = auth0Profile.name;
        session.user.pictureUri = auth0Profile.picture;
        session.user.language = auth0Profile.language;
        session.user.timeCreated = dbUserTimeCreated;
        session.user.timeLastUpdated = requestTime;
        session.user.agreedToCookiePolicy = dbUserAgreedToCookiePolicy;
        session.user.userIdHash = userIdHash;
        session.timeCreated = dbSession['session_time_created'];
        session.timeLastUpdated = dbSession['session_time_last_updated'];

        return [sessionToken, session, userEventType as UserEventType == UserEventType.Created as UserEventType];
    }

    async getUserOnSession(sessionToken: SessionToken, auth0Profile: Auth0Profile): Promise<Session> {
        const userIdHash = auth0Profile.getUserIdHash();

        // Lookup id hash in database
        const dbUsers = await this._conn('identity.user')
            .select(Repository._userFields)
            .where({ provider_user_id_hash: userIdHash, state: UserState.Active })
            .limit(1);

        if (dbUsers.length == 0) {
            throw new UserNotFoundError('User does not exist');
        }

        const dbUser = dbUsers[0];

        const dbSessions = await this._conn('identity.session')
            .select(Repository._sessionFields)
            .where('state', SessionState.ActiveAndLinkedWithUser)
            .andWhere('id', sessionToken.sessionId)
            .limit(1);

        if (dbSessions.length == 0) {
            throw new SessionNotFoundError('Session does not exist');
        }

        const dbSession = dbSessions[0];

        if (dbSession['session_user_id'] != dbUser['user_id']) {
            throw new SessionNotFoundError('Session and user do not match');
        }

        return Repository._dbSessionToSession(dbSession, dbUser, auth0Profile);
    }

    async getUsersInfo(_sessionToken: SessionToken, ids: number[]): Promise<PublicUser[]> {
        if (ids.length > Repository.MAX_NUMBER_OF_USERS) {
            throw new RepositoryError(`Can't retrieve ${ids.length} users`);
        }

        const dbUsers = await this._conn('identity.user')
            .select(Repository._userFields)
            .whereIn('id', ids)
            .andWhere({ state: UserState.Active })
            .limit(Repository.MAX_NUMBER_OF_USERS);

        if (dbUsers.length != ids.length) {
            throw new UserNotFoundError(`Looking for ids ${JSON.stringify(ids)} but got ${JSON.stringify(dbUsers.map((u: any) => u['user_id']))}`);
        }


        return dbUsers.map((dbU: any) => this._dbUserToPublicUser(dbU));
    }

    static _dbSessionToSession(dbSession: any, dbUser: any | null = null, auth0Profile: Auth0Profile | null = null): Session {
        const session = new Session();
        session.state = dbSession['session_state'];
        session.xsrfToken = dbSession['session_xsrf_token'];
        session.agreedToCookiePolicy = dbSession['session_agreed_to_cookie_policy'];
        session.user = dbUser != null && auth0Profile != null
            ? (() => {
                const user = new PrivateUser();
                user.id = dbUser['user_id'];
                user.state = dbUser['user_state'];
                user.role = dbUser['user_role'];
                user.name = auth0Profile.name;
                user.pictureUri = auth0Profile.picture;
                user.language = auth0Profile.language;
                user.timeCreated = new Date(dbUser['user_time_created']);
                user.timeLastUpdated = new Date(dbUser['user_time_last_updated']);
                user.agreedToCookiePolicy = dbUser['user_agreed_to_cookie_policy'];
                user.userIdHash = dbUser['user_provider_user_id_hash'];
                return user;
            })()
            : null;
        session.timeCreated = dbSession['session_time_created'];
        session.timeLastUpdated = dbSession['session_time_last_updated'];

        return session;
    }

    _dbUserToPublicUser(dbUser: any): PublicUser {
        const auth0Profile = this._auth0ProfileMarshaller.extract(dbUser['user_provider_profile']);

        const user = new PublicUser();
        user.id = dbUser['user_id'];
        user.state = dbUser['user_state'];
        user.role = dbUser['user_role'];
        user.name = auth0Profile.name;
        user.pictureUri = auth0Profile.picture;
        user.language = auth0Profile.language;
        user.timeCreated = new Date(dbUser['user_time_created']);
        user.timeLastUpdated = new Date(dbUser['user_time_last_updated']);
        return user;
    }
}
