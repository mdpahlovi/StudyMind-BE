import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { users } from './user.schema';

export const libraryItemTypeEnum = pgEnum('item_type', ['FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE']);

export const libraryItem = pgTable('library_item', {
    id: serial('id').primaryKey(),
    uid: uuid('uid').notNull().unique().defaultRandom(),
    isActive: boolean('is_active').default(true),
    name: text('name').notNull(),
    type: libraryItemTypeEnum('type').notNull(),
    parentId: integer('parent_id').references(() => libraryItem.id),
    userId: integer('user_id')
        .notNull()
        .references(() => users.id),
    path: text('path'),
    metadata: jsonb('metadata'),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// Zod schemas for validation
export const createLibraryItemSchema = createInsertSchema(libraryItem);
export const selectLibraryItemSchema = createSelectSchema(libraryItem);

export type LibraryItemType = (typeof libraryItemTypeEnum.enumValues)[number];
export type LibraryItem = typeof libraryItem.$inferSelect;
export type CreateLibraryItem = typeof libraryItem.$inferInsert;
