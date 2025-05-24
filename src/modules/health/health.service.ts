import { DatabaseService } from '@/database/database.service';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HealthService {
    constructor(
        private configService: ConfigService,
        private databaseService: DatabaseService,
    ) {}

    getHealthStatus() {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: this.configService.get<string>('nodeEnv'),
            version: this.configService.get<string>('appVersion'),
        };
    }

    async getDatabaseHealthStatus() {
        const isDatabaseHealthy = await this.databaseService.isHealthy();

        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: this.configService.get<string>('nodeEnv'),
            version: this.configService.get<string>('appVersion'),
            database: {
                status: isDatabaseHealthy ? 'ok' : 'down',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
            },
        };
    }
}
