import { GoogleGenerativeAI } from '@google/generative-ai';
import { Document } from '@langchain/core/documents';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { PDFExtract } from 'pdf.js-extract';
import * as pdf2pic from 'pdf2pic';
import { GenAIService } from './gen-ai.service';
import { SupabaseService } from './supabase.service';

interface ProcessedContent {
    text: string;
    images: string[];
    metadata: {
        pageNumber: number;
        contentType?: 'TEXT' | 'IMAGE' | 'MIXED';
        hasFormulas?: boolean;
        hasDiagrams?: boolean;
        hasHandwriting?: boolean;
    };
}

@Injectable()
export class VectorService {
    private pinecone: Pinecone;
    private embeddings: GoogleGenerativeAIEmbeddings;
    private vectorStore: PineconeStore;
    private textSplitter: RecursiveCharacterTextSplitter;
    private genAI: GoogleGenerativeAI;
    private visionModel: any;

    constructor(
        private readonly configService: ConfigService,
        private readonly genAIService: GenAIService,
        private readonly supabaseService: SupabaseService,
    ) {
        this.initializePinecone();
    }

    private async initializePinecone() {
        try {
            this.pinecone = new Pinecone({
                apiKey: this.configService.get<string>('pinecone.apiKey'),
            });

            this.embeddings = new GoogleGenerativeAIEmbeddings({
                apiKey: this.configService.get<string>('gemini.apiKey'),
                modelName: 'text-embedding-004',
            });

            const index = this.pinecone.Index(this.configService.get<string>('pinecone.index'));

            this.vectorStore = new PineconeStore(this.embeddings, {
                pineconeIndex: index,
            });

            this.textSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: 1000,
                chunkOverlap: 200,
                separators: ['\n\n', '\n', '. ', ' ', ''],
            });

            console.log('Pinecone initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Pinecone', error);
            throw error;
        }
    }

    async processPDFDocument(filePath: string, libraryItemId: number, userId: number) {
        try {
            const processedContent = await this.extractPDFContent(filePath);

            console.log(processedContent);

            const embeddingPromises = processedContent.map((content, index) =>
                this.processPageContent(content, libraryItemId, userId, index),
            );

            const results = await Promise.allSettled(embeddingPromises);

            const successCount = results.filter(r => r.status === 'fulfilled').length;

            console.log(`PDF processing completed: ${successCount}/${results.length} pages processed successfully`);

            return !!!successCount;
        } catch (error) {
            console.error('Failed to process PDF document', error);
            throw new BadRequestException('Failed to process PDF document');
        }
    }

    private async extractPDFContent(filePath: string): Promise<ProcessedContent[]> {
        const processedPages: ProcessedContent[] = [];

        try {
            const pdfExtract = new PDFExtract();
            const textData = await new Promise<any>((resolve, reject) => {
                pdfExtract.extract(filePath, {}, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });

            const convert = pdf2pic.fromPath(filePath, {
                density: 150,
                saveFilename: 'page',
                savePath: './temp',
                format: 'png',
                width: 2048,
                height: 2048,
            });

            for (let i = 0; i < textData.pages.length; i++) {
                const page = textData.pages[i];
                const pageText = page.content.map((item: any) => item.str).join(' ');
                const imageResult = await convert(i + 1, { responseType: 'base64' });
                const imageBase64 = imageResult.base64;

                const analysis = await this.genAIService.analyzeContents(imageBase64);

                processedPages.push({
                    text: pageText.trim(),
                    images: [imageBase64],
                    metadata: { pageNumber: i + 1, ...analysis },
                });
            }

            return processedPages;
        } catch (error) {
            console.error('PDF content extraction failed', error);
            throw new BadRequestException('Failed to extract PDF content');
        }
    }

    private async processPageContent(content: ProcessedContent, libraryItemId: number, userId: number, pageIndex: number): Promise<void> {
        const combinedText = [content.text].filter(Boolean).join('\n');

        if (!combinedText.trim()) {
            console.warn(`Page ${pageIndex + 1} has no extractable text`);
            return;
        }

        const chunks = await this.textSplitter.splitText(combinedText);

        const documents = chunks.map((chunk, chunkIndex) => {
            return new Document({
                pageContent: chunk,
                metadata: {
                    libraryItemId,
                    userId,
                    pageNumber: content.metadata.pageNumber,
                    chunkIndex,
                    contentType: content.metadata.contentType,
                    hasFormulas: content.metadata.hasFormulas,
                    hasDiagrams: content.metadata.hasDiagrams,
                    hasHandwriting: content.metadata.hasHandwriting,
                    text: content.text,
                    source: 'pdf',
                    createdAt: new Date().toISOString(),
                },
            });
        });

        await this.vectorStore.addDocuments(documents);

        console.log(`Page ${content.metadata.pageNumber} processed: ${chunks.length} chunks created`);
    }
}
