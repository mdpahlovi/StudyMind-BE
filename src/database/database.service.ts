import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schemas';

export const DrizzleProvider = 'DrizzleProvider';

@Injectable()
export class DatabaseService {
    constructor(
        @Inject(DrizzleProvider)
        private readonly db: NodePgDatabase<typeof schema>,
    ) {}

    get database() {
        return this.db;
    }

    async query(sql: string) {
        return this.db.execute(sql);
    }

    async transaction(callback: (tx: NodePgDatabase<typeof schema>) => Promise<void>) {
        return this.db.transaction(callback);
    }

    async isHealthy(): Promise<boolean> {
        try {
            await this.db.execute('SELECT 1');
            return true;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            return false;
        }
    }
}
