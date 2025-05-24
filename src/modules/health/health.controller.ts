import { HealthService } from '@/modules/health/health.service';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
    constructor(private readonly healthService: HealthService) {}

    @Get()
    @ApiOperation({ summary: 'Health check endpoint' })
    @ApiResponse({ status: 200, description: 'Service is healthy' })
    check() {
        return this.healthService.getHealthStatus();
    }

    @Get('database')
    @ApiOperation({ summary: 'Database health check endpoint' })
    @ApiResponse({ status: 200, description: 'Database is healthy' })
    checkDatabase() {
        return this.healthService.getDatabaseHealthStatus();
    }
}
