import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';

@Injectable()
export class VectorService {
    private pinecone: Pinecone;
    private embeddings: GoogleGenerativeAIEmbeddings;
    private vectorStore: PineconeStore;

    constructor(private readonly configService: ConfigService) {
        this.initializePinecone();
    }

    private async initializePinecone() {
        // Initialize Pinecone
        this.pinecone = new Pinecone({
            apiKey: this.configService.get<string>('pinecone.apiKey'),
        });

        // Initialize Gemini Embeddings
        this.embeddings = new GoogleGenerativeAIEmbeddings({
            apiKey: this.configService.get<string>('gemini.apiKey'),
            modelName: 'text-embedding-004',
        });

        // Get index
        const index = this.pinecone.Index(this.configService.get<string>('pinecone.index'));

        // Initialize vector store
        this.vectorStore = new PineconeStore(this.embeddings, { pineconeIndex: index });
    }
}
