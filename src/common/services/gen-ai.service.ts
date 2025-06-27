import { DatabaseService } from '@/database/database.service';
import { LibraryItem, libraryItem, LibraryItemType } from '@/database/schemas';
import { MessageDto } from '@/modules/chat/chat.dto';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { DownloadService } from './download.service';

type MessageType = 'CONTEXTUAL_CHAT' | 'CREATE_CONTENT' | 'ANALYZE_CONTENT';

const FolderIcon: [string, ...string[]] = [
    'book',
    'folder',
    'document',
    'note',
    'flashcard',
    'audio',
    'video',
    'image',
    'science',
    'math',
    'history',
    'language',
    'art',
    'music',
    'sports',
    'computer',
];

const StudyMindState = Annotation.Root({
    session: Annotation<{ uid: string; title: string; description: string }>(),
    userMessage: Annotation<string>(),
    prevMessage: Annotation<Array<MessageDto>>(),
    prevSummary: Annotation<string>(),
    messageType: Annotation<MessageType>(),
    contentCreationQueue:
        Annotation<Array<{ name: string; type: LibraryItemType; parentId: number | null; metadata?: {}; prompt?: string }>>(),
    currentCreationIndex: Annotation<number>(),
    createdContent: Annotation<Array<LibraryItem>>(),
    sessionContext: Annotation<Array<{ id: number; uid: string; name: string; type: string; parentId: number | null; content: string }>>(),
    mentionContext: Annotation<Array<{ id: number; uid: string; name: string; type: string; parentId: number | null; content: string }>>(),
    response: Annotation<string>(),
    error: Annotation<string | null>(),
});

@Injectable()
export class GenAIService {
    private readonly logger = new Logger(GenAIService.name);
    private genAI: ChatGoogleGenerativeAI;
    private gptAi: ChatOpenAI;
    private graph;

    constructor(
        private readonly configService: ConfigService,
        private readonly databaseService: DatabaseService,
        private readonly downloadService: DownloadService,
    ) {
        this.initializeGenAI();
        this.buildGraph();
    }

    private initializeGenAI() {
        this.genAI = new ChatGoogleGenerativeAI({
            apiKey: this.configService.get<string>('gemini.apiKey'),
            model: 'gemini-2.0-flash',
            temperature: 0.7,
            maxOutputTokens: 2048,
        });
    }

    private buildGraph() {
        this.graph = new StateGraph(StudyMindState)
            // Added all the nodes
            .addNode('identifyUserIntent', this.identifyUserIntent.bind(this))
            .addNode('resolveMentions', this.resolveMentions.bind(this))
            .addNode('planContentQueue', this.planContentQueue.bind(this))
            .addNode('createOneContent', this.createOneContent.bind(this))
            .addNode('checkCreationProcess', this.checkCreationProcess.bind(this))
            .addNode('analyzeContent', this.analyzeContent.bind(this))
            .addNode('contextualChat', this.contextualChat.bind(this))
            .addNode('generateUserReply', this.generateUserReply.bind(this))

            // Added all the edges
            .addEdge(START, 'identifyUserIntent')
            .addConditionalEdges('identifyUserIntent', this.routeAfterRefs.bind(this), {
                CONTEXTUAL_CHAT: 'contextualChat',
                CREATE_CONTENT: 'resolveMentions',
                ANALYZE_CONTENT: 'resolveMentions',
            })
            .addConditionalEdges('resolveMentions', this.routeAfterContext.bind(this), {
                CREATE_CONTENT: 'planContentQueue',
                ANALYZE_CONTENT: 'analyzeContent',
            })
            .addEdge('planContentQueue', 'createOneContent')
            .addEdge('createOneContent', 'checkCreationProcess')
            .addConditionalEdges('checkCreationProcess', this.routeContentProgress.bind(this), {
                CONTINUE: 'createOneContent',
                COMPLETE: 'generateUserReply',
            })
            .addEdge('contextualChat', 'generateUserReply')
            .addEdge('analyzeContent', 'generateUserReply')
            .addEdge('generateUserReply', END)
            .compile();
    }

