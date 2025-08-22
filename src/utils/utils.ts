export function GetMimeType(fileType: string) {
    switch (fileType) {
        // Document formats
        case 'pdf':
            return 'application/pdf';
        case 'doc':
            return 'application/msword';
        case 'docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'txt':
            return 'text/plain';

        // Audio formats
        case 'mp3':
            return 'audio/mpeg';
        case 'wav':
            return 'audio/wav';
        case 'ogg':
            return 'audio/ogg';

        // Video formats
        case 'mp4':
            return 'video/mp4';
        case 'webm':
            return 'video/webm';
        case 'avi':
            return 'video/x-msvideo';
        case 'mov':
            return 'video/quicktime';
        case 'mkv':
            return 'video/x-matroska';

        // Image formats
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'gif':
            return 'image/gif';

        default:
            return 'application/octet-stream';
    }
}
