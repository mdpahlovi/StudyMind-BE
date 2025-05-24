import { DatabaseService } from '@/database/database.service';
import * as schema from '@/database/schemas';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export const DrizzleProvider = 'DrizzleProvider';

@Global()
@Module({
    providers: [
        {
            provide: DrizzleProvider,
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => {
                const databaseUrl = configService.get<string>('database.url');

                if (!databaseUrl) {
                    throw new Error('DATABASE_URL is not defined');
                }

                const pool = new Pool({ connectionString: databaseUrl });

                return drizzle(pool, { schema }) as NodePgDatabase<typeof schema>;
            },
        },
        DatabaseService,
    ],
    exports: [DrizzleProvider, DatabaseService],
})
export class DatabaseModule {}
