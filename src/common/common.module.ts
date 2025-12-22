import { Global, Module } from '@nestjs/common';
import { DownloadService } from './services/download.service';
import { GenAIService } from './services/gen-ai.service';
import { HashService } from './services/hash.service';
import { SupabaseService } from './services/supabase.service';
import { VectorService } from './services/vector.service';

@Global()
@Module({
    providers: [DownloadService, GenAIService, HashService, SupabaseService, VectorService],
    exports: [DownloadService, GenAIService, HashService, SupabaseService, VectorService],
})
export class CommonModule {}
