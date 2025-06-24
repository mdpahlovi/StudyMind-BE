import { LibraryItemType } from '@/database/schemas/library.schema';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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

    @ApiProperty({ description: 'Library item metadata', example: {} })
    @Transform(({ value }) => (value ? JSON.parse(value) : null))
    @IsOptional()
    metadata: any;
}

export class UpdateLibraryItemDto {
    @ApiProperty({ description: 'Library item active status', example: true })
    @IsOptional()
    isActive: boolean;

    @ApiProperty({ description: 'Library item embedded status', example: true })
    @IsOptional()
    isEmbedded: boolean;

    @ApiProperty({ description: 'Library item name', example: 'Computer Science' })
    @IsOptional()
    name: string;

    @ApiProperty({ description: 'Library item parent ID', example: null })
    @IsOptional()
    parentId: number | null;

    @ApiProperty({ description: 'Library item metadata', example: {} })
    @IsOptional()
    metadata: any;
}

export class UpdateBulkLibraryItemsDto {
    @ApiProperty({ description: 'Library item uid', example: '123' })
    @IsNotEmpty()
    uid: string[];

    @ApiProperty({ description: 'Library item active status', example: true })
    @IsOptional()
    isActive: boolean;

    @ApiProperty({ description: 'Library item parent ID', example: null })
    @IsOptional()
    parentId: number | null;
}
