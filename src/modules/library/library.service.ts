import { DatabaseService } from '@/database/database.service';
import { libraryItem } from '@/database/schemas/library.schema';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

@Injectable()
export class LibraryService {
    constructor(private readonly databaseService: DatabaseService) {}

    async getLibraryItems() {
        const db = this.databaseService.database;
        return db.select().from(libraryItem);
    }

    async createLibraryItem() {
        const db = this.databaseService.database;
        return db.insert(libraryItem).values({
            name: 'New Library Item',
            type: 'NOTE',
            userId: 1,
            path: 'path/to/library/item',
        });
    }

    async updateLibraryItem() {
        const db = this.databaseService.database;
        return db
            .update(libraryItem)
            .set({
                name: 'Updated Library Item',
            })
            .where(eq(libraryItem.id, 1));
    }

    async deleteLibraryItem() {
        const db = this.databaseService.database;
        return db.delete(libraryItem).where(eq(libraryItem.id, 1));
    }
}
