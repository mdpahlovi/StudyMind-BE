import { EMBEDDING_DIMENSIONS } from '@/database/schemas/chunk.schema';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY' | 'CLASSIFICATION' | 'CLUSTERING';

type BatchEmbedResponse = { embeddings?: { values?: number[] }[] };

/** Talks to the Gemini REST API directly: `@langchain/google-genai` does not expose `outputDimensionality`. */
@Injectable()
export class EmbeddingService {
    private readonly logger = new Logger(EmbeddingService.name);

    private static readonly MODEL = 'gemini-embedding-001';
    private static readonly BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
    private static readonly BATCH_SIZE = 20;
    private static readonly MAX_ATTEMPTS = 4;
    /** ~8000 chars keeps chunks under the model's 2048-token input limit. */
    private static readonly MAX_INPUT_CHARS = 8000;

    readonly dimensions = EMBEDDING_DIMENSIONS;

    constructor(
        private readonly configService: ConfigService,
        private readonly httpService: HttpService,
    ) {}

    async embedQuery(text: string): Promise<number[]> {
        const [embedding] = await this.embed([text], 'RETRIEVAL_QUERY');
        return embedding;
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        if (!texts.length) return [];
        return this.embed(texts, 'RETRIEVAL_DOCUMENT');
    }

    private async embed(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
        const embeddings: number[][] = [];

        for (let i = 0; i < texts.length; i += EmbeddingService.BATCH_SIZE) {
            const batch = texts.slice(i, i + EmbeddingService.BATCH_SIZE);
            embeddings.push(...(await this.embedBatch(batch, taskType)));
        }

        return embeddings;
    }

    private async embedBatch(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
        const requests = texts.map(text => ({
            model: `models/${EmbeddingService.MODEL}`,
            content: { parts: [{ text: text.slice(0, EmbeddingService.MAX_INPUT_CHARS) }] },
            taskType,
            outputDimensionality: this.dimensions,
        }));

        let lastError: unknown;

        for (let attempt = 1; attempt <= EmbeddingService.MAX_ATTEMPTS; attempt++) {
            try {
                const { data } = await firstValueFrom(
                    this.httpService.post<BatchEmbedResponse>(
                        `${EmbeddingService.BASE_URL}/models/${EmbeddingService.MODEL}:batchEmbedContents`,
                        { requests },
                        { params: { key: this.apiKey }, timeout: 60_000 },
                    ),
                );

                const vectors = data?.embeddings?.map(embedding => embedding?.values ?? []);

                if (!vectors || vectors.length !== texts.length) {
                    throw new BadRequestException('Embedding provider returned an unexpected number of vectors');
                }

                for (const vector of vectors) {
                    if (vector.length !== this.dimensions) {
                        throw new BadRequestException(
                            `Embedding dimension mismatch: expected ${this.dimensions}, received ${vector.length}`,
                        );
                    }
                }

                return vectors.map(vector => this.normalize(vector));
            } catch (error) {
                lastError = error;

                const status = (error as { response?: { status?: number } })?.response?.status;
                const retryable = status === undefined || status === 429 || status === 500 || status === 503;

                if (!retryable || attempt === EmbeddingService.MAX_ATTEMPTS) break;

                const delay = 2 ** attempt * 500;
                this.logger.warn(`Embedding request failed (attempt ${attempt}/${EmbeddingService.MAX_ATTEMPTS}), retrying in ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        const message = this.describeError(lastError);
        this.logger.error(`Embedding request failed: ${message}`);
        throw new BadRequestException(`Failed to generate embeddings: ${message}`);
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;

        try {
            return JSON.stringify(error);
        } catch {
            return 'unknown error';
        }
    }

    /** Truncated (Matryoshka) outputs are not unit-length, unlike the native 3072-dim output. */
    private normalize(vector: number[]): number[] {
        const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        return magnitude === 0 ? vector : vector.map(value => value / magnitude);
    }

    private get apiKey(): string {
        const apiKey = this.configService.get<string>('gemini.apiKey');

        if (!apiKey) {
            throw new BadRequestException('GEMINI_API_KEY is not configured');
        }

        return apiKey;
    }
}
