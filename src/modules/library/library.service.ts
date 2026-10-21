import { RabbitMQService, type LibraryProcessedPayload } from '@/common/services/rabbitmq.service';
import { SupabaseService } from '@/common/services/supabase.service';
import { VectorService } from '@/common/services/vector.service';
import { DatabaseService } from '@/database/database.service';
import { User } from '@/database/schemas';
import { LibraryItemType, libraryItem } from '@/database/schemas/library.schema';
import {
    CreateLibraryItemDto,
    DeleteBulkLibraryItemsDto,
    UpdateBulkLibraryItemsDto,
    UpdateLibraryItemDto,
} from '@/modules/library/library.dto';
import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';

@Injectable()
export class LibraryService implements OnModuleInit {
    private readonly logger = new Logger(LibraryService.name);

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly supabaseService: SupabaseService,
        private readonly vectorService: VectorService,
        private readonly rabbitmq: RabbitMQService,
    ) {}

    onModuleInit(): void {
        void this.rabbitmq.consumeLibraryProcessed(payload => this.handleProcessed(payload));
    }

    private async handleProcessed(payload: LibraryProcessedPayload): Promise<void> {
        const itemUid = payload.itemUid;
        if (!itemUid) return;

        const db = this.databaseService.database;
        const [item] = await db
            .select({ id: libraryItem.id, updatedAt: libraryItem.updatedAt })
            .from(libraryItem)
            .where(eq(libraryItem.uid, itemUid))
            .limit(1);

        if (!item || (payload.occurredAt && item.updatedAt && new Date(payload.occurredAt) < item.updatedAt)) {
            return;
        }

        if (payload.status === 'success' && payload.text !== null) {
            await db
                .update(libraryItem)
                .set({
                    content: payload.text,
                    processingStatus: 'processed',
                    updatedAt: new Date(),
                })
                .where(eq(libraryItem.uid, itemUid));

            try {
                await this.vectorService.indexMarkdownContent(itemUid, payload.text);
            } catch (error) {
                this.logger.error(`Failed to index vectors for item ${itemUid}`, error);
            }
        } else {
            await db
                .update(libraryItem)
                .set({
                    processingStatus: 'failed',
                    isEmbedded: false,
                    updatedAt: new Date(),
                })
                .where(eq(libraryItem.uid, itemUid));
        }
    }

    async getLibraryItems(query: { [key: string]: string }, user: User) {
        const db = this.databaseService.database;

        const page = query.page ? Number(query.page) : 1;
        const limit = query.limit ? Number(query.limit) : 12;
        const offset = (page - 1) * limit;
        const isActive = query.isActive !== 'false';

        const libraryItemWhere = [eq(libraryItem.isActive, isActive), eq(libraryItem.userId, user.id)];
        const libraryItemOrder = [sql`CASE WHEN ${libraryItem.type} = 'FOLDER' THEN 0 ELSE 1 END`, asc(libraryItem.name)];

        // Removed items are listed flat, so an item stays visible even when its parent folder is not.
        if (isActive && query.parentUid) {
            const parentItem = await db
                .select({
                    id: libraryItem.id,
                })
                .from(libraryItem)
                .where(eq(libraryItem.uid, query.parentUid));

            if (!parentItem?.length) {
                throw new NotFoundException('Parent library item not found');
            }

            libraryItemWhere.push(eq(libraryItem.parentId, parentItem[0].id));
        } else if (isActive) {
            libraryItemWhere.push(isNull(libraryItem.parentId));
        }

        const total = await db
            .select({ count: count() })
            .from(libraryItem)
            .where(and(...libraryItemWhere));

        const libraryItems = await db
            .select()
            .from(libraryItem)
            .where(and(...libraryItemWhere))
            .orderBy(...libraryItemOrder)
            .limit(limit)
            .offset(offset);

        return {
            message: 'Library items fetched successfully',
            data: {
                libraryItems: libraryItems || [],
                total: total?.length ? total[0].count : 0,
            },
        };
    }

    async getLibraryItemsByType(query: { [key: string]: string }, user: User) {
        const db = this.databaseService.database;

        const search = query.search || '';
        const type = (query.type as LibraryItemType | 'MEDIA') || '';
        const page = query.page ? Number(query.page) : 1;
        const limit = query.limit ? Number(query.limit) : 12;
        const offset = (page - 1) * limit;

        const libraryItemWhere = [eq(libraryItem.isActive, true), eq(libraryItem.userId, user.id)];
        const libraryItemOrder = [desc(libraryItem.updatedAt), asc(libraryItem.name)];

        if (search) {
            libraryItemWhere.push(ilike(libraryItem.name, `%${search}%`));
        }

        if (type) {
            switch (type) {
                case 'MEDIA':
                    libraryItemWhere.push(inArray(libraryItem.type, ['AUDIO', 'VIDEO', 'IMAGE']));
                    break;
                default:
                    libraryItemWhere.push(eq(libraryItem.type, type));
                    break;
            }
        }

        const total = await db
            .select({ count: count() })
            .from(libraryItem)
            .where(and(...libraryItemWhere));

        const libraryItems = await db
            .select()
            .from(libraryItem)
            .where(and(...libraryItemWhere))
            .orderBy(...libraryItemOrder)
            .limit(limit)
            .offset(offset);

        return {
            message: 'Library items fetched successfully',
            data: {
                libraryItems: libraryItems || [],
                total: total?.length ? total[0].count : 0,
            },
        };
    }

    async getLibraryItemsWithPath(query: { [key: string]: string }, user: User) {
        const db = this.databaseService.database;
        let libraryItemWhere = '';

        if (query?.isEmbedded) {
            libraryItemWhere = `AND li.is_embedded = ${query.isEmbedded ? 'TRUE' : 'FALSE'}`;
        }

        if (query?.type) {
            libraryItemWhere = `AND li.type = '${query.type}'`;
        }

        const libraryItemsQuery = `
        WITH RECURSIVE library_tree AS (
            SELECT 
                li.id, 
                li.uid, 
                li.name, 
                li.type, 
                li.parent_id, 
                0 as level, 
                ARRAY[id] as id_path, 
                '/' || name as path 
            FROM library_item as li
            WHERE
                li.parent_id IS NULL
                AND li.is_active = TRUE
                AND li.user_id = ${user.id}
                ${libraryItemWhere}
            UNION ALL 
            SELECT 
                li.id, 
                li.uid, 
                li.name, 
                li.type, 
                li.parent_id, 
                lt.level + 1, 
                lt.id_path || li.id, 
                lt.path || '/' || li.name 
            FROM library_item li 
            JOIN library_tree lt ON li.parent_id = lt.id 
            WHERE 
                NOT li.id = ANY(lt.id_path)
                AND li.is_active = TRUE
                AND li.user_id = ${user.id}
                ${libraryItemWhere}
        ), 
        nested_structure AS (
            SELECT 
                parent_id, 
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'id', id,
                        'uid', uid,
                        'name', name,
                        'type', type,
                        'path', path
                    ) 
                    ORDER BY 
                        name,
                        CASE WHEN type = 'FOLDER' THEN 0 ELSE 1 END
                ) as children 
            FROM library_tree 
            WHERE level > 0 
            GROUP BY parent_id
        ) 
        SELECT 
            lt.id, 
            lt.uid, 
            lt.name, 
            lt.type, 
            lt.path, 
        COALESCE(ns.children, '[]' :: json) as children 
        FROM library_tree lt 
        LEFT JOIN nested_structure ns ON lt.id = ns.parent_id 
        WHERE lt.level = 0 
        ORDER BY 
            lt.name,
            CASE WHEN lt.type = 'FOLDER' THEN 0 ELSE 1 END;
        `;

        const libraryItems = await db.execute(sql.raw(libraryItemsQuery)).then(res => res.rows);

        return {
            message: 'Library items fetched successfully',
            data: libraryItems || [],
        };
    }

    async getLibraryItemByUid(uid: string, user: User) {
        const db = this.databaseService.database;

        const itemData = await db
            .select()
            .from(libraryItem)
            .where(and(eq(libraryItem.uid, uid), eq(libraryItem.userId, user.id)));

        if (!itemData?.length) {
            throw new NotFoundException('Library item not found');
        }

        return {
            message: 'Library item fetched successfully',
            data: itemData[0],
        };
    }

    async createLibraryItem(file: Express.Multer.File, body: CreateLibraryItemDto, user: User) {
        const db = this.databaseService.database;

        const createdData = await db.transaction(async tx => {
            const uid = randomUUID();
            const metadata = { ...body.metadata };

            if (file && 'fileType' in metadata) {
                const fileData = await this.supabaseService.uploadFile(file, uid, metadata.fileType);
                Object.assign(metadata, fileData);
            }

            return await tx
                .insert(libraryItem)
                .values({
                    uid,
                    isEmbedded: 'fileUrl' in metadata ? false : true,
                    processingStatus: 'fileUrl' in metadata ? 'pending' : 'processed',
                    name: body.name,
                    type: body.type,
                    parentId: body.parentId,
                    userId: user.id,
                    metadata,
                })
                .returning();
        });

        if (!createdData[0] || !createdData[0]?.uid) {
            throw new BadRequestException('Failed to create library item');
        }

        const createdItem = createdData[0];

        if ('fileUrl' in createdItem.metadata) {
            await this.rabbitmq.publishLibraryEvent('created', createdItem, createdItem.metadata.fileUrl);
        }

        return { message: 'Library item created successfully', data: createdItem };
    }

    async retry(uid: string, user: User) {
        const db = this.databaseService.database;
        const where = and(eq(libraryItem.uid, uid), eq(libraryItem.userId, user.id));

        const itemData = await db.query.libraryItem.findFirst({ where });

        if (!itemData) {
            throw new NotFoundException('Library item not found');
        }

        if (!('fileUrl' in itemData.metadata)) {
            throw new BadRequestException('Only uploaded items can be reprocessed');
        }

        if (itemData.processingStatus !== 'failed') {
            throw new BadRequestException('Only items whose processing failed can be retried');
        }

        await db
            .update(libraryItem)
            .set({ processingStatus: 'pending', isEmbedded: false, updatedAt: new Date() })
            .where(eq(libraryItem.uid, uid));

        itemData.processingStatus = 'pending';
        itemData.isEmbedded = false;
        itemData.updatedAt = new Date();

        await this.rabbitmq.publishLibraryEvent('updated', itemData, itemData.metadata.fileUrl);

        return { message: 'Library item processing restarted', data: itemData };
    }

    async updateLibraryItem(uid: string, body: UpdateLibraryItemDto, user: User) {
        const db = this.databaseService.database;
        const where = and(eq(libraryItem.uid, uid), eq(libraryItem.userId, user.id));

        const itemData = await db.query.libraryItem.findFirst({ where });

        if (!itemData) {
            throw new NotFoundException('Library item not found');
        }

        const updatedData = await db
            .update(libraryItem)
            .set({
                ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
                ...(body.name ? { name: body.name } : {}),
                ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
                ...(body.metadata ? { metadata: body.metadata } : {}),
                updatedAt: new Date(),
            })
            .where(where)
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update library item');
        }

        return { message: 'Library item updated successfully', data: updatedData[0] };
    }

    async updateBulkLibraryItems(body: UpdateBulkLibraryItemsDto, user: User) {
        const db = this.databaseService.database;

        const owned = await db
            .select({ id: libraryItem.id })
            .from(libraryItem)
            .where(and(inArray(libraryItem.uid, body.uid), eq(libraryItem.userId, user.id)));

        if (!owned.length) {
            throw new NotFoundException('Library item not found');
        }

        const ownedIds = owned.map(item => item.id);

        const updatedData = await db
            .update(libraryItem)
            .set({
                ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
                ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
                updatedAt: new Date(),
            })
            .where(and(inArray(libraryItem.id, ownedIds), eq(libraryItem.userId, user.id)))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update library item');
        }

        return { message: 'Library item updated successfully', data: updatedData };
    }

    async deleteBulkLibraryItems(body: DeleteBulkLibraryItemsDto, user: User) {
        const db = this.databaseService.database;

        const roots = await db
            .select({ id: libraryItem.id })
            .from(libraryItem)
            .where(and(inArray(libraryItem.uid, body.uid), eq(libraryItem.userId, user.id), eq(libraryItem.isActive, false)));

        if (!roots.length) {
            throw new NotFoundException('No removed library items found');
        }

        const itemIds = await this.collectItemIds(
            roots.map(root => root.id),
            user.id,
        );

        // document_chunk rows are removed by the ON DELETE CASCADE foreign key.
        const deletedData = await db
            .delete(libraryItem)
            .where(and(inArray(libraryItem.id, itemIds), eq(libraryItem.userId, user.id)))
            .returning();

        await this.removeStoredFolders(deletedData.map(item => item.uid));

        return { message: 'Removed items deleted permanently', data: deletedData };
    }

    private async collectItemIds(rootIds: number[], userId: number): Promise<number[]> {
        const db = this.databaseService.database;
        const collected = new Set<number>(rootIds);
        let frontier = rootIds;

        while (frontier.length) {
            const children = await db
                .select({ id: libraryItem.id })
                .from(libraryItem)
                .where(and(inArray(libraryItem.parentId, frontier), eq(libraryItem.userId, userId)));

            frontier = children.map(child => child.id).filter(id => !collected.has(id));
            frontier.forEach(id => collected.add(id));
        }

        return [...collected];
    }

    private async removeStoredFolders(uids: string[]) {
        if (!uids.length) return;

        try {
            await Promise.all(uids.map(uid => this.supabaseService.deleteFolder(uid)));
        } catch (error) {
            // The database rows are already gone; a leftover file is not worth failing the request.
            this.logger.warn(
                `Failed to remove storage folders for items [${uids.join(', ')}]: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}
