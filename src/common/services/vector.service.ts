import { getMimeType } from '@/utils/getMimeType';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { Document } from '@langchain/core/documents';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { SupabaseService } from './supabase.service';

@Injectable()
export class VectorService {
    private pinecone: Pinecone;
    private embeddings: GoogleGenerativeAIEmbeddings;
    private vectorStore: PineconeStore;
    private textSplitter: RecursiveCharacterTextSplitter;

    constructor(
        private readonly configService: ConfigService,
        private readonly supabaseService: SupabaseService,
    ) {
        this.initializePinecone();
        this.initializeTextSplitter();
    }

    private async initializePinecone() {
        this.pinecone = new Pinecone({
            apiKey: this.configService.get<string>('pinecone.apiKey'),
        });

        this.embeddings = new GoogleGenerativeAIEmbeddings({
            apiKey: this.configService.get<string>('gemini.apiKey'),
            modelName: 'text-embedding-004',
        });

        const index = this.pinecone.Index(this.configService.get<string>('pinecone.index'));

        this.vectorStore = new PineconeStore(this.embeddings, { pineconeIndex: index });
    }

    private initializeTextSplitter() {
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
            separators: ['\n\n', '\n', ' ', ''],
        });
    }

    async embedPdf(metadata: any): Promise<string[]> {
        try {
            const { data, error } = await this.supabaseService.downloadFile(metadata?.filePath);

            if (error) {
                throw new Error(`Failed to download file from Supabase: ${error.message}`);
            }

            const arrayBuffer = await data.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const blob = new Blob([buffer], { type: getMimeType(metadata?.fileType) });
            const loader = new PDFLoader(blob, { splitPages: true });
            const docs = await loader.load();

            docs.forEach(doc => {
                doc.metadata = {
                    ...doc.metadata,
                    ...metadata,
                    processedAt: new Date().toISOString(),
                };
            });

            const splitDocs = await this.textSplitter.splitDocuments(docs);

            const ids = await this.vectorStore.addDocuments(splitDocs);

            return ids;
        } catch (error) {
            throw new Error(`Failed to embed PDF from Supabase: ${error.message}`);
        }
    }

    async searchSimilarDocuments(query: string, k: number = 5): Promise<Document[]> {
        try {
            const results = await this.vectorStore.similaritySearch(query, k);
            return results;
        } catch (error) {
            throw new Error(`Failed to search documents: ${error.message}`);
        }
    }

    async searchSimilarDocumentsWithScore(query: string, k: number = 5): Promise<[Document, number][]> {
        try {
            const results = await this.vectorStore.similaritySearchWithScore(query, k);
            return results;
        } catch (error) {
            throw new Error(`Failed to search documents with score: ${error.message}`);
        }
    }

    async deletePdfEmbeddings(ids: string[]): Promise<void> {
        try {
            await this.vectorStore.delete({ ids });
        } catch (error) {
            throw new Error(`Failed to delete embeddings: ${error.message}`);
        }
    }
}
