import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { firstValueFrom } from 'rxjs';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);

@Injectable()
export class DownloadService {
    constructor(private readonly httpService: HttpService) {}

    async downloadFile(url: string, fileName: string, fileType: string): Promise<string> {
        try {
            const filePath = path.join(
                path.join(__dirname, '..', '..', '..', 'public'),
                fileName.replace(/ /g, '_').toLowerCase().concat(`.${fileType}`),
            );

            const response = await firstValueFrom(
                this.httpService.get(url, {
                    responseType: 'stream',
                }),
            );

            await streamPipeline(response.data, fs.createWriteStream(filePath));
            return filePath;
        } catch (error) {
            throw new HttpException(`Failed to download file: ${error.message}`, HttpStatus.BAD_REQUEST);
        }
    }
}
