import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class VectorService {
    private pinecone: Pinecone;
    private embeddings: GoogleGenerativeAIEmbeddings;
    private vectorStore: PineconeStore;
    private textSplitter: RecursiveCharacterTextSplitter;
    private genAI: GoogleGenerativeAI;
    private visionModel: any;

    constructor(private readonly configService: ConfigService) {
        this.initialize();
    }

    private initialize() {
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

        this.genAI = new GoogleGenerativeAI(this.configService.get<string>('gemini.apiKey'));
        this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    }

    private async processPDF(filePath: string) {
        try {
            if (!fs.existsSync(filePath)) {
                throw new BadRequestException(`PDF file not found: ${filePath}`);
            }

            const pdfLoader = new PDFLoader(filePath, { splitPages: true });
            const documents = await pdfLoader.load();
            console.log(`Loaded ${documents.length} pages from PDF: ${filePath}`);

            return documents
                .filter(doc => doc.pageContent.trim().length > 0)
                .map((doc, index) => {
                    doc.metadata = {
                        ...doc.metadata,
                        fileName: path.basename(filePath),
                        pageNumber: index + 1,
                        loadedAt: new Date().toISOString(),
                        contentLength: doc.pageContent.length,
                    };
                    return doc;
                });
        } catch (error) {
            throw new BadRequestException(`Failed to load pdf: ${error}`);
        }
    }

    async processAndEmbedPDF(filePath: string, itemUid: string, userUid: string): Promise<string[]> {
        try {
            const documents = await this.processPDF(filePath);
            if (documents.length === 0) {
                throw new BadRequestException('No content found in pdf');
            }

            const splitDocs = await this.textSplitter.splitDocuments(documents);
            console.log(`Split into ${splitDocs.length} chunks`);

            splitDocs.forEach((doc, index) => {
                doc.metadata.userUid = userUid;
                doc.metadata.itemUid = itemUid;
                doc.metadata.chunkId = `${userUid}_${itemUid}_${index}`;
                doc.metadata.chunkIndex = index;
                doc.metadata.totalChunks = splitDocs.length;
            });

            const vectorIds = await this.vectorStore.addDocuments(splitDocs);
            console.log(`Successfully embedded ${vectorIds.length} document chunks`);

            return vectorIds;
        } catch (error) {
            throw new BadRequestException(`Failed to embed pdf: ${error}`);
        }
    }

    async searchByItemUid(query: string, itemUid: string): Promise<string> {
        try {
            const filters = { itemUid: { $eq: itemUid } };
            const queryEmbedding = await this.embeddings.embedQuery(query);
            const results = await this.vectorStore.similaritySearchVectorWithScore(queryEmbedding, 10, filters);

            if (results.length === 0) return 'No relevant content found for your query.';

            const combineContent = results.map(([document]) => document.pageContent).join('\n\n---\n\n');

            console.log(`Found ${results.length} results for itemUid: ${itemUid}`);
            return combineContent;
        } catch (error) {
            throw new BadRequestException(`Failed to search contents: ${error}`);
        }
    }
}
