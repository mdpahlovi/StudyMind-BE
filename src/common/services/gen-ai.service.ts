import { ChatMessage } from '@/database/schemas/chat.schema';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';

const ActionDecisionSchema = z.object({
    action: z.enum(['CHAT', 'READ', 'CREATE']),
    intent: z.string(),
    confidence: z.number().min(0).max(1),
    references: z
        .array(
            z.object({
                uid: z.string(),
                name: z.string(),
                type: z.enum(['FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE']),
            }),
        )
        .optional(),
});

const ContentGenerationSchema = z.object({
    name: z.string(),
    type: z.enum(['FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE']),
    content: z.string(),
    metadata: z
        .object({
            tags: z.array(z.string()).optional(),
            difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
            subject: z.string().optional(),
            estimatedReadTime: z.number().optional(),
            contextual: z.boolean().optional(), // Flag to indicate if content is based on chat context
        })
        .optional(),
});

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

    async generateResponse(message: string) {
        try {
            const response = await this.genAI.invoke([new HumanMessage(message)]);
            return response.text;
        } catch (error) {
            throw new HttpException('Failed to generate response', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateContextualResponse(chatHistory: ChatMessage[] = []) {
        try {
            const prevMessages = chatHistory.map(message => {
                switch (message.role) {
                    case 'USER':
                        return new HumanMessage(message.message);
                    case 'ASSISTANT':
                        return new AIMessage(message.message);
                }
            });

            const systemPrompt = new SystemMessage(`You are StudyMind AI, an educational assistant. 
            Provide helpful, educational responses that:
            - Build upon previous conversation context
            - Maintain educational focus
            - Reference previous topics when relevant
            - Guide learning progression naturally
            - Offer to create study materials when appropriate`);

            const response = await this.genAI.invoke([systemPrompt, ...prevMessages]);

            return response.text;
        } catch (error) {
            throw new HttpException('Failed to generate contextual response', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateSession(message: string) {
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

    async generateSummary(chatHistory: ChatMessage[]) {
        if (chatHistory.length === 0) return '';

        const recentConversation = chatHistory
            .slice(-6)
            .map(msg => `${msg.role}: ${msg.message}`)
            .join('\n');

        try {
            const response = await this.genAI.invoke([
                new SystemMessage(`Summarize the key context from this conversation in a few sentences. Focus on: 
                - Main topics discussed
                - Any content created or referenced
                - Current learning goals or questions
                - Educational subject areas`),
                new HumanMessage(`Conversation:\n${recentConversation}`),
            ]);

            return response.text;
        } catch (error) {
            return new HttpException('Failed to summarize context', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateInitialDecision(chatHistory: ChatMessage[]) {
        try {
            const currentMessage = chatHistory.pop().message;
            const outputParser = StructuredOutputParser.fromZodSchema(ActionDecisionSchema);
            const contextSummary = await this.generateSummary(chatHistory);

            const promptTemplate = new PromptTemplate({
                template: `You are StudyMind AI, an educational assistant. Based on the user's message and the context of the conversation, determine the appropriate action to take.

                CONVERSATION CONTEXT: {contextSummary}

                DECISION CRITERIA:
                1. CHAT: General questions, explanations, discussions, follow-ups on previous topics
                2. READ: User mentions existing content (@mention) and wants to discuss on it
                3. CREATE: User wants to create/generate new study materials
              

                CONTENT CREATION INDICATORS:
                - Explicit: "create", "generate", "make", "build", "add", "new"
                - Contextual: "can you make that into...", "turn this into...", "based on what we discussed..."
                - Follow-up: References to previous conversation topics for content creation

                CURRENT MESSAGE: {message}

                Consider:
                - Conversation flow and context
                - References to previous topics
                - Implicit content creation requests
                - Educational progression and learning goals

                {format_instructions}`,
                inputVariables: ['message', 'contextSummary'],
                partialVariables: { format_instructions: outputParser.getFormatInstructions() },
            });

            const response = await this.genAI.invoke([
                new HumanMessage(
                    await promptTemplate.format({
                        message: currentMessage,
                        contextSummary,
                    }),
                ),
            ]);

            return await outputParser.parse(response.text);
        } catch (error) {
            throw new HttpException('Failed to generate initial decision', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateContentCreation(chatHistory: ChatMessage[] = [], parentId?: string, mentionedContent?: any[]) {
        try {
            const currentMessage = chatHistory.pop().message;
            const outputParser = StructuredOutputParser.fromZodSchema(ContentGenerationSchema);
            const contextSummary = await this.generateSummary(chatHistory);

            const promptTemplate = new PromptTemplate({
                template: `You are StudyMind AI, an educational assistant. Generate appropriate study content based on the user's request and our conversation context.

                CONVERSATION CONTEXT: {contextSummary}

                CONTENT TYPES:
                - FOLDER: Organizational structure for grouping content
                - NOTE: Short study notes, summaries, key points
                - DOCUMENT: Comprehensive study materials, detailed explanations
                - FLASHCARD: Question-answer pairs for memorization
                - AUDIO: Audio-based content descriptions (for TTS)
                - VIDEO: Video content descriptions/scripts
                - IMAGE: Image descriptions/prompts for generation

                CURRENT REQUEST: {message}
                PARENT CONTEXT: {parentId}
                SOURCE CONTENT: {mentionedContent}

                GUIDELINES:
                1. Use conversation context to inform content creation
                2. Reference previous topics and discussions when relevant
                3. Build upon concepts already covered
                4. Generate educational, contextually appropriate content
                5. Ensure content aligns with the learning progression
                6. Create meaningful names that reflect the context

                {format_instructions}`,
                inputVariables: ['message', 'parentId', 'mentionedContent', 'contextSummary'],
                partialVariables: { format_instructions: outputParser.getFormatInstructions() },
            });

            const response = await this.genAI.invoke([
                new HumanMessage(
                    await promptTemplate.format({
                        message: currentMessage,
                        parentId: parentId || 'root',
                        mentionedContent: JSON.stringify(mentionedContent || []),
                        contextSummary,
                    }),
                ),
            ]);

            return await outputParser.parse(response.text);
        } catch (error) {
            throw new HttpException('Failed to generate content', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateContentAnalysis(chatHistory: ChatMessage[] = [], mentionedContent: any[], contentData: string[]) {
        try {
            const currentMessage = chatHistory.pop().message;
            const contextSummary = await this.generateSummary(chatHistory);

            const promptTemplate = new PromptTemplate({
                template: `You are StudyMind AI, an educational assistant. Analyze the mentioned content and answer the user's question, considering our conversation context.

                CONVERSATION CONTEXT: {contextSummary}

                CURRENT QUERY: {message}
                MENTIONED CONTENT: {mentionedContent}
                CONTENT DATA: {contentData}

                INSTRUCTIONS:
                1. Reference the conversation context when relevant
                2. Connect current analysis to previous discussions
                3. Provide educational insights based on both content and context
                4. Answer questions comprehensively using all available information
                5. Suggest connections to previous topics covered
                6. Be specific and cite sources when relevant

                Provide a comprehensive, contextual educational response.`,
                inputVariables: ['message', 'mentionedContent', 'contentData', 'contextSummary'],
            });

            const response = await this.genAI.invoke([
                new HumanMessage(
                    await promptTemplate.format({
                        message: currentMessage,
                        mentionedContent: JSON.stringify(mentionedContent),
                        contentData: JSON.stringify(contentData),
                        contextSummary,
                    }),
                ),
            ]);

            return response.text;
        } catch (error) {
            throw new HttpException('Failed to analyze content', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
