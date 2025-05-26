import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { CommonModule } from '@/common/common.module';
import configuration from '@/config/configuration';
import { DatabaseModule } from '@/database/database.module';
import { AuthGuard } from '@/guards/auth.guard';
import { AuthModule } from '@/modules/auth/auth.module';
import { HealthModule } from '@/modules/health/health.module';
import { LibraryModule } from '@/modules/library/library.module';
import { UserModule } from '@/modules/user/user.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            envFilePath: '.env',
        }),
        JwtModule.register({
            global: true,
            secret: configuration().jwt.secret,
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        DatabaseModule,
        CommonModule,
        HealthModule,
        UserModule,
        AuthModule,
        LibraryModule,
    ],
    controllers: [AppController],
    providers: [AppService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
