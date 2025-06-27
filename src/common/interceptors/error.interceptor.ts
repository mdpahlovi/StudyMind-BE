import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import * as moment from 'moment';
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
        const request = context.switchToHttp().getRequest();

        return next.handle().pipe(
            catchError(err => {
                let message = err.message || 'Internal server error';
                let error = err.name ? err.name.replace(/([A-Z])/g, ' $1').trim() : 'Unknown Error';
                let statusCode = err?.getStatus ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

                const errorResponse: ErrorResponse = {
                    success: false,
                    message,
                    error,
                    statusCode,
                    timestamp: moment().format('DD MMM YYYY hh:mm'),
                    path: request.url,
                };

                this.logger.error(
                    `[${statusCode}] ${context.switchToHttp().getRequest().method} ${context.switchToHttp().getRequest().url}`,
                    err,
                );

                return throwError(() => new HttpException(errorResponse, statusCode));
            }),
        );
    }
}
