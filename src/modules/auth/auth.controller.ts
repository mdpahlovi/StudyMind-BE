import { Public } from '@/decorators/public.decorator';
import { LoginUserDto, RegisterUserDto } from '@/modules/auth/auth.dto';
import { AuthService } from '@/modules/auth/auth.service';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) {}

    @Public()
    @Post('login')
    @ApiOperation({ summary: 'Login' })
    async login(@Body() loginUserDto: LoginUserDto) {
        return await this.authService.login(loginUserDto);
    }

    @Public()
    @Post('register')
    @ApiOperation({ summary: 'Register' })
    async register(@Body() registerUserDto: RegisterUserDto) {
        return await this.authService.register(registerUserDto);
    }
}
