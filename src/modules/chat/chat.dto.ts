import { ChatMessageRole } from '@/database/schemas/chat.schema';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';

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
    @IsNotEmpty()
    createdAt: Date;

    @ApiProperty({ description: 'Message timestamp', example: new Date() })
    @IsNotEmpty()
    updatedAt: Date;
}

export class RequestQueryDto {
    @ApiProperty({ description: 'Message', example: 'Hello' })
    @ValidateNested({ each: true })
    @Type(() => MessageDto)
    message: MessageDto[];
}
