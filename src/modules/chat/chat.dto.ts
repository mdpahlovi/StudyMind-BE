import { ChatMessageRole } from '@/database/schemas/chat.schema';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import * as dayjs from 'dayjs';

export class MessageDto {
    @ApiProperty({ description: 'Message UID', example: 'Hello' })
    @IsNotEmpty()
    uid: string;

    @ApiProperty({ description: 'Message role', example: 'USER' })
    @IsNotEmpty()
    role: ChatMessageRole;

    @ApiProperty({ description: 'Message', example: 'Hello, How are you?' })
    @IsNotEmpty()
    message: string;

    @ApiProperty({ description: 'Message timestamp', example: new Date() })
    @Transform(({ value }) => dayjs(value).subtract(6, 'hours').toDate())
    @IsNotEmpty()
    createdAt: Date;

    @ApiProperty({ description: 'Message timestamp', example: new Date() })
    @Transform(({ value }) => dayjs(value).subtract(6, 'hours').toDate())
    @IsNotEmpty()
    updatedAt: Date;
}

export class RequestQueryDto {
    @ApiProperty({ description: 'Message', example: 'Hello' })
    @ValidateNested({ each: true })
    @Type(() => MessageDto)
    message: MessageDto[];
}

export class UpdateChatSessionDto {
    @ApiProperty({ description: 'Chat session title', example: 'Computer Science' })
    @IsNotEmpty()
    title: string;
}

export class UpdateBulkChatSessionDto {
    @ApiProperty({ description: 'Chat session uid', example: '123' })
    @IsNotEmpty()
    uid: string[];

    @ApiProperty({ description: 'Chat session status', example: true })
    @IsOptional()
    isActive: boolean;
}
