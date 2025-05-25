import { AuthController } from '@/modules/auth/auth.controller';
import { AuthService } from '@/modules/auth/auth.service';
import { FacebookStrategy } from '@/modules/auth/strategies/facebook.strategy';
import { GoogleStrategy } from '@/modules/auth/strategies/google.strategy';
import { Module } from '@nestjs/common';
@Module({
    providers: [AuthService, GoogleStrategy, FacebookStrategy],
    controllers: [AuthController],
})
export class AuthModule {}
