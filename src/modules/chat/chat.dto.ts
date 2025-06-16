import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class RequestQueryDto {
    @ApiProperty({ description: 'Message', example: 'Hello! How are you?' })
    @IsNotEmpty()
    message: string;
}
