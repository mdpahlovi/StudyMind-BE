import { index, integer, jsonb, pgTable, serial, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';
import { libraryItem } from './library.schema';
import { users } from './user.schema';

/**
 * Shared by the `embedding` column DDL and `EmbeddingService`.
 * 1536 (a Matryoshka truncation) because pgvector only indexes up to 2000 dims.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export type DocumentChunkMetadata = {
    source: string | null;
    pageNumber: number | null;
    totalPages: number | null;
    chunkIndex: number;
    totalChunks: number;
    contentLength: number;
    indexedAt: string;
};

export const documentChunk = pgTable(
    'document_chunk',
    {
        id: serial('id').primaryKey(),
        uid: uuid('uid').notNull().unique().defaultRandom(),
        itemId: integer('item_id')
            .notNull()
            .references(() => libraryItem.id, { onDelete: 'cascade' }),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        chunkIndex: integer('chunk_index').notNull(),
        content: text('content').notNull(),
        metadata: jsonb('metadata').$type<DocumentChunkMetadata>(),
        embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
        createdAt: timestamp('created_at').defaultNow(),
        updatedAt: timestamp('updated_at').defaultNow(),
    },
    table => [
        index('document_chunk_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
        index('document_chunk_item_id_idx').on(table.itemId),
        index('document_chunk_user_id_idx').on(table.userId),
    ],
);

export type DocumentChunk = typeof documentChunk.$inferSelect;
export type CreateDocumentChunk = typeof documentChunk.$inferInsert;
