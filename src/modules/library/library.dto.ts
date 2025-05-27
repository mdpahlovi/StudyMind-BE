import { LibraryItemType } from '@/database/schemas/library.schema';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class CreateLibraryItemDto {
    @ApiProperty({ description: 'Library item name', example: 'Computer Science' })
    @IsNotEmpty()
    name: string;

    @ApiProperty({ description: 'Library item type', example: 'FOLDER' })
    @IsNotEmpty()
    type: LibraryItemType;

    @ApiProperty({ description: 'Library item parent ID', example: null })
    @IsOptional()
    parentId: number | null;

    @ApiProperty({ description: 'Library item path', example: '/Computer Science' })
    @IsNotEmpty()
    path: string;

    @ApiProperty({ description: 'Library item metadata', example: {} })
    @IsOptional()
    metadata: any;

    @ApiProperty({ description: 'Library item sort order', example: 0 })
    @IsOptional()
    sortOrder: number;
}

export class UpdateLibraryItemDto {
    @ApiProperty({ description: 'Library item active status', example: true })
    @IsOptional()
    isActive: boolean;

    @ApiProperty({ description: 'Library item name', example: 'Computer Science' })
    @IsOptional()
    name: string;

    @ApiProperty({ description: 'Library item type', example: 'FOLDER' })
    @IsOptional()
    type: LibraryItemType;

    @ApiProperty({ description: 'Library item parent ID', example: null })
    @IsOptional()
    parentId: number | null;

    @ApiProperty({ description: 'Library item path', example: '/Computer Science' })
    @IsOptional()
    path: string;

    @ApiProperty({ description: 'Library item metadata', example: {} })
    @IsOptional()
    metadata: any;

    @ApiProperty({ description: 'Library item sort order', example: 0 })
    @IsOptional()
    sortOrder: number;
}
