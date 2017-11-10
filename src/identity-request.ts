import { Request } from '@neoncity/common-server-js'

import { Auth0Profile } from './auth0-profile'


export interface IdentityRequest extends Request {
    auth0Profile: Auth0Profile;
}
