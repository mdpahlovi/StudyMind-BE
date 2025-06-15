import { HumanMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GenAIService {
    private genAI: ChatGoogleGenerativeAI;

    constructor(private readonly configService: ConfigService) {
        this.initializeGenAI();
    }

    private initializeGenAI() {
        this.genAI = new ChatGoogleGenerativeAI({
            apiKey: this.configService.get<string>('gemini.apiKey'),
            model: 'gemini-2.0-flash',
            temperature: 0.7,
            maxOutputTokens: 2048,
        });
    }

    async generateText(prompt: string): Promise<string> {
        try {
            const response = await this.genAI.invoke([new HumanMessage(prompt)]);

            return response.content as string;
        } catch (error) {
            throw new HttpException('An error occurred while generating text', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
