import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.schema';

export const libraryItemTypeEnum = pgEnum('item_type', ['FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE']);

export const libraryItem = pgTable('library_item', {
    id: serial('id').primaryKey(),
    uid: uuid('uid').notNull().unique().defaultRandom(),
    isActive: boolean('is_active').default(true),
    isEmbedded: boolean('is_embedded').default(false),
    name: text('name').notNull(),
    type: libraryItemTypeEnum('type').notNull(),
    parentId: integer('parent_id'),
    userId: integer('user_id')
        .notNull()
        .references(() => users.id),
    metadata: jsonb('metadata').$type<LibraryItemMetadata>(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export type LibraryItemType = (typeof libraryItemTypeEnum.enumValues)[number];
export type LibraryItemMetadata = {
    description?: string;
    // Folder specific
    color?: string;
    icon?: string;
    // Note specific
    notes?: string;
    // Flashcard specific
    cards?: { question: string; answer: string }[];
    cardCount?: number;
    // Media specific
    filePath?: string;
    fileUrl?: string;
    fileSize?: number;
    fileType?: string;
    duration?: string;
    resolution?: string;
};
export type LibraryItem = typeof libraryItem.$inferSelect;
export type CreateLibraryItem = typeof libraryItem.$inferInsert;
