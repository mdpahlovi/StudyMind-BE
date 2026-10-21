import { GetMimeType } from '@/utils/utils';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SupabaseService {
    private readonly supabase: SupabaseClient;

    constructor(private readonly configService: ConfigService) {
        const supabaseUrl = this.configService.get<string>('supabase.url');
        const supabaseKey = this.configService.get<string>('supabase.key');

        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    async uploadFile(file: Express.Multer.File, uid: string, fileType: string) {
        const filePath = `${uid}/original.${fileType}`;

        const { data, error } = await this.supabase.storage.from('studymind').upload(filePath, file.buffer, {
            contentType: GetMimeType(fileType),
        });
        if (error) throw new BadRequestException('Filed to upload file');

        const { publicUrl: fileUrl } = this.supabase.storage.from('studymind').getPublicUrl(data.path).data;
        return { filePath, fileUrl, fileSize: file.size };
    }

    async downloadFile(filePath: string) {
        const { data, error } = await this.supabase.storage.from('studymind').download(filePath);
        if (error) throw new BadRequestException('Failed to download file');

        const tempPath = path.join(path.join(__dirname, '..', '..', '..', 'public'), path.basename(filePath));
        fs.writeFileSync(tempPath, Buffer.from(await data.arrayBuffer()));

        return tempPath;
    }

    get storage() {
        return this.supabase.storage.from('studymind');
    }

    async listFilesRecursively(folder: string): Promise<string[]> {
        const filePaths: string[] = [];
        const { data, error } = await this.storage.list(folder);
        if (error || !data) return filePaths;

        for (const item of data) {
            const itemPath = folder ? `${folder}/${item.name}` : item.name;
            if (item.id === null) {
                const nested = await this.listFilesRecursively(itemPath);
                filePaths.push(...nested);
            } else {
                filePaths.push(itemPath);
            }
        }
        return filePaths;
    }

    async deleteFolder(folder: string): Promise<void> {
        const files = await this.listFilesRecursively(folder);
        if (files.length > 0) {
            await this.storage.remove(files);
        }
    }
}
