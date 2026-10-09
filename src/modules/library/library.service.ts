import { SupabaseService } from '@/common/services/supabase.service';
import { VectorService } from '@/common/services/vector.service';
import { DatabaseService } from '@/database/database.service';
import { User } from '@/database/schemas';
import { DocumentMetadata, libraryItem, LibraryItemMetadata, LibraryItemType } from '@/database/schemas/library.schema';
import {
    CreateLibraryItemDto,
    DeleteBulkLibraryItemsDto,
    UpdateBulkLibraryItemsDto,
    UpdateLibraryItemDto,
} from '@/modules/library/library.dto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';

@Injectable()
export class LibraryService {
    private readonly logger = new Logger(LibraryService.name);

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly supabaseService: SupabaseService,
        private readonly vectorService: VectorService,
    ) {}

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
            const metadata = { ...body.metadata };

            if (file && 'fileType' in metadata) {
                const fileData = await this.supabaseService.uploadFile(file, metadata.fileType);
                Object.assign(metadata, fileData);
            }

            return await tx
                .insert(libraryItem)
                .values({
                    isEmbedded: ['DOCUMENT', 'AUDIO', 'VIDEO', 'IMAGE'].includes(body.type) ? false : true,
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

        // Index after commit so the item survives an embedding failure; isEmbedded reports the truth.
        const createdItem = createdData[0];

        if (createdItem.type === 'DOCUMENT') {
            const isEmbedded = await this.vectorService.indexDocumentItem(createdItem);
            return { message: 'Library item created successfully', data: { ...createdItem, isEmbedded } };
        }

        return { message: 'Library item created successfully', data: createdItem };
    }

    async updateLibraryItem(uid: string, body: UpdateLibraryItemDto, user: User) {
        const db = this.databaseService.database;
        const where = and(eq(libraryItem.uid, uid), eq(libraryItem.userId, user.id));

        const itemData = await db.query.libraryItem.findFirst({ where });

        if (!itemData) {
            throw new NotFoundException('Library item not found');
        }

        // Drop vectors on deactivation so stale content cannot re-enter a chat context.
        if (body.isActive === false) {
            await this.vectorService.deleteByItemUid(uid);
        }

        const metadata = (body.metadata ?? itemData.metadata) as Partial<DocumentMetadata> | null;
        const source = metadata?.filePath ?? metadata?.fileUrl;
        const currentSource =
            (itemData.metadata as Partial<DocumentMetadata> | null)?.filePath ??
            (itemData.metadata as Partial<DocumentMetadata> | null)?.fileUrl;
        const isDocument = itemData.type === 'DOCUMENT';

        // Re-index on request, or when the source file changed while already indexed.
        const shouldIndex =
            isDocument && !!source && (body.isEmbedded === true || (currentSource !== source && itemData.isEmbedded === true));

        let isEmbedded = body.isEmbedded;
        if (shouldIndex) {
            isEmbedded = await this.vectorService.indexDocumentItem({
                uid,
                type: itemData.type,
                metadata: metadata as LibraryItemMetadata,
            });
        }

        const updatedData = await db
            .update(libraryItem)
            .set({
                ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
                ...(isEmbedded !== undefined ? { isEmbedded } : {}),
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
            .select({ uid: libraryItem.uid })
            .from(libraryItem)
            .where(and(inArray(libraryItem.uid, body.uid), eq(libraryItem.userId, user.id)));

        if (!owned.length) {
            throw new NotFoundException('Library item not found');
        }

        const ownedUids = owned.map(item => item.uid);

        if (body.isActive === false) {
            await this.vectorService.deleteByItemUids(ownedUids);
        }

        const updatedData = await db
            .update(libraryItem)
            .set({
                ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
                ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
                updatedAt: new Date(),
            })
            .where(and(inArray(libraryItem.uid, ownedUids), eq(libraryItem.userId, user.id)))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update library item');
        }

        // Soft delete drops the vectors, so restoring a document has to rebuild them.
        if (body.isActive === true) {
            const ancestorIds = await this.collectRemovedAncestorIds(
                updatedData.map(item => item.parentId),
                user.id,
            );

            const restoreTargets = [...updatedData];

            if (ancestorIds.length) {
                const restoredAncestors = await db
                    .update(libraryItem)
                    .set({ isActive: true, updatedAt: new Date() })
                    .where(and(inArray(libraryItem.id, ancestorIds), eq(libraryItem.userId, user.id)))
                    .returning();

                restoreTargets.push(...restoredAncestors);
            }

            for (const item of restoreTargets) {
                await this.vectorService.indexDocumentItem(item);
            }
        }

        return { message: 'Library item updated successfully', data: updatedData };
    }

    /** Returns the removed ancestor folders, so a restored item is never left hidden. */
    private async collectRemovedAncestorIds(parentIds: (number | null)[], userId: number): Promise<number[]> {
        const db = this.databaseService.database;
        const collected = new Set<number>();
        let frontier = parentIds.filter((parentId): parentId is number => parentId !== null && parentId !== undefined);

        while (frontier.length) {
            const parents = await db
                .select({ id: libraryItem.id, parentId: libraryItem.parentId, isActive: libraryItem.isActive })
                .from(libraryItem)
                .where(and(inArray(libraryItem.id, frontier), eq(libraryItem.userId, userId)));

            frontier = [];

            for (const parent of parents) {
                if (parent.isActive || collected.has(parent.id)) continue;

                collected.add(parent.id);
                if (parent.parentId !== null) frontier.push(parent.parentId);
            }
        }

        return [...collected];
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

        const removedItems = await db.select({ metadata: libraryItem.metadata }).from(libraryItem).where(inArray(libraryItem.id, itemIds));

        // document_chunk rows are removed by the ON DELETE CASCADE foreign key.
        const deleted = await db.transaction(async tx =>
            tx
                .delete(libraryItem)
                .where(and(inArray(libraryItem.id, itemIds), eq(libraryItem.userId, user.id)))
                .returning({ uid: libraryItem.uid }),
        );

        await this.removeStoredFiles(removedItems.map(item => (item.metadata as Partial<DocumentMetadata> | null)?.filePath));

        return { message: 'Removed items deleted permanently', data: deleted };
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

    private async removeStoredFiles(paths: (string | undefined)[]) {
        const storedPaths = paths.filter((storedPath): storedPath is string => !!storedPath);
        if (!storedPaths.length) return;

        try {
            await this.supabaseService.storage.remove(storedPaths);
        } catch (error) {
            // The database rows are already gone; a leftover file is not worth failing the request.
            this.logger.warn(
                `Failed to remove ${storedPaths.length} stored file(s): ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}
