import { DatabaseService } from '@/database/database.service';
import { User } from '@/database/schemas';
import { libraryItem } from '@/database/schemas/library.schema';
import { CreateLibraryItemDto, UpdateLibraryItemDto } from '@/modules/library/library.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

@Injectable()
export class LibraryService {
    constructor(private readonly databaseService: DatabaseService) {}

    async getLibraryItems(query: any, user: User) {
        const db = this.databaseService.database;

        const page = query.page ? Number(query.page) : 1;
        const limit = query.limit ? Number(query.limit) : 20;
        const offset = (page - 1) * limit;
        let parent = null;

        const libraryItemWhere = [eq(libraryItem.userId, user.id)];

        if (query.parentUid) {
            const [parentItem] = await db.select().from(libraryItem).where(eq(libraryItem.uid, query.parentUid));

            if (!parentItem) {
                throw new NotFoundException('Parent library item not found');
            }

            parent = parentItem;
            libraryItemWhere.push(eq(libraryItem.parentId, parent.id));
        }

        const [total] = await db
            .select()
            .from(libraryItem)
            .where(and(...libraryItemWhere));

        const [libraryItems] = await db
            .select()
            .from(libraryItem)
            .where(and(...libraryItemWhere))
            .orderBy(desc(libraryItem.sortOrder))
            .limit(limit)
            .offset(offset);

        return { message: 'Library items fetched successfully', data: { parent, libraryItems, total } };
    }

    async createLibraryItem(body: CreateLibraryItemDto, user: User) {
        const db = this.databaseService.database;

        const [createdLibraryItem] = await db
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

        return { message: 'Library item created successfully', data: createdLibraryItem };
    }

    async updateLibraryItem(uid: string, body: UpdateLibraryItemDto, user: User) {
        const db = this.databaseService.database;

        const [doesLibraryItemExist] = await db.select().from(libraryItem).where(eq(libraryItem.uid, uid));

        if (!doesLibraryItemExist) {
            throw new NotFoundException('Library item not found');
        }

        const [updatedLibraryItem] = await db
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

        return { message: 'Library item updated successfully', data: updatedLibraryItem };
    }
}
