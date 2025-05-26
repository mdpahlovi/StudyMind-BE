import { LibraryService } from '@/modules/library/library.service';
import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Library')
@Controller('library')
export class LibraryController {
    constructor(private readonly libraryService: LibraryService) {}

    @ApiOperation({ summary: 'Get all library items' })
    @Get()
    async getLibraryItems() {
        return this.libraryService.getLibraryItems();
    }

    @ApiOperation({ summary: 'Create a new library item' })
    @Post()
    async createLibraryItem() {
        return this.libraryService.createLibraryItem();
    }

    @ApiOperation({ summary: 'Update a library item' })
    @Patch()
    async updateLibraryItem() {
        return this.libraryService.updateLibraryItem();
    }

    @ApiOperation({ summary: 'Library item status update' })
    @Delete()
    async deleteLibraryItem() {
        return this.libraryService.deleteLibraryItem();
    }
}
