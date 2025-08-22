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

export type FolderMetadata = { color: string; icon: string };
export type NoteMetadata = { description: string; notes: string };
export type FlashcardMetadata = { description: string; cards: { question: string; answer: string }[]; cardCount: number };
export type DocumentMetadata = { description: string; fileType: string; filePath: string; fileUrl: string; fileSize: number };
export type AudioMetadata = {
    description: string;
    fileType: string;
    duration: string;
    filePath: string;
    fileUrl: string;
    fileSize: number;
};
export type VideoMetadata = {
    description: string;
    fileType: string;
    duration: string;
    filePath: string;
    fileUrl: string;
    fileSize: number;
};
export type ImageMetadata = {
    description: string;
    fileType: string;
    resolution: string;
    filePath: string;
    fileUrl: string;
    fileSize: number;
};

export type LibraryItemMetadata =
    | FolderMetadata
    | NoteMetadata
    | FlashcardMetadata
    | DocumentMetadata
    | AudioMetadata
    | VideoMetadata
    | ImageMetadata;
export type LibraryItem = typeof libraryItem.$inferSelect;
export type CreateLibraryItem = typeof libraryItem.$inferInsert;
