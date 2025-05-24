import { HealthController } from '@/modules/health/health.controller';
import { HealthService } from '@/modules/health/health.service';
import { Module } from '@nestjs/common';

@Module({
    controllers: [HealthController],
    providers: [HealthService],
})
export class HealthModule {}
