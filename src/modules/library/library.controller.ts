import { User } from '@/database/schemas';
import { CurrentUser } from '@/decorators/current-user.decorator';
import { CreateLibraryItemDto, UpdateLibraryItemDto } from '@/modules/library/library.dto';
import { LibraryService } from '@/modules/library/library.service';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Library')
@Controller('library')
export class LibraryController {
    constructor(private readonly libraryService: LibraryService) {}

    @ApiOperation({ summary: 'Retrieve all library item' })
    @Get()
    async getLibraryItems(@Query() query: any, @CurrentUser() user: User) {
        return this.libraryService.getLibraryItems(query, user);
    }

    @ApiOperation({ summary: 'Retrieve library items by type' })
    @Get('by-type')
    async getLibraryItemsByType(@Query() query: any, @CurrentUser() user: User) {
        return this.libraryService.getLibraryItemsByType(query, user);
    }

    @ApiOperation({ summary: 'Retrieve library items with path' })
    @Get('with-path')
    async getLibraryItemsWithPath(@Query() query: any, @CurrentUser() user: User) {
        return this.libraryService.getLibraryItemsWithPath(query, user);
    }

    @ApiOperation({ summary: 'Retrieve library item by uid' })
    @Get(':uid')
    async getLibraryItemByUid(@Param('uid') uid: string, @CurrentUser() user: User) {
        return this.libraryService.getLibraryItemByUid(uid, user);
    }

    @ApiOperation({ summary: 'Create a new library item' })
    @Post()
    async createLibraryItem(@Body() body: CreateLibraryItemDto, @CurrentUser() user: User) {
        return this.libraryService.createLibraryItem(body, user);
    }

    @ApiOperation({ summary: 'Update a library item' })
    @Patch(':uid')
    async updateLibraryItem(@Param('uid') uid: string, @Body() body: UpdateLibraryItemDto, @CurrentUser() user: User) {
        return this.libraryService.updateLibraryItem(uid, body, user);
    }
}
