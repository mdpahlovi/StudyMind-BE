import { SupabaseService } from '@/common/services/supabase.service';
import { VectorService } from '@/common/services/vector.service';
import { DatabaseService } from '@/database/database.service';
import { User } from '@/database/schemas';
import { libraryItem } from '@/database/schemas/library.schema';
import { CreateLibraryItemDto, updateBulkLibraryItemsDto, UpdateLibraryItemDto } from '@/modules/library/library.dto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';

@Injectable()
export class LibraryService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly supabaseService: SupabaseService,
        private readonly vectorService: VectorService,
    ) {}

    async getLibraryItems(query: any, user: User) {
        const db = this.databaseService.database;

        const page = query.page ? Number(query.page) : 1;
        const limit = query.limit ? Number(query.limit) : 12;
        const offset = (page - 1) * limit;

        const libraryItemWhere = [eq(libraryItem.isActive, true), eq(libraryItem.userId, user.id)];
        const libraryItemOrder = [sql`CASE WHEN ${libraryItem.type} = 'FOLDER' THEN 0 ELSE 1 END`, asc(libraryItem.name)];

        if (query.parentUid) {
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
        } else {
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

    async getLibraryItemsByType(query: any, user: User) {
        const db = this.databaseService.database;

        const search = query.search || '';
        const type = query.type || '';
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

    async getLibraryItemsWithPath(query: any, user: User) {
        const db = this.databaseService.database;

        const type = query.type || '';

        const libraryItemsQuery = `
        WITH RECURSIVE child_item AS (
            SELECT 
                li.*,
                CONCAT('/', name) AS path
            FROM 
                library_item li
            WHERE 
                li.parent_id IS NULL 
                AND li.user_id = ${user.id} 
                AND li.is_active = TRUE 
                ${type ? `AND li.type = '${type}'` : ''}
            UNION ALL
            SELECT 
                li.*,
                CONCAT(ci.path, '/', li.name) AS path
            FROM 
                library_item li
            JOIN 
                child_item ci ON li.parent_id = ci.id
            WHERE 
                li.user_id = ${user.id}
                AND li.is_active = TRUE
                ${type ? `AND li.type = '${type}'` : ''}
        )
        SELECT 
            *
        FROM 
            child_item
        ORDER BY 
            path;
        `;

        const libraryItems = await db.execute(sql.raw(libraryItemsQuery)).then(res => res.rows);

        return {
            message: 'Library items fetched successfully',
            data: libraryItems || [],
        };
    }

    async getLibraryItemByUid(uid: string, user: User) {
        const db = this.databaseService.database;

        const itemData = await db.select().from(libraryItem).where(eq(libraryItem.uid, uid));

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
            let metadata = { ...body.metadata };

            if (file) {
                const fileMetadata = await this.supabaseService.uploadFile(file, metadata?.fileType);
                metadata = { ...metadata, ...fileMetadata };
            }

            return await tx
                .insert(libraryItem)
                .values({
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

        return { message: 'Library item created successfully', data: createdData[0] };
    }

    async updateLibraryItem(uid: string, body: UpdateLibraryItemDto, user: User) {
        const db = this.databaseService.database;

        const [doesLibraryItemExist] = await db.select().from(libraryItem).where(eq(libraryItem.uid, uid));

        if (!doesLibraryItemExist) {
            throw new NotFoundException('Library item not found');
        }

        const updatedData = await db
            .update(libraryItem)
            .set({
                ...(body.isActive ? { isActive: body.isActive } : {}),
                ...(body.name ? { name: body.name } : {}),
                ...(body.type ? { type: body.type } : {}),
                ...(body.parentId ? { parentId: body.parentId } : {}),
                ...(body.metadata ? { metadata: body.metadata } : {}),
                updatedAt: new Date(),
            })
            .where(eq(libraryItem.uid, uid))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update library item');
        }

        return { message: 'Library item updated successfully', data: updatedData[0] };
    }

    async updateBulkLibraryItems(body: updateBulkLibraryItemsDto, user: User) {
        const db = this.databaseService.database;

        const updatedData = await db
            .update(libraryItem)
            .set({ isActive: body.isActive, parentId: body.parentId, updatedAt: new Date() })
            .where(inArray(libraryItem.uid, body.uid))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update library item');
        }

        return { message: 'Library item updated successfully', data: updatedData };
    }

    async embeddLibraryItem(uid: string, user: User) {
        const db = this.databaseService.database;

        const [doesLibraryItemExist] = await db.select().from(libraryItem).where(eq(libraryItem.uid, uid));

        if (!doesLibraryItemExist) {
            throw new NotFoundException('Library item not found');
        }

        const ids = await this.vectorService.embedPdf(doesLibraryItemExist.metadata);
    }
}