    private async identifyUserIntent(state: typeof StudyMindState.State) {
        try {
            const IntentSchema = z.object({
                title: z.string(),
                description: z.string(),
                messageType: z.enum(['CONTEXTUAL_CHAT', 'CREATE_CONTENT', 'ANALYZE_CONTENT']),
            });
            const structureModel = this.genAI.withStructuredOutput(IntentSchema);
            const promptTemplate = ChatPromptTemplate.fromTemplate(
                `You are StudyMind AI, an educational assistant. Classify user's intent into one of three types:
                
                Intent Type:
                1. ANALYZE_CONTENT: When user references existing content @mention {{...}} with analysis/discussion keywords 
                (overview, explain, discuss, understand, help with)
                2. CREATE_CONTENT: When user wants to create new content (with/without @mention) using creation keywords 
                (create, make, generate, turn into, convert, build, add)
                3. CONTEXTUAL_CHAT: General discussions/Q&A without content mentions
                
                Decision Steps:
                a) If @mention + creation keywords → CREATE_CONTENT
                b) If @mention + analysis keywords → ANALYZE_CONTENT
                c) If creation keywords without @mention → CREATE_CONTENT
                d) Otherwise → CONTEXTUAL_CHAT

                Title: Be specific and educational-focused (e.g., "Calculus Derivative and Integral").
                Description: Capture the user's learning goal, intent and subject area.
                
                Previous Chat Summary: {prevSummary}
                User Message: {userMessage}`,
            );

            const response = await structureModel.invoke(
                await promptTemplate.formatMessages({
                    prevSummary: state.prevSummary || '',
                    userMessage: state.userMessage,
                }),
            );

            this.logger.debug('Identify User Intent:', response);
            return {
                ...state,
                session: {
                    ...state.session,
                    title: response.title || 'Unknown Chat',
                    description: response.description || '',
                },
                messageType: response.messageType || 'CONTEXTUAL_CHAT',
            };
        } catch (error) {
            this.logger.error('Identify User Intent: ', error);
            throw new BadRequestException('Failed to identify user intent');
        }
    }
    private async resolveMentions(state: typeof StudyMindState.State) {
        const ResolveMentionSchema = z.object({
            mentions: z.array(z.object({ uid: z.string(), needContent: z.boolean(), whatNeed: z.string() })),
            sessions: z.array(z.object({ uid: z.string(), needContent: z.boolean(), whatNeed: z.string() })),
        });

        const structureModel = this.genAI.withStructuredOutput(ResolveMentionSchema);
        const promptTemplate = ChatPromptTemplate.fromTemplate(
            `You are StudyMind AI, an educational assistant. User wants to {intent} content. Extract required @mention {{...}} from user's message and @created {{...}} from the previous chat summary.
        
            Previous Chat Summary: {prevSummary}
            User Message: {userMessage}
            
            IMPORTANT RULES:
            1. If multiple similar @mention or @created items exist and their purposes are similar, take only the LAST/MOST RECENT one
            2. For each item, determine if you need the actual content or just for reference
            3. Specify exactly what is needed from the content
            
            Context Examples:
            1) Previous Chat Summary: "I created a folder 'Mathematics' @created {{uid: '...', name: 'Mathematics', type: 'FOLDER'}}"
            User Message: "Create a document about calculus derivatives"
            → sessions: [{{uid: '...', needContent: false, whatNeed: 'to use as parent folder'}}]
            
            2) User Message: "@mention {{uid: '...', name: 'Calculus Chapter 3', type: 'DOCUMENT'}} create flashcards from this"
            → mentions: [{{uid: '...', needContent: true, whatNeed: 'extract key concepts and definitions for flashcard creation'}}]
            
            3) User Message: "@mention {{uid: '...', name: 'Physics Notes', type: 'DOCUMENT'}} explain the second paragraph"
            → mentions: [{{uid: '...', needContent: true, whatNeed: 'find and explain the second paragraph content'}}]
            
            4) Previous Chat Summary: "Created folder @created {{uid: '...', name: 'Math', type: 'FOLDER'}} then created another folder @created {{uid: '...', name: 'Advanced Math', type: 'FOLDER'}}"
            User Message: "Create a document about calculus"
            → sessions: [{{uid: '...', needContent: false, whatNeed: 'to use as parent folder'}}] // Only the LAST folder
            
            5) User Message: "@mention {{uid: '...', name: 'Biology Chapter 1', type: 'DOCUMENT'}} @mention {{uid: '...', name: 'Biology Chapter 2', type: 'DOCUMENT'}} create summary"
            → mentions: [{{uid: '...', needContent: true, whatNeed: 'extract main concepts for summary creation'}}, {{uid: '...', needContent: true, whatNeed: 'extract main concepts for summary creation'}}] // Both for create summary
            
            6) Previous Chat Summary: "Created flashcards @created {{uid: '...', name: 'Algebra Basics', type: 'FLASHCARD'}}"
            User Message: "Make similar flashcards for geometry"
            → sessions: [{{uid: '...', needContent: true, whatNeed: 'use as template structure and format reference'}}]
            
            needContent Guidelines:
            - true: When you need to READ/ANALYZE the actual content (text, data, structure)
            - false: When you only need it as a reference for parent/sibling
            
            whatNeed Examples:
            - needContent: true → "extract key formulas and concepts", "find specific paragraph about...", "analyze writing style and tone", "get content structure and topics"
            - needContent: false → "to use as parent folder", "to use as sibling location"
            
            Please be intelligent think twice before responding.
        `,
        );

        const response = await structureModel.invoke(
            await promptTemplate.formatMessages({
                prevSummary: state.prevSummary,
                userMessage: state.userMessage,
                intent: state.messageType.split('_')[0].toLowerCase(),
            }),
        );

        if (!response?.mentions?.length && !response?.sessions?.length) return state;

        const db = this.databaseService.database;

        const itemsUid = [...response.mentions, ...response.sessions].map(item => item.uid);
        const itemData = await db.select().from(libraryItem).where(inArray(libraryItem.uid, itemsUid));

        state.mentionContext = await this.putInState(response.mentions, itemData as any);
        state.sessionContext = await this.putInState(response.sessions, itemData as any);

        return state;
    }
    private async planContentQueue(state: typeof StudyMindState.State) {
        try {
            const ContentPlanSchema = z.object({
                contentQueue: z.array(
                    z.object({
                        name: z.string(),
                        type: z.enum(['FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE']),
                        parentId: z.number().nullable(),
                        metadata: z
                            .object({
                                description: z.string().optional(),
                                color: z.string().optional(),
                                icon: z.enum(FolderIcon).optional(),
                                notes: z.string().optional(),
                                cards: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
                                cardCount: z.number().optional(),
                                fileType: z.string().optional(),
                                duration: z.number().optional(),
                                resolution: z.string().optional(),
                            })
                            .optional(),
                        prompt: z.string().optional(),
                    }),
                ),
            });

            const structureModel = this.genAI.withStructuredOutput(ContentPlanSchema);
            const promptTemplate = ChatPromptTemplate.fromTemplate(`
                You are StudyMind AI, an educational assistant. Your task is to generate appropriate study content based on the user's request, adhering strictly to the provided schema and rules.

                Previous Chat Summary: {prevSummary}
                User Message: {userMessage}

                REFERENCED CONTENT:
                Based on previous created content @created {{...}} and users mentioned content @mention {{...}}, the system provides required content data in references array:
                {references}

                NAME RULES:
                - Use an educational and professional name for the content.
                - Names should be concise and descriptive.

                TYPE RULES:
                - Use the most appropriate type for the content (from the allowed enum, e.g., 'NOTE'), based on the user's request.

                PARENT ID RULES:
                1. If the user explicitly requests creation *inside* a specific folder (e.g., "create a note in @mention {{...}}"), use that folder's ID as parentId.
                2. If the user mentions existing content (e.g., "summarize @mention {{...}}"), use the parentId of the mentioned content.
                3. If no explicit folder mention or a general request (e.g., "create a new flashcard set"), set parentId to null.

                CONTENT TYPE SPECIFIC RULES:
                - FOLDER: Requires metadata.color (hex code, e.g., "#A8C686") and metadata.icon (from allowed enum, e.g., "book").
                - NOTE: Include a brief metadata.description. The markdown content should be in metadata.notes, structured with sections and sub-sections and formatted with headers, lists, tables. (max 1000 words).
                - FLASHCARD: Include a brief metadata.description. The flashcards should be a JSON array of {{"question":"", "answer":""}} objects in metadata.cards. Number of cards should be in metadata.cardCount. (max 10 cards).
                - DOCUMENT: Include a brief metadata.description. Set metadata.fileType to "pdf".
                - AUDIO: Include a brief metadata.description. Set metadata.fileType to "mp3". Estimate metadata.duration in seconds.
                - VIDEO: Include a brief metadata.description. Set metadata.fileType to "mp4". Estimate metadata.duration in seconds.
                - IMAGE: Include a brief metadata.description. Set metadata.fileType to "png". Provide metadata.resolution in "widthxheight" format (e.g., "1920x1080").

                PROMPT GENERATION RULES (Only for type: DOCUMENT, AUDIO, VIDEO, IMAGE):
                - DOCUMENT: Set 'prompt' to a well-structured markdown document with headers, lists, and tables (max 200 words).
                - AUDIO: Set 'prompt' to a short and natural-sounding script for speech synthesis (max 100 words).
                - VIDEO: Set 'prompt' to a clear and engaging video script for visual narration (max 100 words).
                - IMAGE: Set 'prompt' to a concise and specific image description (max 20 words).

                Do not include the 'prompt' field for other types.
                Generate content based on the user's request following these rules exactly.`);

            const response = await structureModel.invoke(
                await promptTemplate.formatMessages({
                    prevSummary: state.prevSummary,
                    userMessage: state.userMessage,
                    references: [...state.mentionContext, ...state.sessionContext],
                }),
            );

            if (!response.contentQueue || response.contentQueue.length === 0) {
                throw new BadRequestException('Failed to plan content creation');
            }

            return {
                ...state,
                contentCreationQueue: response.contentQueue,
                currentCreationIndex: 0,
            };
        } catch (error) {
            this.logger.error('Plan Content Queue Error:', error);
            throw new BadRequestException('Failed to plan content creation');
        }
    }
    private async createOneContent(state: typeof StudyMindState.State) {
        try {
            const { contentCreationQueue, currentCreationIndex, createdContent } = state;
            const currentContent = contentCreationQueue[currentCreationIndex] as any;

            if (!currentContent?.name || !currentContent?.type) {
                throw new BadRequestException('Please provide more specific instructions. What do you want to create?');
            }
            if (['DOCUMENT', 'AUDIO', 'VIDEO', 'IMAGE'].includes(currentContent?.type) && !currentContent?.prompt) {
                throw new BadRequestException('Please provide more specific instructions. What do you want to create?');
            }

            let metadata = {};
            if (currentContent?.type === 'DOCUMENT') {
                metadata = await this.downloadService.downloadPdf(currentContent.prompt, currentContent.name);
            } else if (currentContent?.type === 'AUDIO') {
                metadata = await this.downloadService.downloadFile(
                    `https://text.pollinations.ai/${currentContent.prompt}?model=openai-audio&voice=nova`,
                    currentContent.name,
                    currentContent?.metadata?.fileType || 'mp3',
                );
            } else if (currentContent?.type === 'VIDEO') {
                throw new BadRequestException('Currently not supported');
            } else if (currentContent?.type === 'IMAGE') {
                const resolution = currentContent?.metadata?.resolution?.split('x');
                const width = resolution?.length === 2 ? resolution[0] : '1024';
                const height = resolution?.length === 2 ? resolution[1] : '1024';
                metadata = await this.downloadService.downloadFile(
                    `https://image.pollinations.ai/prompt/${currentContent.prompt}?width=${width}&height=${height}`,
                    currentContent.name,
                    currentContent?.metadata?.fileType || 'png',
                );
            }

            const db = this.databaseService.database;

            const createdItem = await db
                .insert(libraryItem)
                .values({
                    isEmbedded: ['DOCUMENT', 'AUDIO', 'VIDEO', 'IMAGE'].includes(currentContent.type) ? false : true,
                    name: currentContent.name,
                    type: currentContent.type,
                    parentId: currentContent.parentId === -1 ? createdContent[createdContent.length - 1].id : currentContent.parentId,
                    userId: 1,
                    metadata: { ...(currentContent?.metadata || {}), ...metadata },
                })
                .returning();

            if (!createdItem[0] || !createdItem[0].uid) {
                throw new BadRequestException('Failed to create content');
            }

            return {
                ...state,
                currentCreationIndex: state.currentCreationIndex + 1,
                createdContent: [...state.createdContent, ...(createdItem as LibraryItem[])],
            };
        } catch (error) {
            this.logger.error('Create One Content Error:', error);
            throw new BadRequestException('Failed to create content');
        }
    }
    private checkCreationProcess(state: typeof StudyMindState.State) {
        return state;
    }
    private async analyzeContent(state: typeof StudyMindState.State) {
        try {
            const contextReferences = state.mentionContext
                .map(item => `Content: ${item.name} (${item.type})\n${item.content}`)
                .join('\n\n');

            const systemPrompt = new SystemMessage(`
                You are StudyMind AI, an educational assistant. Analyze the provided content and respond to the user's question or request.
                
                Guidelines:
                - Provide detailed, educational explanations
                - Break down complex concepts into understandable parts
                - Use examples and analogies when helpful
                - Reference specific parts of the content when relevant
                - Maintain an encouraging, supportive tone
                - If the user asks about specific sections/pages, focus on those areas
                
                Referenced Content:
                ${contextReferences}
            `);

            const response = await this.genAI.invoke([systemPrompt, new HumanMessage(state.userMessage)]);

            if (!response.text) {
                throw new BadRequestException('Failed to analyze content');
            }

            this.logger.debug('Content Analysis Response:', response.text);
            return { ...state, response: response.text };
        } catch (error) {
            this.logger.error('Analyze Content Error:', error);
            throw new BadRequestException('Failed to analyze content');
        }
    }
    private async contextualChat(state: typeof StudyMindState.State) {
        const prevMessages = state.prevMessage.map(message => {
            switch (message.role) {
                case 'USER':
                    return new HumanMessage(message.message);
                case 'ASSISTANT':
                    return new AIMessage(message.message);
            }
        });

        const systemPrompt = new SystemMessage(`
            You are StudyMind AI, an educational assistant. Provide helpful, educational responses that:
            - Build upon previous conversation context
            - Maintain educational focus
            - Reference previous topics when relevant
            - Guide learning progression naturally
            - Offer to create study materials when appropriate`);

        const response = await this.genAI.invoke([systemPrompt, ...prevMessages, new HumanMessage(state.userMessage)]);

        if (!response.text) {
            throw new BadRequestException('Failed to generate user reply');
        }

        this.logger.debug('Contextual Response:', response.text);
        return { ...state, response: response.text };
    }
    private async generateUserReply(state: typeof StudyMindState.State) {
        try {
            if (state.messageType === 'CONTEXTUAL_CHAT') {
                return state;
            } else if (state.messageType === 'CREATE_CONTENT') {
                const createdContentSummary = state.createdContent
                    .map(content => `@created {uid: '${content.uid}', name: '${content.name}', type: '${content.type}'}`)
                    .join(' ');

                const successPrompt = `
                    You are StudyMind AI. The user requested content creation and you successfully created the following items:
                    ${state.createdContent}
                    
                    Generate a friendly, encouraging success message that:
                    - Confirms what was created
                    - Briefly describes each item's purpose
                    - Suggests next steps or ways to use the content
                    - Maintains an educational, supportive tone
                    
                    User's original request: ${state.userMessage}
                    Response should contain created content in the following format: @created ${JSON.stringify(state.createdContent[0])}
                `;

                const response = await this.genAI.invoke([new SystemMessage(successPrompt)]);

                if (!response.text) {
                    throw new BadRequestException('Failed to generate success message');
                }

                this.logger.debug('Content Creation Success Response:', response.text);
                return { ...state, response: `${response.text}\n\n${createdContentSummary}` };
            } else if (state.messageType === 'ANALYZE_CONTENT') {
                return state;
            }
        } catch (error) {
            this.logger.error('Generate Reply Error:', error);
            throw new BadRequestException('Failed to generate user reply');
        }
    }
    private routeAfterRefs(state: typeof StudyMindState.State) {
        return state.messageType;
    }
    private routeAfterContext(state: typeof StudyMindState.State) {
        return state.messageType;
    }
    private routeContentProgress(state: typeof StudyMindState.State) {
        const { contentCreationQueue, currentCreationIndex } = state;
        return currentCreationIndex < contentCreationQueue.length ? 'CONTINUE' : 'COMPLETE';
    }

