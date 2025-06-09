import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
    uploadFile(file: Express.Multer.File) {
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream((error, result) => {
                if (error) return reject(error);
                resolve(result);
            });

            streamifier.createReadStream(file.buffer).pipe(uploadStream);
        });
    }
}
