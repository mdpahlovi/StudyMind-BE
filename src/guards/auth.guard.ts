import { User } from '@/database/schemas';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private jwtService: JwtService, private reflector: Reflector) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

        if (isPublic) return true;

        const request = context.switchToHttp().getRequest<Request>();
        const response = context.switchToHttp().getResponse<Response>();

        const accessToken = this.getAccessToken(request);
        const refreshToken = this.getRefreshToken(request);

        if (!accessToken && !refreshToken) {
            throw new UnauthorizedException('Please login');
        }

        // Try to authenticate with access token first
        const userFromAccessToken = await this.tryVerifyAccessToken(accessToken);
        if (userFromAccessToken) {
            // @ts-ignore
            request.user = userFromAccessToken;
            return true;
        }

        // If access token failed, try refresh token
        const userFromRefreshToken = await this.tryRefreshTokenFlow(refreshToken, response);
        if (userFromRefreshToken) {
            // @ts-ignore
            request.user = userFromRefreshToken;
            return true;
        }

        // Both tokens failed
        throw new UnauthorizedException('Invalid access and refresh token');
    }

    private getAccessToken(request: Request): string | null {
        const [type, token] = request.headers.authorization?.split(' ') ?? [];
        return type === 'Bearer' ? token : null;
    }

    private getRefreshToken(request: Request): string | null {
        return (request.headers['x-refresh-token'] as string) || null;
    }

    private async verifyToken(token: string): Promise<User> {
        try {
            const payload = await this.jwtService.verifyAsync(token);

            // Clean up JWT metadata
            delete payload.iat;
            delete payload.exp;

            return payload as User;
        } catch (error) {
            throw new UnauthorizedException('Invalid token');
        }
    }

    private async tryVerifyAccessToken(accessToken: string | null): Promise<User | null> {
        try {
            return await this.verifyToken(accessToken);
        } catch (error) {
            return null;
        }
    }

    private async tryRefreshTokenFlow(refreshToken: string | null, response: Response): Promise<User | null> {
        if (!refreshToken) return null;

        try {
            const user = await this.verifyToken(refreshToken);

            // Generate new access token
            const newAccessToken = this.jwtService.sign(user, { expiresIn: '1h' });
            response.setHeader('x-access-token', newAccessToken);

            return user;
        } catch (error) {
            throw new UnauthorizedException('Invalid refresh token');
        }
    }
}
