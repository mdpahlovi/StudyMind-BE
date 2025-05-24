import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
    schema: './src/database/schemas/*.ts',
    out: './src/database/migrations',
    dialect: 'postgresql',
    dbCredentials: {},
    verbose: true,
    strict: true,
});
