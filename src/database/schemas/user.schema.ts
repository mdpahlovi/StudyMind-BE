import { boolean, jsonb, pgEnum, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

export const providerEnum = pgEnum('provider', ['CREDENTIAL', 'GOOGLE', 'FACEBOOK']);

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    uid: uuid('uid').notNull().unique().defaultRandom(),
    isActive: boolean('is_active').default(true),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    phone: text('phone'),
    photo: text('photo'),
    password: text('password'),
    provider: providerEnum('provider').notNull(),
    otherInfo: jsonb('other_info'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// Zod schemas for validation
export const createUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);

export type User = typeof users.$inferSelect;
export type CreateUser = typeof users.$inferInsert;
