/** Defines {@link Auth0Profile} */

/** Imports. Also so typedoc works correctly. */
import * as crypto from 'crypto'
import * as r from 'raynor'
import { MarshalWith, TryInOrder } from 'raynor'

import { LanguageFromLocaleMarshaller, LanguageMarshaller } from '@base63/common-js'


/**
 * The information about a user exposed by [Auth0]{@link https://auth0.com}.
 */
export class Auth0Profile {
    /** The full name of the user */
    @MarshalWith(r.StringMarshaller)
    name: string;

    /** An https Uri for a picture of the user */
    @MarshalWith(r.SecureWebUriMarshaller)
    picture: string;

    /** A unique user identifier */
    @MarshalWith(r.StringMarshaller, 'user_id')
    userId: string;

    /** The user's language code */
    @MarshalWith(TryInOrder(LanguageFromLocaleMarshaller, LanguageMarshaller), 'locale')
    language: string;

    /**
     * Compute a hash of the user's id for storage purposes.
     * @detail Uses the SHA256 of the {@link userId}.
     * @return A 64 characters length string representation of the hash.
     */
    getUserIdHash(): string {
        const sha256hash = crypto.createHash('sha256');
        sha256hash.update(this.userId);
        return sha256hash.digest('hex');
    }
}
