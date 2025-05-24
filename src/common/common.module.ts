import { HashService } from '@/common/services/hash.service';
import { Global, Module } from '@nestjs/common';

@Global()
@Module({
    providers: [HashService],
    exports: [HashService],
})
export class CommonModule {}
