import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
    constructor(private readonly configService: ConfigService) {}

    private supabaseUrl = this.configService.get<string>('supabase.url');
    private supabaseKey = this.configService.get<string>('supabase.key');

    private supabase = createClient(this.supabaseUrl, this.supabaseKey);

    async uploadFile(file: Express.Multer.File) {
        const { data, error } = await this.supabase.storage.from('studymind').upload(`${Date.now()}-${file.originalname}`, file.buffer);
        if (error) {
            throw new HttpException(error.message, (error as any)?.statusCode ? Number((error as any)?.statusCode) : 500);
        }

        const { publicUrl } = this.supabase.storage.from('studymind').getPublicUrl(data.path).data;
        return publicUrl;
    }
}
