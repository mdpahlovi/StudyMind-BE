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

export const messageRoleEnum = pgEnum('message_role', ['USER', 'ASSISTANT']);
export const chatMessages = pgTable('chat_messages', {
    id: serial('id').primaryKey(),
    uid: uuid('uid').notNull().unique().defaultRandom(),
    role: messageRoleEnum('role').notNull(),
    chatSessionId: integer('chat_session_id')
        .notNull()
        .references(() => chatSessions.id),
    message: text('message').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});
