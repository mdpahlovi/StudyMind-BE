import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import * as dayjs from 'dayjs';
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
        this.logger.debug(`[${200}] ${context.switchToHttp().getRequest().method} ${context.switchToHttp().getRequest().url}`);

        return next.handle().pipe(
            map(data => ({
                success: true,
                message: data.message || 'Request successful',
                data: data.data,
                timestamp: dayjs().format('DD MMM YYYY hh:mm'),
            })),
        );
    }
}
