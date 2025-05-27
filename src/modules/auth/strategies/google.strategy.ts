import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor(
        private readonly configService: ConfigService,
        private readonly authService: AuthService,
    ) {
        super({
            clientID: configService.get<string>('google.clientID'),
            clientSecret: configService.get<string>('google.clientSecret'),
            callbackURL: configService.get<string>('google.callbackURL'),
            scope: ['email', 'profile'],
        });
    }

    async validate(accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) {
        const { name, emails, photos } = profile;
        if (!emails || emails.length === 0) {
            return done(new NotFoundException('Google account email not found.'), false);
        }

        const googleUser = {
            name: name ? `${name.givenName} ${name.familyName}` : emails[0].value.split('@')[0],
            email: emails[0].value,
            picture: photos ? photos[0].value : null,
        };

        try {
            const user = await this.authService.validateOAuthLogin(googleUser, 'GOOGLE');
            done(null, user);
        } catch (error) {
            done(error, false);
        }
    }
}
