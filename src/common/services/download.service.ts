import { SupabaseService } from '@/common/services/supabase.service';
import { GetMimeType } from '@/utils/utils';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { firstValueFrom } from 'rxjs';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);

type ToolResponse = {
    success: boolean;
    message: string;
    data: {
        duration?: number;
        fileName: string;
        fileUrl: string;
        fileSize: number;
    };
};

@Injectable()
export class DownloadService {
    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly supabaseService: SupabaseService,
    ) {}

    async downloadFile(url: string, fileName: string, fileType: string) {
        try {
            const filePath = fileName
                .replace(/[^a-zA-Z0-9]/g, '_')
                .toLowerCase()
                .concat(`_${Date.now()}.${fileType}`);
            const tempPath = path.join(path.join(__dirname, '..', '..', '..', 'public'), filePath);

            const response = await firstValueFrom(this.httpService.get(url, { responseType: 'stream' }));
            await streamPipeline(response.data, fs.createWriteStream(tempPath));

            const fileSize = fs.statSync(tempPath).size;
            const { data, error } = await this.supabaseService.storage.upload(filePath, fs.readFileSync(tempPath), {
                contentType: GetMimeType(fileType),
            });
            if (error) throw new BadRequestException(`Failed to upload file: ${error.message}`);

            fs.unlinkSync(tempPath);

            const { publicUrl: fileUrl } = this.supabaseService.storage.getPublicUrl(data.path).data;
            return { filePath, fileUrl, fileSize };
        } catch (error) {
            throw new HttpException(`Failed to download file: ${error}`, HttpStatus.BAD_REQUEST);
        }
    }

    async downloadTool(contents: string, fileName: string, fileType: string) {
        try {
            fileName = fileName
                .replace(/[^a-zA-Z0-9]/g, '_')
                .toLowerCase()
                .concat(`_${Date.now()}.${fileType}`);

            const response = await firstValueFrom(
                this.httpService.post<ToolResponse>(`${this.configService.get('tools')}/${this.toolRoute(fileType)}`, {
                    contents,
                    fileName,
                }),
            );

            if (response.status !== 200) {
                throw new HttpException(`Failed to download tool`, HttpStatus.BAD_REQUEST);
            }

            return { fileType, ...response.data.data };
        } catch (error) {
            throw new HttpException(`Failed to download tool: ${error}`, HttpStatus.BAD_REQUEST);
        }
    }

    toolRoute(filePath: string) {
        switch (filePath) {
            case 'pdf':
                return 'markdown-to-pdf';
            case 'mp3':
                return 'text-to-audio';
            default:
                return '';
        }
    }
}
