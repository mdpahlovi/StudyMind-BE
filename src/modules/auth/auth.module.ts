import { AuthController } from '@/modules/auth/auth.controller';
import { AuthService } from '@/modules/auth/auth.service';
import { Module } from '@nestjs/common';
@Module({
    providers: [AuthService],
    controllers: [AuthController],
})
export class AuthModule {}