    // 🎯 Main entrypoint
    async generateGraphResponses(sessionUid: string, chatMessages: MessageDto[]): Promise<typeof StudyMindState.State> {
        try {
            const initialState: typeof StudyMindState.State = {
                session: { uid: sessionUid, title: '', description: '' },
                userMessage: chatMessages[chatMessages.length - 1].message,
                prevMessage: chatMessages.slice(0, -1),
                prevSummary: await this.generateSummary(chatMessages.slice(0, -1)),
                messageType: 'CONTEXTUAL_CHAT',
                contentCreationQueue: [],
                currentCreationIndex: 0,
                createdContent: [],
                sessionContext: [],
                mentionContext: [],
                response: null,
                error: null,
            };

            const result = await this.graph.invoke(initialState);

            this.logger.debug('Graph Execution: ', result);
            return result;
        } catch (error) {
            this.logger.error('Graph Execution:', error);
            throw new BadRequestException('Failed to generate response');
        }
    }

    async generateResponse(message: string, systemPrompt?: string) {
        try {
            const response = await this.genAI.invoke([
                ...(systemPrompt ? [new SystemMessage(systemPrompt)] : []),
                new HumanMessage(message),
            ]);
            return response.text;
        } catch (error) {
            throw new BadRequestException('Failed to generate response');
        }
    }

