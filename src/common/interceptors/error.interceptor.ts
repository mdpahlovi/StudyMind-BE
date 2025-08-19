import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import dayjs from 'dayjs';
import { Request } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface ErrorResponse {
    success: boolean;
    message: string;
    error?: string;
    statusCode: number;
    timestamp: string;
    path: string;
}

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
    private readonly logger = new Logger(ErrorInterceptor.name);
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest<Request>();

        return next.handle().pipe(
            catchError((err: { message?: string; name?: string; getStatus?: () => number }) => {
                const message = err?.message || 'Internal server error';
                const error = err?.name ? err.name.replace(/([A-Z])/g, ' $1').trim() : 'Unknown Error';
                const statusCode = err?.getStatus ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

                const errorResponse: ErrorResponse = {
                    success: false,
                    message,
                    error,
                    statusCode,
                    timestamp: dayjs().format('DD MMM YYYY hh:mm'),
                    path: request.url,
                };

                this.logger.error(`[${statusCode}] ${request.method} ${request.url}`, err);

                return throwError(() => new HttpException(errorResponse, statusCode));
            }),
        );
    }
}
