import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import * as moment from 'moment';
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
    intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
        return next.handle().pipe(
            map(data => ({
                success: true,
                message: data.message || 'Request successful',
                data: data.data,
                timestamp: moment().format('DD MMM YYYY hh:mm'),
            })),
        );
    }
}
