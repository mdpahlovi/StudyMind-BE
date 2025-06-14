import { boolean, integer, pgEnum, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.schema';

export const chatSessions = pgTable('chat_sessions', {
    id: serial('id').primaryKey(),
    uid: uuid('uid').notNull().unique().defaultRandom(),
    isActive: boolean('is_active').default(true),
    userId: integer('user_id')
        .notNull()
        .references(() => users.id),
    title: text('title').notNull(),
    describe: text('describe'),
    lastMessage: text('last_message'),
    lastMessageAt: timestamp('last_message_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const chatMessageRoleEnum = pgEnum('message_role', ['USER', 'ASSISTANT']);
export const chatMessages = pgTable('chat_messages', {
    id: serial('id').primaryKey(),
    uid: uuid('uid').notNull().unique().defaultRandom(),
    role: chatMessageRoleEnum('role').notNull(),
    chatSessionId: integer('chat_session_id')
        .notNull()
        .references(() => chatSessions.id),
    message: text('message').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChatMessageRole = (typeof chatMessageRoleEnum.enumValues)[number];
