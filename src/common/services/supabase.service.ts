import { getMimeType } from '@/utils/getMimeType';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

@Injectable()
export class SupabaseService {
    constructor(private readonly configService: ConfigService) {}

    private supabaseUrl = this.configService.get<string>('supabase.url');
    private supabaseKey = this.configService.get<string>('supabase.key');

    private supabase = createClient(this.supabaseUrl, this.supabaseKey);

    public storage = this.supabase.storage.from('studymind');

    async uploadFile(file: Express.Multer.File, fileType: string) {
        const filePath = `${Date.now()}_${file.originalname.replace(/ /g, '_').toLowerCase()}`;
        const { data, error } = await this.supabase.storage.from('studymind').upload(filePath, file.buffer, {
            contentType: getMimeType(fileType),
        });
        if (error) {
            throw new BadRequestException('Filed to upload file');
        }

        const { publicUrl: fileUrl } = this.supabase.storage.from('studymind').getPublicUrl(data.path).data;
        return { filePath, fileUrl, fileSize: file.size };
    }

    async downloadFile(filePath: string) {
        const { data, error } = await this.supabase.storage.from('studymind').download(filePath);
        if (error) {
            throw new BadRequestException('Failed to download file');
        }

        const tempFilePath = path.join(os.tmpdir(), `temp_${Date.now()}.pdf`);
        fs.writeFileSync(tempFilePath, Buffer.from(await data.arrayBuffer()));

        return tempFilePath;
    }
}
