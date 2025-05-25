// src/auth/strategies/facebook.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-facebook';
import { AuthService } from '../auth.service';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
    constructor(
        private readonly configService: ConfigService,
        private readonly authService: AuthService,
    ) {
        super({
            clientID: configService.get<string>('facebook.appID'),
            clientSecret: configService.get<string>('facebook.appSecret'),
            callbackURL: configService.get<string>('facebook.callbackURL'),
            scope: 'email', // Facebook permission for email
            profileFields: ['id', 'emails', 'name', 'picture'], // Fields to request
        });
    }

    async validate(
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: (error: any, user?: any, info?: any) => void,
    ): Promise<any> {
        const { name, emails, photos } = profile;
        if (!emails || emails.length === 0) {
            return done(new UnauthorizedException('Facebook account email not found.'), false);
        }

        const facebookUser = {
            name: name ? `${name.givenName} ${name.familyName}` : emails[0].value.split('@')[0],
            email: emails[0].value,
            picture: photos ? photos[0].value : null,
        };

        try {
            const user = await this.authService.validateOAuthLogin(facebookUser, 'FACEBOOK');
            done(null, user);
        } catch (error) {
            done(error, false);
        }
    }
}
