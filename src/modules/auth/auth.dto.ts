import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginUserDto {
    @ApiProperty({ description: 'User email', example: 'mdpahlovi@gmail.com' })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({ description: 'User password', example: '123456' })
    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    password: string;
}

export class RegisterUserDto {
    @ApiProperty({ description: 'User name', example: 'MD Pahlovi' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ description: 'User email', example: 'mdpahlovi@gmail.com' })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({ description: 'User password', example: '123456' })
    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    password: string;
}
