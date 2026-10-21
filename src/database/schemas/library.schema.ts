import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { boolean, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.schema';

export const libraryItemTypeEnum = pgEnum('item_type', ['FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE']);
export const processingStatusEnum = pgEnum('processing_status', ['pending', 'processed', 'failed']);

export const libraryItem = pgTable(
    'library_item',
    {
        id: serial('id').primaryKey(),
        uid: uuid('uid').notNull().unique().defaultRandom(),
        isActive: boolean('is_active').default(true),
        isEmbedded: boolean('is_embedded').default(false),
        name: text('name').notNull(),
        type: libraryItemTypeEnum('type').notNull(),
        parentId: integer('parent_id').references((): AnyPgColumn => libraryItem.id, { onDelete: 'cascade' }),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        metadata: jsonb('metadata').$type<LibraryItemMetadata>(),
        processingStatus: processingStatusEnum('processing_status').default('pending'),
        content: text('content'),
        createdAt: timestamp('created_at').defaultNow(),
        updatedAt: timestamp('updated_at').defaultNow(),
    },
    table => [index('library_item_parent_id_idx').on(table.parentId)],
);

export type LibraryItemType = (typeof libraryItemTypeEnum.enumValues)[number];
export type ProcessingStatus = (typeof processingStatusEnum.enumValues)[number];

export type FolderMetadata = { color: string; icon: string };
export type NoteMetadata = { description: string; notes: string };
export type FlashcardMetadata = { description: string; cards: { question: string; answer: string }[]; cardCount: number };
export type DocumentMetadata = { description: string; fileType: string; filePath: string; fileUrl: string; fileSize: number };
export type AudioMetadata = {
    description: string;
    fileType: string;
    duration: number;
    filePath: string;
    fileUrl: string;
    fileSize: number;
};
export type VideoMetadata = {
    description: string;
    fileType: string;
    duration: number;
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
