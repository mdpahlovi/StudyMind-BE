import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
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
        try {
            return next.handle().pipe(
                map(data => ({
                    success: true,
                    message: 'Request successful',
                    data,
                    timestamp: new Date().toISOString(),
                })),
            );
        } catch (error) {
            console.log(error);

            return next.handle().pipe(
                map(data => ({
                    success: false,
                    message: 'Request failed',
                    data,
                    timestamp: new Date().toISOString(),
                })),
            );
        }
    }
}
