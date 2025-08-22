import { DownloadService } from '@/common/services/download.service';
import { VectorService } from '@/common/services/vector.service';
import * as schema from '@/database/schemas';
import {
    FlashcardMetadata,
    ImageMetadata,
    libraryItem,
    LibraryItem,
    LibraryItemMetadata,
    LibraryItemType,
    NoteMetadata,
} from '@/database/schemas/library.schema';
import { MessageDto } from '@/modules/chat/chat.dto';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, ExtractTablesWithRelations, inArray } from 'drizzle-orm';
import { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import * as z from 'zod/v4';

type Transaction = PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;
type MessageType = 'CHAT' | 'CREATE' | 'UPDATE' | 'DELETE' | 'READ';
type ReferenceCt = { id: number; uid: string; name: string; type: string; parentId: number | null; purpose: string; content: string };

const StudyMindState = Annotation.Root({
    userId: Annotation<number>(),
    session: Annotation<{ uid: string; title: string; summary: string }>(),
    userMessage: Annotation<string>(),
    prevMessage: Annotation<Array<MessageDto>>(),
    prevSummary: Annotation<string>(),
    messageType: Annotation<MessageType>(),
    contentCreationQueue: Annotation<
        Array<{
            name: string;
            type: LibraryItemType;
            parentId: number | null;
            metadata: LibraryItemMetadata;
            content?: string;
        }>
    >(),
    currentCreationIndex: Annotation<number>(),
    createdContent: Annotation<Array<LibraryItem>>(),
    sessionContext: Annotation<Array<ReferenceCt>>(),
    mentionContext: Annotation<Array<ReferenceCt>>(),
    response: Annotation<string>(),
    error: Annotation<string | null>(),
});

@Injectable()
export class GenAIService {
    private readonly logger = new Logger(GenAIService.name);
    private genAI: ChatGoogleGenerativeAI;
    private dbTxn: Transaction;

    constructor(
        private readonly configService: ConfigService,
        private readonly downloadService: DownloadService,
        private readonly vectorService: VectorService,
    ) {
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

    private buildGraph() {
        return (
            new StateGraph(StudyMindState)
                // Use arrow functions instead of bind
                .addNode('identifyUserIntent', state => this.identifyUserIntent(state))
                .addNode('resolveMentions', state => this.resolveMentions(state))
                .addNode('planContentQueue', state => this.planContentQueue(state))
                .addNode('createContentQueue', state => this.createContentQueue(state))
                .addNode('createOneContent', state => this.createOneContent(state))
                .addNode('checkCreationProcess', state => this.checkCreationProcess(state))
                .addNode('analyzeContent', state => this.analyzeContent(state))
                .addNode('contextualChat', state => this.contextualChat(state))
                .addNode('generateUserReply', state => this.generateUserReply(state))
                .addNode('updateChatSession', state => this.updateChatSession(state))

                // Same for conditional edges
                .addEdge(START, 'identifyUserIntent')
                .addConditionalEdges('identifyUserIntent', state => this.routeAfterRefs(state), {
                    CHAT: 'contextualChat',
                    CREATE: 'resolveMentions',
                    UPDATE: 'generateUserReply',
                    DELETE: 'generateUserReply',
                    READ: 'resolveMentions',
                })
                .addConditionalEdges('resolveMentions', state => this.routeAfterContext(state), {
                    CREATE: 'planContentQueue',
                    READ: 'analyzeContent',
                })
                .addEdge('planContentQueue', 'createContentQueue')
                .addEdge('createContentQueue', 'createOneContent')
                .addEdge('createOneContent', 'checkCreationProcess')
                .addConditionalEdges('checkCreationProcess', state => this.routeContentProgress(state), {
                    CONTINUE: 'createOneContent',
                    COMPLETE: 'generateUserReply',
                })
                .addEdge('contextualChat', 'generateUserReply')
                .addEdge('analyzeContent', 'generateUserReply')
                .addEdge('generateUserReply', 'updateChatSession')
                .addEdge('updateChatSession', END)
                .compile()
        );
    }

    private async identifyUserIntent(state: typeof StudyMindState.State) {
        try {
            const IntentMessageTypes = ['CREATE', 'UPDATE', 'DELETE', 'READ', 'CHAT'];
            const IntentSchema = z.object({ messageType: z.enum(IntentMessageTypes) });
            const structureModel = this.genAI.withStructuredOutput(IntentSchema);
            const promptTemplate = ChatPromptTemplate.fromTemplate(
                `You are StudyMind AI's intent classifier. Classify user's intent and respond accordingly.
                
                Message Type:
                1. READ: When user @mention existing content or references content from previous conversation and wants to read/analyze/understand/learn/discuss it
                2. CREATE: When user wants to create new content using creation keywords (create, make, generate, turn into, convert, build, add)
                3. UPDATE: When user wants to modify existing content using update keywords (edit, modify, change, update, revise, improve)  
                4. DELETE: When user wants to delete existing content using delete keywords (delete, remove, trash, eliminate)
                5. CHAT (Default): General questions without specific content management intent
                
                Previous Chat Summary: {prevSummary}
                User Message: {userMessage}`,
            );

            const response = await structureModel.invoke(
                await promptTemplate.formatMessages({
                    prevSummary: state.prevSummary || 'No previous summary',
                    userMessage: state.userMessage,
                }),
            );

            if (IntentMessageTypes.includes(response.messageType) === false) {
                throw new BadRequestException('Failed to identify user intent');
            }

            console.log(`[Node] Identify User Intent: [${response.messageType}]`);
            return {
                ...state,
                messageType: response.messageType,
            };
        } catch (error) {
            this.logger.error('Identify User Intent: ', error);
            throw new BadRequestException('Failed to identify user intent');
        }
    }
    private async resolveMentions(state: typeof StudyMindState.State) {
        try {
            const mentionRegex = /@mention\s*{([^}]+)}/g;
            const createdRegex = /@created\s*{([^}]+)}/g;

            const mentionMatches = [...state.userMessage.matchAll(mentionRegex)];
            const createdMatches = state.prevMessage.map(msg => [...msg.message.matchAll(createdRegex)]).flat();

            if (!mentionMatches.length && !createdMatches.length) {
                console.log('[Node] Resolve Mentions: [No Mentions Found]');
                return state;
            }

            const ResolveMentionSchema = z.object({
                mentionContent: z.array(z.object({ uid: z.string(), needContent: z.boolean(), purpose: z.string() })),
                createdContent: z.array(z.object({ uid: z.string(), needContent: z.boolean(), purpose: z.string() })),
            });

            const structureModel = this.genAI.withStructuredOutput(ResolveMentionSchema);
            const promptTemplate = ChatPromptTemplate.fromTemplate(
                `You are StudyMind AI's content resolver. Extract content references needed for the {messageType} operation.

                EXTRACTION RULES:
                1. Extract @mention {{...}} from user message or previous summary, set to mentionContent array
                2. Extract @created {{...}} from previous summary, set to createdContent array  
                3. Only include content that's actually needed for the {messageType} operation
                4. If multiple similar content exist, they are reference same purpose then prefer the most recent/relevant one

                CONTENT NEED CLASSIFICATION:
                needContent: true  when Need to read/analyze the actual content
                needContent: false when Only need as reference (parent folder, sibling content, etc)

                PURPOSE EXAMPLES:
                - "extract key concepts for flashcard creation"
                - "use as parent folder for organization" 
                - "analyze content structure and format"
                - "find specific information about [topic]"

                OPERATION CONTEXT:
                - CREATE: May need content for templates/source material + parent folders/sibling content
                - READ: Always need full content for analysis

                INPUT:
                Previous Chat Summary: {prevSummary}
                User Message: {userMessage}
                Operation Type: {messageType}

                Extract only the content references that are actually required for this {messageType} operation.`,
            );

            const response = await structureModel.invoke(
                await promptTemplate.formatMessages({
                    prevSummary: state.prevSummary || 'No previous summary',
                    userMessage: state.userMessage,
                    messageType: state.messageType,
                }),
            );

            if (response?.mentionContent?.length === 0 && response?.createdContent?.length === 0) {
                console.log('[Node] Resolve Mention: [No Valid References Found]');
                return state;
            }

            const itemsUid = [...response.mentionContent, ...response.createdContent].map(item => item.uid);
            const itemData = await this.dbTxn
                .select()
                .from(libraryItem)
                .where(and(inArray(libraryItem.uid, itemsUid), eq(libraryItem.isActive, true)));

            state.mentionContext = await this.putInState(state, response.mentionContent, itemData);
            state.sessionContext = await this.putInState(state, response.createdContent, itemData);

            console.log(`[Node] Resolve Mention: [${response.mentionContent.length} Mention, ${response.createdContent.length} Created]`);
            return state;
        } catch (error) {
            this.logger.error('Resolve Mention:', error);
            throw new BadRequestException('Failed to resolve mentions');
        }
    }
    private async planContentQueue(state: typeof StudyMindState.State) {
        try {
            const PlanContentSchema = z.object({
                contentQueue: z.array(z.object({ name: z.string(), type: z.string(), parentId: z.number() })),
            });

            const structureModel = this.genAI.withStructuredOutput(PlanContentSchema);
            const promptTemplate = ChatPromptTemplate.fromTemplate(`
            You are StudyMind AI. Analyze the user's request and plan ONLY the structure of content to create.

            Previous Chat Summary: {prevSummary}
            User Message: {userMessage}

            REFERENCED CONTENT:
            Based on previous created content @created {{...}} and users mentioned content @mention {{...}}, the system provides required parentId in references array:
            {references}

            RULES:
            1. Generate ONLY what the user explicitly requested
            2. If user says "create a document", generate exactly 1 document
            3. If user says "create flashcards", generate exactly 1 flashcard set
            4. Only create multiple items if user explicitly asks for multiple things

            NAMING RULES:
            - Use educational, professional names
            - Be concise and descriptive
            - Example: "Calculus Derivatives Guide", "Biology Cell Structure Notes"

            TYPE RULES:
            - Use the type that best matches the user's request
            - Use between 'FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE'

            PARENT ID RULES:
            1. If user wants content inside an existing folder from references, set parentId to that folder's id
            2. If content is related to referenced content, set parentId to that content's parentId
            3. If creating nested structure where parent doesn't exist yet, set parent to 0, child to -1
            4. Otherwise, set to 0

            Focus ONLY on structure. Do NOT worry about content details yet. Please be intelligent think twice before responding.
        `);

            const response = await structureModel.invoke(
                await promptTemplate.formatMessages({
                    prevSummary: state.prevSummary || 'No previous summary',
                    userMessage: state.userMessage,
                    references: [...state.mentionContext, ...state.sessionContext].map(item => ({
                        id: item.id,
                        uid: item.uid,
                        name: item.name,
                        type: item.type,
                        parentId: item.parentId == null ? 0 : item.parentId,
                        purpose: item.purpose,
                    })),
                }),
            );

            if (!response.contentQueue.length) {
                throw new BadRequestException('Failed to plan content structure');
            }

            console.log(`[Node] Plan Content Structure: [${response.contentQueue.length} content planned]`);
            return {
                ...state,
                contentCreationQueue: response.contentQueue,
                currentCreationIndex: 0,
            };
        } catch (error) {
            this.logger.error('Plan Content Structure:  ', error);
            throw new BadRequestException('Failed to plan content structure');
        }
    }
    private async createContentQueue(state: typeof StudyMindState.State) {
        try {
            const contentQueue = [];

            const contentTypeConfigs = {
                FOLDER: {
                    schema: z.object({
                        color: z.string(),
                        icon: z.string(),
                    }),
                    prompt: `
                    Generate folder metadata:
                    • Choose appropriate color (hex code) for the subject matter
                    • Select icon from: 'folder', 'book', 'physics', 'chemistry', 'math', 'history', 'artificialIntelligence', 'statistics', 'botany', 'factory'`,
                },
                NOTE: {
                    schema: z.object({
                        description: z.string(),
                        notes: z.string(),
                    }),
                    prompt: `
                    Create comprehensive study notes (max 1000 words):
                    • Write clear description of main topic
                    • Use proper markdown formatting with headers, lists, and emphasis
                    • Structure logically with key concepts and definitions`,
                },
                DOCUMENT: {
                    schema: z.object({
                        description: z.string(),
                        content: z.string(),
                    }),
                    prompt: `
                    Generate professional document (max 1000 words):
                    • Create description of document content coverage
                    • Use structured markdown with proper headings
                    • Include introduction, main content, and conclusion`,
                },
                FLASHCARD: {
                    schema: z.object({
                        description: z.string(),
                        cards: z.array(z.object({ question: z.string(), answer: z.string() })),
                        cardCount: z.number(),
                    }),
                    prompt: `
                    Create 5-10 effective flashcards:
                    • Generate description explaining the flashcard set
                    • Write clear questions testing understanding, not memorization
                    • Provide concise but complete answers`,
                },
                AUDIO: {
                    schema: z.object({
                        description: z.string(),
                        content: z.string(),
                    }),
                    prompt: `
                    Generate audio script (max 1000 words):
                    • Create description of audio content coverage
                    • Write natural, conversational script for text-to-speech
                    • Use clear language with smooth transitions`,
                },
                VIDEO: {
                    schema: z.object({
                        description: z.string(),
                        content: z.string(),
                    }),
                    prompt: `
                    Create video script (max 100 words):
                    • Write description with learning objectives
                    • Generate concise narration with visual cues [in brackets]
                    • Structure with intro, main points, conclusion`,
                },
                IMAGE: {
                    schema: z.object({
                        description: z.string(),
                        fileType: z.string(),
                        resolution: z.string(),
                        content: z.string(),
                    }),
                    prompt: `
                    Generate image specifications:
                    • Create clear description of educational purpose
                    • Set appropriate fileType (png) and resolution (e.g., "1024x768")
                    • Write concise generation prompt (max 20 words)`,
                },
            };

            for (const contentItem of state.contentCreationQueue) {
                const config = contentTypeConfigs[contentItem.type];

                const structureModel = this.genAI.withStructuredOutput(config.schema);
                const promptTemplate = ChatPromptTemplate.fromTemplate(`
                You are StudyMind AI. Generate content for a ${contentItem.type}.
                
                Previous Chat Summary: {prevSummary}
                User Message: {userMessage}
                Content Item: {contentItem}
                
                REFERENCED CONTENT:
                {references}
                
                Instructions: ${config.prompt}
                
                Generate appropriate metadata and content for this ${contentItem.type}.
            `);

                const response = await structureModel.invoke(
                    await promptTemplate.formatMessages({
                        prevSummary: state.prevSummary || 'No previous summary',
                        userMessage: state.userMessage,
                        contentItem: contentItem,
                        references: [...state.mentionContext, ...state.sessionContext].map(item => ({
                            uid: item.uid,
                            name: item.name,
                            type: item.type,
                            content: item.content,
                        })),
                    }),
                );

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const { content, ...metadata } = response;

                contentQueue.push({
                    ...contentItem,
                    parentId: contentItem.parentId !== 0 ? contentItem.parentId : null,
                    metadata: metadata || {},
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    ...(content ? { content } : {}),
                });
            }

            console.log(`[Node] Create Content Queue: [${contentQueue.length} items created]`);
            return {
                ...state,
                contentCreationQueue: contentQueue,
            };
        } catch (error) {
            this.logger.error('Create Content Queue: ', error);
            throw new BadRequestException('Failed to create content queue');
        }
    }
    private async createOneContent(state: typeof StudyMindState.State) {
        try {
            const { contentCreationQueue, currentCreationIndex, createdContent } = state;
            const currentContent = contentCreationQueue[currentCreationIndex];

            let metadata = {};
            if (currentContent?.type === 'DOCUMENT') {
                metadata = await this.downloadService.downloadTool(currentContent.content, currentContent.name, 'pdf');
            } else if (currentContent?.type === 'AUDIO') {
                metadata = await this.downloadService.downloadTool(currentContent.content, currentContent.name, 'mp3');
            } else if (currentContent?.type === 'VIDEO') {
                throw new BadRequestException('Currently not supported');
            } else if (currentContent?.type === 'IMAGE') {
                const resolution = (currentContent?.metadata as ImageMetadata)?.resolution?.split('x');
                const width = resolution?.length === 2 ? resolution[0] : '1024';
                const height = resolution?.length === 2 ? resolution[1] : '1024';
                metadata = await this.downloadService.downloadFile(
                    `https://image.pollinations.ai/prompt/${currentContent.content}?width=${width}&height=${height}`,
                    currentContent.name,
                    'png',
                );
            }

            const createdItem = await this.dbTxn
                .insert(libraryItem)
                .values({
                    isEmbedded: ['DOCUMENT', 'AUDIO', 'VIDEO', 'IMAGE'].includes(currentContent.type) ? false : true,
                    name: currentContent.name,
                    type: currentContent.type,
                    parentId: currentContent.parentId === -1 ? createdContent[createdContent.length - 1].id : currentContent.parentId,
                    userId: state.userId,
                    metadata: { ...(currentContent?.metadata || {}), ...metadata } as LibraryItemMetadata,
                })
                .returning();

            if (!createdItem[0] || !createdItem[0].uid) {
                throw new BadRequestException('Failed to create content');
            }

            console.log(`[Node] Create One Content: [${createdItem[0].name} (${createdItem[0].type})]`);
            return {
                ...state,
                currentCreationIndex: state.currentCreationIndex + 1,
                createdContent: [...state.createdContent, createdItem[0]],
            };
        } catch (error) {
            this.logger.error('Create One Content: ', error);
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
                You are StudyMind AI, an educational assistant. Analyze the provided content and respond according to user requests.
                
                Guidelines:
                - Provide detailed, educational explanations
                - Break down complex concepts into understandable parts
                - Use examples and analogies when helpful
                - Reference specific parts of the content when relevant
                - Maintain an encouraging, supportive tone
                - If the user asks about specific sections/pages, focus on those areas
                
                Referenced Content:
                ${contextReferences}

                Previous Chat Summary: ${state.prevSummary}
            `);

            const response = await this.genAI.invoke([systemPrompt, new HumanMessage(state.userMessage)]);

            if (!response.text) {
                throw new BadRequestException('Failed to analyze content');
            }

            console.log('[Node] Analyze Content');
            return { ...state, response: response.text };
        } catch (error) {
            this.logger.error('Analyze Content: ', error);
            throw new BadRequestException('Failed to analyze content');
        }
    }
    private async contextualChat(state: typeof StudyMindState.State) {
        try {
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

            console.log('[Node] Contextual Chat');
            return { ...state, response: response.text };
        } catch (error) {
            this.logger.error('Contextual Chat: ', error);
            throw new BadRequestException('Failed to generate user reply');
        }
    }
    private async generateUserReply(state: typeof StudyMindState.State) {
        try {
            if (state.messageType === 'READ' || state.messageType === 'CHAT') {
                console.log('[Node] Generate User Reply');
                return state;
            } else if (state.messageType === 'UPDATE' || state.messageType === 'DELETE') {
                return {
                    ...state,
                    response: "Sorry, update and delete operations are not supported yet. We're working to bring this feature soon!",
                };
            } else if (state.messageType === 'CREATE') {
                const promptTemplate = ChatPromptTemplate.fromTemplate(`
                    You are StudyMind AI. You successfully created content based on the user's request.

                    User Message: {userMessage}
                    Created Content: {createdContent}

                    Generate a short, friendly success message that:
                    - Confirms what was created
                    - Encourages continued learning
                    - Ends with "Click here to view"

                    Keep it under 50 words and enthusiastic.
                `);

                const response = await this.genAI.invoke(
                    await promptTemplate.formatMessages({
                        createdContent: state.createdContent.map(item => `- ${item.name} (${item.type})`).join('\n'),
                        userMessage: state.userMessage,
                    }),
                );

                console.log('[Node] Generate User Reply');
                return {
                    ...state,
                    response: response.text.replace(/@mention\s*{[^}]+}|@created\s*{[^}]+}/g, ''),
                };
            }
        } catch (error) {
            this.logger.error('Generate User Reply: ', error);
            throw new BadRequestException('Failed to generate user reply');
        }
    }
    private async updateChatSession(state: typeof StudyMindState.State) {
        try {
            const SummarySchema = z.object({ title: z.string(), summary: z.string() });
            const structureModel = this.genAI.withStructuredOutput(SummarySchema);
            const promptTemplate = ChatPromptTemplate.fromTemplate(
                `You are StudyMind AI, an educational assistant. Generate a title and summary of the current conversation that captures the sessions context.

                ## TITLE: 
                - Use specific educational terms (e.g., "Calculus: Derivatives", "Biology: Cell Structure")
                - Include subject + topic, under 60 characters

                ## SUMMARY GUIDELINES:
                Create a structured summary that includes:

                **Learning Context:**
                - Primary subject(s) and topics discussed
                - Educational level or complexity (if apparent)
                - Learning objectives or questions addressed

                **Content Activity:**
                - All @created content with their types and purposes
                - All @mention content and how they were used
                - Content relationships (e.g., "@created {{"uid": "...", "name": "Organic Chemistry Flashcards", "type": "FLASHCARD"}} created from @mention {{"uid": "...", "name": "Organic Chemistry Notes", "type": "NOTE"}}")

                **Learning Progress:**
                - Key concepts explained or clarified
                - Problems solved or questions answered
                - Next steps or follow-up actions identified

                ## CRITICAL REQUIREMENTS:
                - Include all @created and @mention tags as they appear in conversation
                - Never fabricate or hallucinate content references

                ## CONVERSATION DATA:
                **User Message:** {userMessage}
                **Intent Type:** {messageType}
                **AI Response:** {response}
                
                **Created Content:**
                {createdContent}

                **Previous Summary:** {prevSummary}`,
            );

            const response = await structureModel.invoke(
                await promptTemplate.formatMessages({
                    userMessage: state.userMessage,
                    messageType: state.messageType,
                    response: state.response,
                    createdContent:
                        state.createdContent.length > 0
                            ? state.createdContent
                                  .map(item => `@created {"uid": "${item.uid}", "name": "${item.name}", "type": "${item.type}"}`)
                                  .join('\n')
                            : 'No content created',
                    prevSummary: state.prevSummary || 'No previous summary',
                }),
            );

            if (!response?.title || !response?.summary) {
                throw new BadRequestException('Failed to update chat session');
            }

            return {
                ...state,
                session: {
                    ...state.session,
                    title: response.title,
                    summary: response.summary,
                },
                response: `${state.response}\n${state.createdContent
                    .map(content => `@created ${JSON.stringify({ ...content, metadata: null })}`)
                    .join('\n')}`,
            };
        } catch (error) {
            this.logger.error('Update Chat Session:', error);
            throw new BadRequestException('Failed to update chat session ');
        }
    }

    // 🎯 Routing
    private routeAfterRefs(state: typeof StudyMindState.State) {
        console.log('[Route] Route After Refs');
        return state.messageType;
    }
    private routeAfterContext(state: typeof StudyMindState.State) {
        console.log('[Route] Route After Context');
        return state.messageType;
    }
    private routeContentProgress(state: typeof StudyMindState.State) {
        const { contentCreationQueue, currentCreationIndex } = state;

        console.log('[Route] Route Content Progress');
        return currentCreationIndex < contentCreationQueue.length ? 'CONTINUE' : 'COMPLETE';
    }

    // 🎯 Main entrypoint
    async generateGraphResponses(
        userId: number,
        sessionUid: string,
        chatSummary: string,
        chatMessage: MessageDto[],
        dbTxn: Transaction,
    ): Promise<typeof StudyMindState.State> {
        try {
            this.dbTxn = dbTxn;
            const initialState: typeof StudyMindState.State = {
                userId: userId,
                session: { uid: sessionUid, title: '', summary: '' },
                userMessage: chatMessage[chatMessage.length - 1].message,
                prevMessage: chatMessage.slice(0, -1),
                prevSummary: chatSummary,
                messageType: 'CHAT',
                contentCreationQueue: [],
                currentCreationIndex: 0,
                createdContent: [],
                sessionContext: [],
                mentionContext: [],
                response: null,
                error: null,
            };

            const result = await this.buildGraph().invoke(initialState);

            console.log('[Node] Graph Execution');
            return result;
        } catch (error) {
            this.logger.error('Graph Execution: ', error);
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
            this.logger.error('Generate Response: ', error);
            throw new BadRequestException('Failed to generate response');
        }
    }

    private async putInState(
        state: typeof StudyMindState.State,
        reference: { uid: string; needContent: boolean; purpose: string }[],
        itemData: LibraryItem[],
    ): Promise<ReferenceCt[]> {
        const result: ReferenceCt[] = [];
        for (const item of reference) {
            const itemD = itemData.find(d => d.uid === item.uid);

            if (!itemD) {
                console.warn(`Content not found for uid: ${item.uid}`);
                continue;
            }

            const systemPrompt = `
                You are StudyMind AI, an educational assistant. Based on the user request, ${item?.purpose}.

                Guidelines:
                - Be specific and educational-focused
                - Provide clear, structured information
                - Focus on the user's learning objectives
                - Use examples when helpful

                User Request: ${state.userMessage}
                Content Name: ${itemD.name}`;

            let content = '';
            if (item?.needContent) {
                switch (itemD?.type) {
                    case 'NOTE': {
                        const metadata = itemD.metadata as NoteMetadata;
                        const contexts = metadata?.notes || '';

                        content = await this.generateResponse(contexts, systemPrompt);
                        break;
                    }
                    case 'DOCUMENT': {
                        const contexts = await this.vectorService.searchByItemUid(item.purpose, itemD.uid);

                        content = await this.generateResponse(contexts, systemPrompt);
                        break;
                    }
                    case 'FLASHCARD': {
                        const metadata = itemD.metadata as FlashcardMetadata;
                        const contexts = metadata?.cards?.length
                            ? metadata.cards.map(item => `- ${item.question}: ${item.answer}`).join('\n')
                            : '';

                        content = await this.generateResponse(contexts, systemPrompt);
                        break;
                    }
                    case 'AUDIO':
                        content = 'Audio content processing not implemented yet';
                        break;
                    case 'VIDEO':
                        content = 'Video content processing not implemented yet';
                        break;
                    case 'IMAGE':
                        content = 'Image content processing not implemented yet';
                        break;
                }
            }

            result.push({
                id: itemD.id,
                uid: itemD.uid,
                name: itemD.name,
                type: itemD.type,
                parentId: itemD.parentId,
                purpose: item?.purpose,
                content,
            });
        }

        return result;
    }
}
