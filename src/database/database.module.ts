import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schemas';

export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');

@Global()
@Module({
    providers: [
        {
            provide: DATABASE_CONNECTION,
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => {
                const databaseUrl = configService.get<string>('database.url');

                if (!databaseUrl) {
                    throw new Error('DATABASE_URL is not defined');
                }

                const client = postgres(databaseUrl);
                return drizzle(client, { schema });
            },
        },
    ],
    exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
