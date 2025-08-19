import type { User } from '@/database/schemas';

declare module 'express' {
    interface Request {
        user: User;
    }
}
