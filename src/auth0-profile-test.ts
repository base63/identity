import { expect } from 'chai'
import 'mocha'

import { Auth0Profile } from './auth0-profile'


describe('Auth0Profile', () => {
    it('should generate a hash', () => {
        const profile = new Auth0Profile();
        profile.userId = 'AAAA';
        expect(profile.getUserIdHash()).to.eql('63c1dd951ffedf6f7fd968ad4efa39b8ed584f162f46e715114ee184f8de9201');
    });
});
