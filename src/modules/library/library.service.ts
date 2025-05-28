import { DatabaseService } from '@/database/database.service';
import { User } from '@/database/schemas';
import { libraryItem } from '@/database/schemas/library.schema';
import { CreateLibraryItemDto, UpdateLibraryItemDto } from '@/modules/library/library.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';

@Injectable()
export class LibraryService {
    constructor(private readonly databaseService: DatabaseService) {}

    async getLibraryItems(query: any, user: User) {
        const db = this.databaseService.database;

        const page = query.page ? Number(query.page) : 1;
        const limit = query.limit ? Number(query.limit) : 12;
        const offset = (page - 1) * limit;

        const libraryItemWhere = [eq(libraryItem.isActive, true), eq(libraryItem.userId, user.id)];
        const libraryItemOrder = [
            sql`CASE WHEN ${libraryItem.type} = 'FOLDER' THEN 0 ELSE 1 END`,
            asc(libraryItem.sortOrder),
            asc(libraryItem.name),
        ];

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

    async createLibraryItem(body: CreateLibraryItemDto, user: User) {
        const db = this.databaseService.database;

        const createdData = await db
            .insert(libraryItem)
            .values({
                name: body.name,
                type: body.type,
                parentId: body.parentId,
                userId: user.id,
                path: body.path,
                metadata: body.metadata,
                sortOrder: body.sortOrder,
            })
            .returning();

        return { message: 'Library item created successfully', data: createdData };
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
                ...(body.path ? { path: body.path } : {}),
                ...(body.metadata ? { metadata: body.metadata } : {}),
                ...(body.sortOrder ? { sortOrder: body.sortOrder } : {}),
            })
            .where(eq(libraryItem.uid, uid))
            .returning();

        return { message: 'Library item updated successfully', data: updatedData };
    }
}
