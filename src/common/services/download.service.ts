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
        filePath: string;
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

    async downloadFile(url: string, uid: string, fileType: string) {
        try {
            const filePath = `${uid}/original.${fileType}`;
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

    async downloadTool(contents: string, uid: string, fileType: string) {
        try {
            const filePath = `${uid}/original.${fileType}`;

            const response = await firstValueFrom(
                this.httpService.post<ToolResponse>(`${this.configService.get('tools')}/${this.toolRoute(fileType)}`, {
                    contents,
                    filePath,
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
