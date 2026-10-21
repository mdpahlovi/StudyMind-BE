import { EmbeddingService } from '@/common/services/embedding.service';
import { DatabaseService } from '@/database/database.service';
import { documentChunk, DocumentChunkMetadata } from '@/database/schemas/chunk.schema';
import { libraryItem } from '@/database/schemas/library.schema';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, cosineDistance, eq, inArray } from 'drizzle-orm';

export type RetrievedChunk = {
    itemUid: string;
    itemName: string;
    content: string;
    pageNumber: number | null;
    chunkIndex: number;
    score: number;
};

export type SearchOptions = {
    limit?: number;
    minScore?: number;
    itemUids?: string[];
};

const INSERT_BATCH_SIZE = 100;

@Injectable()
export class VectorService {
    private readonly logger = new Logger(VectorService.name);
    private readonly textSplitter: RecursiveCharacterTextSplitter;

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly embeddingService: EmbeddingService,
        private readonly configService: ConfigService,
    ) {
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
            separators: ['\n\n', '\n', '. ', ' ', ''],
        });
    }

    /** Indexes Markdown converted by the Tools service (Docling / Whisper). */
    async indexMarkdownContent(itemUid: string, markdown: string): Promise<number> {
        const db = this.databaseService.database;

        const [item] = await db
            .select({ id: libraryItem.id, userId: libraryItem.userId, name: libraryItem.name })
            .from(libraryItem)
            .where(eq(libraryItem.uid, itemUid));

        if (!item) {
            throw new NotFoundException(`Library item not found for uid: ${itemUid}`);
        }

        if (!markdown || !markdown.trim()) {
            await db.update(libraryItem).set({ isEmbedded: true, updatedAt: new Date() }).where(eq(libraryItem.uid, itemUid));
            return 0;
        }

        const chunks = await this.textSplitter.splitText(markdown);
        if (!chunks.length) {
            await db.update(libraryItem).set({ isEmbedded: true, updatedAt: new Date() }).where(eq(libraryItem.uid, itemUid));
            return 0;
        }

        const embeddings = await this.embeddingService.embedDocuments(chunks);
        const indexedAt = new Date().toISOString();

        const rows = chunks.map((chunk, index) => ({
            itemId: item.id,
            userId: item.userId,
            chunkIndex: index,
            content: chunk,
            metadata: {
                source: item.name,
                pageNumber: null,
                totalPages: null,
                chunkIndex: index,
                totalChunks: chunks.length,
                contentLength: chunk.length,
                indexedAt,
            } satisfies DocumentChunkMetadata,
            embedding: embeddings[index],
        }));

        await db.transaction(async tx => {
            await tx.delete(documentChunk).where(eq(documentChunk.itemId, item.id));

            for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
                await tx.insert(documentChunk).values(rows.slice(i, i + INSERT_BATCH_SIZE));
            }

            await tx.update(libraryItem).set({ isEmbedded: true, updatedAt: new Date() }).where(eq(libraryItem.uid, itemUid));
        });

        this.logger.log(`Indexed ${rows.length} markdown chunks for item ${itemUid}`);
        return rows.length;
    }

    /** Returns a prompt-ready string, or '' when nothing matched. */
    async searchByItemUid(query: string, itemUid: string, userId: number, options: SearchOptions = {}): Promise<string> {
        const results = await this.search(query, userId, { ...options, itemUids: [itemUid] });

        if (!results.length) {
            return '';
        }

        return results
            .map(result => {
                const page = result.pageNumber ? `, page ${result.pageNumber}` : '';
                return `[Source: ${result.itemName}${page} | relevance ${result.score.toFixed(3)}]\n${result.content}`;
            })
            .join('\n\n---\n\n');
    }

    /** Ownership and active-state are enforced in SQL, not by the caller. */
    async search(query: string, userId: number, options: SearchOptions = {}): Promise<RetrievedChunk[]> {
        const limit = options.limit ?? this.configService.get<number>('retrieval.topK');
        const minScore = options.minScore ?? this.configService.get<number>('retrieval.minScore');

        const queryEmbedding = await this.embeddingService.embedQuery(query);
        const db = this.databaseService.database;

        const distance = cosineDistance(documentChunk.embedding, queryEmbedding);

        const conditions = [eq(documentChunk.userId, userId), eq(libraryItem.isActive, true)];
        if (options.itemUids?.length) {
            conditions.push(inArray(libraryItem.uid, options.itemUids));
        }

        const rows = await db
            .select({
                itemUid: libraryItem.uid,
                itemName: libraryItem.name,
                content: documentChunk.content,
                chunkIndex: documentChunk.chunkIndex,
                metadata: documentChunk.metadata,
                distance,
            })
            .from(documentChunk)
            .innerJoin(libraryItem, eq(documentChunk.itemId, libraryItem.id))
            .where(and(...conditions))
            .orderBy(distance)
            .limit(limit);

        return rows
            .map(row => ({
                itemUid: row.itemUid,
                itemName: row.itemName,
                content: row.content,
                chunkIndex: row.chunkIndex,
                pageNumber: row.metadata?.pageNumber ?? null,
                score: 1 - Number(row.distance),
            }))
            .filter(row => row.score >= minScore);
    }
}