    async generateSummary(chatHistory: MessageDto[]) {
        if (chatHistory.length === 0) return '';

        const recentConversation = chatHistory
            .slice(-10) // Increased to capture more context for @created tracking
            .map(msg => `${msg.role}: ${msg.message}`)
            .join('\n');

        const response = await this.genAI.invoke([
            new SystemMessage(`Summarize the key context from this conversation in a few sentences. Focus on:
            - Main topics discussed
            - Any content created or referenced in the conversation
            - Current learning goals or questions
            - Educational subject areas
            
            IMPORTANT: When content was created in this conversation, include @created {{...}} tags. Must retrieve @created {{...}} tags from the previous chat summary. Because @created {{...}} tags are important to track content creation across conversation sessions.`),
            new HumanMessage(`Conversation:\n${recentConversation}`),
        ]);

        this.logger.debug('Summary: ', response.text);
        return response.text;
    }

    private async putInState(reference: any[], itemData: LibraryItem[]) {
        const result = [];
        for (const item of reference) {
            const itemD = itemData.find(d => d.uid === item.uid);

            let content = '';
            if (item?.needContent) {
                switch (itemD?.type) {
                    case 'NOTE':
                        content = await this.generateResponse(itemD?.metadata['notes'], item?.whatNeed);
                        break;
                    case 'DOCUMENT':
                        content = '';
                        break;
                    case 'FLASHCARD':
                        content = await this.generateResponse(itemD?.metadata['cards'], item?.whatNeed);
                        break;
                    case 'AUDIO':
                        content = '';
                        break;
                    case 'VIDEO':
                        content = '';
                        break;
                    case 'IMAGE':
                        content = '';
                        break;
                }
            }

            result.push({ id: itemD.id, uid: itemD.uid, name: itemD.name, type: itemD.type, parentId: itemD.parentId, content });
        }

        return result;
    }
}
