import { HumanMessage } from '@langchain/core/messages';
import { PromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredOutputParser } from 'langchain/output_parsers';

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

    async generateTitle(message: string) {
        try {
            const outputParser = StructuredOutputParser.fromNamesAndDescriptions({
                title: 'A concise, specific title (3-8 words) that captures the main topic or request',
                description: "A brief description (10-25 words) summarizing the user's intent and context",
            });

            const promptTemplate = new PromptTemplate({
                template: `You are StudyMind AI, an educational assistant. Based on the user query, generate an appropriate title and description for this chat session.

                GUIDELINES:
                - Title: Be specific and educational-focused (e.g., "Calculus Derivatives Help" not "Math Question")
                - Description: Capture the user's learning intent and subject area
                - Focus on the educational topic, not the conversation itself
                - Use clear, academic language

                USER QUERY: {message}

                Generate a title and description that will help the user identify this conversation later in their chat history.

                {format_instructions}`,
                inputVariables: ['message'],
                partialVariables: { format_instructions: outputParser.getFormatInstructions() },
            });

            const response = await this.genAI.invoke([new HumanMessage(await promptTemplate.format({ message }))]);

            return await outputParser.parse(response.text);
        } catch (error) {
            throw new HttpException('Failed to generate title', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
