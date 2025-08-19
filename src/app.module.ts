import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { CommonModule } from '@/common/common.module';
import configuration from '@/config/configuration';
import { DatabaseModule } from '@/database/database.module';
import { AuthGuard } from '@/guards/auth.guard';
import { AuthModule } from '@/modules/auth/auth.module';
import { ChatModule } from '@/modules/chat/chat.module';
import { HealthModule } from '@/modules/health/health.module';
import { LibraryModule } from '@/modules/library/library.module';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

@Module({
    imports: [
        HttpModule.register({
            global: true,
        }),
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            envFilePath: '.env',
        }),
        JwtModule.register({
            global: true,
            secret: configuration().jwt.secret,
        }),
        DatabaseModule,
        CommonModule,
        HealthModule,
        AuthModule,
        LibraryModule,
        ChatModule,
    ],
    controllers: [AppController],
    providers: [AppService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
