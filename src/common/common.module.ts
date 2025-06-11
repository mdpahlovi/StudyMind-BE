import { HashService } from '@/common/services/hash.service';
import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './services/supabase.service';

@Global()
@Module({
    providers: [HashService, SupabaseService],
    exports: [HashService, SupabaseService],
})
export class CommonModule {}
