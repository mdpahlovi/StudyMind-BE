import { User } from '@/database/schemas';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private jwtService: JwtService,
        private reflector: Reflector,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Check if the route is marked as public
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

        if (isPublic) return true;

        const request = context.switchToHttp().getRequest<Request>();
        const response = context.switchToHttp().getResponse<Response>();

        const accessToken = this.getAccessToken(request);
        const refreshToken = this.getRefreshToken(request);

        if (!accessToken && !refreshToken) {
            throw new UnauthorizedException('Please login');
        }

        try {
            if (accessToken) {
                const user = await this.verifyToken(accessToken);

                request.user = user;
                return true;
            }
        } catch (error) {
            if (refreshToken) {
                try {
                    const user = await this.verifyToken(refreshToken);

                    const accessToken = this.jwtService.sign(user, { expiresIn: '1h' });
                    response.setHeader('Authorization', `Bearer ${accessToken}`);

                    request.user = user;
                    return true;
                } catch (refreshError) {
                    throw new UnauthorizedException('Invalid refresh token');
                }
            }

            throw new UnauthorizedException('Invalid access and refresh token');
        }
    }

    private getAccessToken(request: Request): string | null {
        const [type, token] = request.headers.authorization?.split(' ') ?? [];
        return type === 'Bearer' ? token : null;
    }

    private getRefreshToken(request: Request): string | null {
        return request.cookies?.refreshToken || null;
    }

    private async verifyToken(token: string): Promise<User> {
        try {
            const payload = await this.jwtService.verifyAsync(token);

            delete payload.iat;
            delete payload.exp;
            return payload;
        } catch (error) {
            throw new UnauthorizedException('Invalid token');
        }
    }
}
