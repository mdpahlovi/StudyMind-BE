import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import dayjs from 'dayjs';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
    success: boolean;
    message: string;
    data: T;
    timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
    private readonly logger = new Logger(ResponseInterceptor.name);
    intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
        const request = context.switchToHttp().getRequest<Request>();
        this.logger.debug(`[${200}] ${request.method} ${request.url}`);

        return next.handle().pipe(
            map((data: Response<T>) => ({
                success: true,
                message: data.message || 'Request successful',
                data: data.data,
                timestamp: dayjs().format('DD MMM YYYY hh:mm'),
            })),
        );
    }
}
