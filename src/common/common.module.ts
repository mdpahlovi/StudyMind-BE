import { HashService } from '@/common/services/hash.service';
import { Global, Module } from '@nestjs/common';
import { GenAIService } from './services/gen-ai.service';
import { SupabaseService } from './services/supabase.service';
import { VectorService } from './services/vector.service';

@Global()
@Module({
    providers: [GenAIService, HashService, SupabaseService, VectorService],
    exports: [GenAIService, HashService, SupabaseService, VectorService],
})
export class CommonModule {}
