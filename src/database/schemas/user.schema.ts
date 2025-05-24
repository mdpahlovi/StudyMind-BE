import { pgTable, serial, varchar, timestamp, boolean, text } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    name: text('name'),
    email: varchar('email', { length: 255 }).notNull().unique(),
    phone: varchar('phone', { length: 15 }).notNull().unique(),
    password: text('password').notNull(),
    provider: text('provider').$type<'credential' | 'google' | 'facebook'>(),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// Zod schemas for validation
export const createUserSchema = createInsertSchema(users, {
    name: z.string().min(3).max(100),
    email: z.string().email(),
    phone: z.string().min(11).max(15),
    password: z.string().min(6),
    provider: z.enum(['credential', 'google', 'facebook']),
});

export const selectUserSchema = createSelectSchema(users);

export type User = typeof users.$inferSelect;
export type CreateUser = typeof users.$inferInsert;
