import { User } from '@/database/schemas/user.schema';
import { Public } from '@/decorators/public.decorator';
import { LoginUserDto, RegisterUserDto } from '@/modules/auth/auth.dto';
import { AuthService } from '@/modules/auth/auth.service';
import { Body, Controller, Get, Post, Request, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) {}

    @Public()
    @Post('login')
    async login(@Body() loginUserDto: LoginUserDto) {
        return await this.authService.login(loginUserDto);
    }

    @Public()
    @Post('register')
    async register(@Body() registerUserDto: RegisterUserDto) {
        return await this.authService.register(registerUserDto);
    }

    @Public()
    @Get('google')
    @UseGuards(AuthGuard('google'))
    async googleAuth(@Request() req) {
        /* Guard redirects */
    }

    @Public()
    @Get('google/callback')
    @UseGuards(AuthGuard('google'))
    async googleAuthRedirect(@Request() req: { user: User }) {
        return await this.authService.loginOAuth(req.user);
    }

    @Public()
    @Get('facebook')
    @UseGuards(AuthGuard('facebook'))
    async facebookAuth(@Request() req) {
        /* Guard redirects */
    }

    @Public()
    @Get('facebook/callback')
    @UseGuards(AuthGuard('facebook'))
    async facebookAuthRedirect(@Request() req: { user: User }) {
        return await this.authService.loginOAuth(req.user);
    }
}
