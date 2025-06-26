import { SupabaseService } from '@/common/services/supabase.service';
import { getMimeType } from '@/utils/getMimeType';
import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { mdToPdf } from 'md-to-pdf';
import * as path from 'path';
import { firstValueFrom } from 'rxjs';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);

@Injectable()
export class DownloadService {
    constructor(
        private readonly httpService: HttpService,
        private readonly supabaseService: SupabaseService,
    ) {}

    async downloadFile(url: string, fileName: string, fileType: string) {
        try {
            const filePath = fileName
                .replace(/[^a-zA-Z0-9 ]/g, '')
                .toLowerCase()
                .concat(`_${Date.now()}.${fileType}`);
            const tempPath = path.join(path.join(__dirname, '..', '..', '..', 'public'), filePath);

            const response = await firstValueFrom(this.httpService.get(url, { responseType: 'stream' }));

            await streamPipeline(response.data, fs.createWriteStream(tempPath));

            const fileSize = fs.statSync(tempPath).size;
            const { data, error } = await this.supabaseService.storage.upload(filePath, fs.readFileSync(tempPath), {
                contentType: getMimeType(fileType),
            });
            if (error) {
                throw new HttpException(error.message, (error as any)?.statusCode ? Number((error as any)?.statusCode) : 500);
            }

            fs.unlinkSync(tempPath);
            const { publicUrl: fileUrl } = this.supabaseService.storage.getPublicUrl(data.path).data;
            return { filePath, fileUrl, fileSize };
        } catch (error) {
            throw new HttpException(`Failed to download file: ${error.message}`, HttpStatus.BAD_REQUEST);
        }
    }

    async downloadPdf(prompt: string, fileName: string) {
        try {
            const filePath = fileName
                .replace(/[^a-zA-Z0-9 ]/g, '')
                .toLowerCase()
                .concat(`_${Date.now()}.pdf`);
            const tempPath = path.join(path.join(__dirname, '..', '..', '..', 'public'), filePath);

            await mdToPdf({ content: prompt }, { dest: tempPath });

            const fileSize = fs.statSync(tempPath).size;
            const { data, error } = await this.supabaseService.storage.upload(filePath, fs.readFileSync(tempPath), {
                contentType: getMimeType('pdf'),
            });
            if (error) {
                throw new HttpException(error.message, (error as any)?.statusCode ? Number((error as any)?.statusCode) : 500);
            }

            fs.unlinkSync(tempPath);
            const { publicUrl: fileUrl } = this.supabaseService.storage.getPublicUrl(data.path).data;
            return { filePath, fileUrl, fileSize };
        } catch (error) {
            throw new HttpException(`Failed to download PDF: ${error.message}`, HttpStatus.BAD_REQUEST);
        }
    }
}
