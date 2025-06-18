import { ChatMessage } from '@/database/schemas/chat.schema';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';

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
            const initialDecisionSchema = z.object({
                action: z.enum(['CHAT', 'READ', 'CREATE']),
                intent: z.string(),
                confidence: z.number().min(0).max(1),
                references: z.array(z.object({ uid: z.string(), name: z.string(), type: z.string() })).optional(),
            });

            const currentMessage = chatHistory.pop().message;
            const outputParser = StructuredOutputParser.fromZodSchema(initialDecisionSchema);
            const contextSummary = await this.generateSummary(chatHistory);

            const promptTemplate = new PromptTemplate({
                template: `You are StudyMind AI, an educational assistant. Analyze the user's message to determine the appropriate action.

                CONVERSATION CONTEXT: {contextSummary}
                CURRENT MESSAGE: {message}

                ACTION DEFINITIONS:
                - READ: User references existing content (@mention) for analysis, discussion, or questions about it
                - CREATE: User wants to generate NEW study materials, either standalone OR from existing content (@mention)
                - CHAT: General discussions, explanations, Q&A without content creation or analysis

                @MENTION FORMAT: @mention {uid: content uid, name: content name, type: content type}

                DECISION LOGIC:
                1. If @mention + creation keywords (create, make, generate, turn into, convert, build, add) → CREATE
                2. If @mention + analysis/discussion keywords (overview, explain, discuss, understand, help with) → READ  
                3. If creation keywords without @mention → CREATE
                4. Otherwise → CHAT

                EXAMPLES:
                - "Can you give me an overview of @mention {uid: uuidv4, name: History Chapter 3, type: 'NOTE'}" → READ
                - "Can you make a flashcard from @mention {uid: uuidv4, name: History Chapter 3, type: 'NOTE'}" → CREATE
                - "Create a new folder for Math" → CREATE
                - "What is photosynthesis?" → CHAT

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

    async generateContentCreation(chatHistory: ChatMessage[]) {
        try {
            const ContentCreationSchema = z.object({
                name: z.string(),
                type: z.enum(['FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE']),
                metadata: z
                    .object({
                        color: z.string().optional().describe('Color hex code of FOLDER. Only for FOLDER type. Otherwise undefined'),
                        icon: z
                            .enum([
                                'folder',
                                'book',
                                'physics',
                                'chemistry',
                                'math',
                                'history',
                                'artificialIntelligence',
                                'statistics',
                                'botany',
                                'factory',
                            ])
                            .optional()
                            .describe('Icon name for FOLDER. Only for FOLDER type. Otherwise undefined'),
                        description: z
                            .string()
                            .optional()
                            .describe('Description for all content type except FOLDER type. If FOLDER then undefined'),
                        content: z
                            .string()
                            .optional()
                            .describe(
                                'If content type is NOTE then should be an markdown string of the explanation. If content type is FLASHCARD then should be an array of flashcards [{question: string, answer: string}]. Otherwise undefined',
                            ),
                        fileType: z
                            .string()
                            .describe('If DOCUMENT then pdf. If AUDIO then mp3. If VIDEO then mp4. If IMAGE then png. Otherwise undefined'),
                        duration: z.number().describe('If AUDIO or VIDEO then duration in seconds. Otherwise undefined'),
                        resolution: z.string().describe('If IMAGE then width x height in pixels. Otherwise undefined'),
                    })
                    .optional(),
                prompt: z
                    .string()
                    .optional()
                    .describe(
                        'If content type is DOCUMENT then should be a markdown string. So that later i can convert it to pdf. If content type is AUDIO then should be a prompt for text to convert in speech. If content type is VIDEO then should be a prompt for video script. If content type is IMAGE then should be a prompt for image generation. Otherwise undefined',
                    ),
                parent: z
                    .string()
                    .optional()
                    .describe(
                        'If user wants to generate content under a specific parent and that parent is mentioned @mention. Give uid of that parent. Otherwise undefined',
                    ),
                confidence: z.number().min(0).max(1),
            });

            const currentMessage = chatHistory.pop().message;
            const outputParser = StructuredOutputParser.fromZodSchema(ContentCreationSchema);
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

                GUIDELINES:
                1. Use conversation context to inform content creation
                2. Reference previous topics and discussions when relevant
                3. Build upon concepts already covered
                4. Generate educational, contextually appropriate content
                5. Ensure content aligns with the learning progression
                6. Create meaningful names that reflect the context

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
            throw new HttpException('Failed to generate content', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateContentAnalysis(chatHistory: ChatMessage[]) {
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
                inputVariables: ['message', 'contextSummary'],
            });

            const response = await this.genAI.invoke([
                new HumanMessage(
                    await promptTemplate.format({
                        message: currentMessage,
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
