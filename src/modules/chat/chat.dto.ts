import { ChatMessageRole } from '@/database/schemas/chat.schema';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { v4 as uuidv4 } from 'uuid';

export class RequestQueryDto {
    @ApiProperty({ description: 'Conversation UID', example: uuidv4() })
    @IsNotEmpty()
    uid: string;

    @ApiProperty({ description: 'Role', example: 'USER' })
    @IsNotEmpty()
    role: ChatMessageRole;

    @ApiProperty({ description: 'Message', example: 'Hello! How are you?' })
    @IsNotEmpty()
    message: string;

    @ApiProperty({ description: 'Created At', example: new Date().toISOString() })
    @IsNotEmpty()
    createdAt: Date;

    @ApiProperty({ description: 'Updated At', example: new Date().toISOString() })
    @IsNotEmpty()
    updatedAt: Date;
}
