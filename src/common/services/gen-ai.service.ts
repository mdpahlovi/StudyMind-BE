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
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { DownloadService } from './download.service';
import { VectorService } from './vector.service';

type MessageType = 'CHAT' | 'CREATE' | 'UPDATE' | 'DELETE' | 'READ';
type ReferenceCt = { id: number; uid: string; name: string; type: string; parentId: number | null; purpose: string; content: string };

const FolderIcon = [
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
] as const;

const StudyMindState = Annotation.Root({
    userId: Annotation<number>(),
    session: Annotation<{ uid: string; title: string; description: string }>(),
    userMessage: Annotation<string>(),
    prevMessage: Annotation<Array<MessageDto>>(),
    prevSummary: Annotation<string>(),
    messageType: Annotation<MessageType>(),
    contentCreationQueue:
        Annotation<Array<{ name: string; type: LibraryItemType; parentId: number | null; metadata?: {}; prompt?: string }>>(),
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
    private gptAi: ChatOpenAI;
    private graph;
    private dbTxn;

    constructor(
        private readonly configService: ConfigService,
        private readonly databaseService: DatabaseService,
        private readonly downloadService: DownloadService,
        private readonly vectorService: VectorService,
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
            .addNode('createContentQueue', this.createContentQueue.bind(this))
            .addNode('createOneContent', this.createOneContent.bind(this))
            .addNode('checkCreationProcess', this.checkCreationProcess.bind(this))
            .addNode('analyzeContent', this.analyzeContent.bind(this))
            .addNode('contextualChat', this.contextualChat.bind(this))
            .addNode('generateUserReply', this.generateUserReply.bind(this))

            // Added all the edges
            .addEdge(START, 'identifyUserIntent')
            .addConditionalEdges('identifyUserIntent', this.routeAfterRefs.bind(this), {
                CHAT: 'contextualChat',
                CREATE: 'resolveMentions',
                UPDATE: 'generateUserReply',
                DELETE: 'generateUserReply',
                READ: 'resolveMentions',
            })
            .addConditionalEdges('resolveMentions', this.routeAfterContext.bind(this), {
                CREATE: 'planContentQueue',
                READ: 'analyzeContent',
            })
            .addEdge('planContentQueue', 'createContentQueue')
            .addEdge('createContentQueue', 'createOneContent')
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
                messageType: z.enum(['CHAT', 'CREATE', 'UPDATE', 'DELETE', 'READ']),
            });
            const structureModel = this.genAI.withStructuredOutput(IntentSchema);
            const promptTemplate = ChatPromptTemplate.fromTemplate(
                `You are StudyMind AI's intent classifier. Classify user's intent and respond accordingly.
                
                Message Type:
                1. READ: When user @mention existing content or references content from previous conversation and wants to read/analyze/understand/learn/discuss it
                2. CREATE: When user wants to create new content using creation keywords (create, make, generate, turn into, convert, build, add)
                3. UPDATE: When user wants to modify existing content using update keywords (edit, modify, change, update, revise, improve)  
                4. DELETE: When user wants to remove/delete existing content using delete keywords (delete, remove, trash, eliminate)
                5. CHAT (Default): General questions without specific content management intent

                Title: Be specific and educational-focused (e.g., "Calculus Derivative and Integral").
                Description: Capture the user's learning goal, intent and subject area.
                
                Previous Chat Summary: {prevSummary}
                User Message: {userMessage}`,
            );

            const response = await structureModel.invoke(
                await promptTemplate.formatMessages({
                    prevSummary: state.prevSummary,
                    userMessage: state.userMessage,
                }),
            );

            if (!response.title || !response.description || !response.messageType) {
                throw new BadRequestException('Failed to identify user intent');
            }

            console.log(`[Node] Identify User Intent: [${response.messageType}]`);
            return {
                ...state,
                session: {
                    ...state.session,
                    title: response.title,
                    description: response.description,
                },
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
                    prevSummary: state.prevSummary,
                    userMessage: state.userMessage,
                    messageType: state.messageType,
                }),
            );

            if (response?.mentionContent?.length === 0 && response?.createdContent?.length === 0) {
                console.log('[Node] Resolve Mention: [No Valid References Found]');
                return state;
            }

            const db = this.dbTxn ? this.dbTxn : this.databaseService.database;

            const itemsUid = [...response.mentionContent, ...response.createdContent].map(item => item.uid);
            const itemData = await db
                .select()
                .from(libraryItem)
                .where(and(inArray(libraryItem.uid, itemsUid), eq(libraryItem.isActive, true)));

            state.mentionContext = await this.putInState(state, response.mentionContent, itemData as any);
            state.sessionContext = await this.putInState(state, response.createdContent, itemData as any);

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
                    prevSummary: state.prevSummary,
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

            if (
                !response.contentQueue ||
                !response.contentQueue.length ||
                !response.contentQueue.every(item => item.name && item.type && typeof item.parentId === 'number')
            ) {
                throw new BadRequestException('Failed to plan content structure');
            }

            console.log(`[Node] Plan Content Structure: [${response.contentQueue.length} content planned]`);
            return {
                ...state,
                contentCreationQueue: response.contentQueue,
                currentCreationIndex: 0,
            };
        } catch (error) {
            this.logger.error('Plan Content Structure: ', error);
            throw new BadRequestException('Failed to plan content structure');
        }
    }
    private async createContentQueue(state: typeof StudyMindState.State) {
        try {
            const contentQueue = [];

            for (const contentItem of state.contentCreationQueue) {
                const CreateContentSchema = z.object({
                    metadata: z
                        .object({
                            // Common fields
                            description: z.string().optional(),
                            // Folder specific
                            color: z.string().optional(),
                            icon: z.string().optional(),
                            // Note specific
                            notes: z.string().optional(),
                            // Media specific
                            fileType: z.string().optional(),
                            duration: z.number().optional(),
                            resolution: z.string().optional(),
                        })
                        .optional(),
                    prompt: z.string().optional(),
                });

                const structureModel = this.genAI.withStructuredOutput(CreateContentSchema);

                const promptTemplate = ChatPromptTemplate.fromTemplate(`
                You are StudyMind AI. I have already analyzed the user's request and planned the required content structure. 
                Now, based on the content type, generate the appropriate metadata and prompt for this specific item:

                Previous Chat Summary: {prevSummary}
                User Message: {userMessage}
                Content Item: {contentItem}

                REFERENCED CONTENT:
                Based on previous created content @created {{...}} and users mentioned content @mention {{...}}, the system provides required parentId in references array:
                {references}

                TYPE-SPECIFIC REQUIREMENTS:

                FOLDER:
                - metadata.color: hex code (e.g., "#A8C686")
                - metadata.icon: from enum {folderIcons}

                NOTE:
                - metadata.description: brief description
                - metadata.notes: well-structured markdown content (max 500 words)

                FLASHCARD:
                - metadata.description: brief description  
                - prompt: detailed content outline for flashcard generation (max 250 words)

                DOCUMENT:
                - metadata.description: brief description
                - metadata.fileType: "pdf"
                - prompt: well-structured markdown content for md to pdf conversion (max 500 words)

                AUDIO:
                - metadata.description: brief description
                - metadata.fileType: "mp3"
                - metadata.duration: estimated seconds
                - prompt: natural speech script (max 100 words)

                VIDEO:
                - metadata.description: brief description
                - metadata.fileType: "mp4"  
                - metadata.duration: estimated seconds
                - prompt: video script (max 100 words)

                IMAGE:
                - metadata.description: brief description
                - metadata.fileType: "png"
                - metadata.resolution: "widthxheight" (e.g., "1920x1080")
                - prompt: image description (max 20 words)

                Generate ONLY what's needed for this specific item type.
            `);

                const response = await structureModel.invoke(
                    await promptTemplate.formatMessages({
                        prevSummary: state.prevSummary,
                        userMessage: state.userMessage,
                        contentItem: contentItem,
                        references: [...state.mentionContext, ...state.sessionContext].map(item => ({
                            uid: item.uid,
                            name: item.name,
                            type: item.type,
                            content: item.content,
                        })),
                        folderIcons: FolderIcon.join(', '),
                    }),
                );

                if (!['FOLDER', 'NOTE'].includes(contentItem.type) && !response.prompt) {
                    throw new BadRequestException('Failed to generate content');
                }

                contentQueue.push({
                    ...contentItem,
                    parentId: contentItem.parentId !== 0 ? contentItem.parentId : null,
                    metadata: response.metadata || {},
                    ...(response.prompt && { prompt: response.prompt }),
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
            const currentContent = contentCreationQueue[currentCreationIndex] as any;

            let metadata = {};
            if (currentContent?.type === 'DOCUMENT') {
                metadata = await this.downloadService.downloadPdf(currentContent.prompt, currentContent.name);
            } else if (currentContent?.type === 'FLASHCARD') {
                const FlashcardSchema = z.object({
                    cards: z.array(z.object({ question: z.string(), answer: z.string() })),
                });

                const structureModel = this.genAI.withStructuredOutput(FlashcardSchema);
                const promptTemplate = ChatPromptTemplate.fromTemplate(`
                    You are StudyMind AI. Generate educational flashcards based on the provided content outline.
        
                    Flashcard Content Outline: {prompt}
                    Flashcard Set Name: {name}
        
                    YOUR TASK: Create engaging question-answer pairs that help students learn and remember key concepts.
        
                    GUIDELINES:
                    - Generate 5-10 flashcards (max 10)
                    - Questions should be clear and specific
                    - Answers should be concise but complete
                    - Cover different aspects: definitions, examples, applications
                    - Use variety: what, why, how, when questions
                    - Make questions challenging but fair
        
                    EXAMPLES:
                    - "What is [concept]?" → "Definition and key characteristics"
                    - "Why does [phenomenon] occur?" → "Explanation of causes/reasons"
                    - "How do you calculate [formula]?" → "Step-by-step process"
                    - "When is [method] used?" → "Specific scenarios and applications"
        
                    Generate diverse, educational flashcards that promote active learning.
                `);

                const response = await structureModel.invoke(
                    await promptTemplate.formatMessages({
                        prompt: currentContent.prompt,
                        name: currentContent.name,
                    }),
                );

                if (!response.cards || response.cards.length === 0) {
                    throw new BadRequestException('Failed to generate flashcards');
                }

                metadata = { cards: response.cards, cardCount: response.cards.length };
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

            const db = this.dbTxn ? this.dbTxn : this.databaseService.database;

            const createdItem = await db
                .insert(libraryItem)
                .values({
                    isEmbedded: ['DOCUMENT', 'AUDIO', 'VIDEO', 'IMAGE'].includes(currentContent.type) ? false : true,
                    name: currentContent.name,
                    type: currentContent.type,
                    parentId: currentContent.parentId === -1 ? createdContent[createdContent.length - 1].id : currentContent.parentId,
                    userId: state.userId,
                    metadata: { ...(currentContent?.metadata || {}), ...metadata },
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
                    response: `${response.text.replace(/@mention\s*{[^}]+}|@created\s*{[^}]+}/g, '')}\n${state.createdContent
                        .map(content => `@created ${JSON.stringify({ ...content, metadata: null })}`)
                        .join('\n')}`,
                };
            }
        } catch (error) {
            this.logger.error('Generate User Reply: ', error);
            throw new BadRequestException('Failed to generate user reply');
        }
    }
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
        chatMessages: MessageDto[],
        dbTxn,
    ): Promise<typeof StudyMindState.State> {
        try {
            this.dbTxn = dbTxn;
            const initialState: typeof StudyMindState.State = {
                userId: userId,
                session: { uid: sessionUid, title: '', description: '' },
                userMessage: chatMessages[chatMessages.length - 1].message,
                prevMessage: chatMessages.slice(0, -1),
                prevSummary: await this.generateSummary(chatMessages.slice(0, -1)),
                messageType: 'CHAT',
                contentCreationQueue: [],
                currentCreationIndex: 0,
                createdContent: [],
                sessionContext: [],
                mentionContext: [],
                response: null,
                error: null,
            };

            const result = await this.graph.invoke(initialState);

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
            throw new BadRequestException('Failed to generate response');
        }
    }

    async generateSummary(chatHistory: MessageDto[]) {
        if (chatHistory.length === 0) return '';

        const recentConversation = chatHistory
            .slice(-10) // Limit to the last 10 messages
            .map(msg => `${msg.role}: ${msg.message}`)
            .join('\n');

        const response = await this.genAI.invoke([
            new SystemMessage(`You are StudyMind AI, an educational assistant. Summarize the key context from this conversation in a few sentences. FOCUS ON:
            - Main topics discussed
            - Any content @created or @mention in the conversation
            - Current learning goals or questions
            - Educational subject areas

            IMPORTANT: Must include all @created and @mention tags that actually appear in the conversation. Do not hallucinate content references.

            Take @created and @mention tags like this:
            - @created {"uid": "...", "name": "...", "type": "..."}
            - @mention {"uid": "...", "name": "...", "type": "..."}
            `),
            new HumanMessage(`Conversation:\n${recentConversation}`),
        ]);

        console.log('Summary');
        return response.text;
    }

    private async putInState(state: typeof StudyMindState.State, reference: any[], itemData: LibraryItem[]) {
        const result = [];
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
                    case 'FOLDER':
                        const folderContent = await this.databaseService.database
                            .select()
                            .from(libraryItem)
                            .where(
                                and(
                                    eq(libraryItem.parentId, itemD.id),
                                    eq(libraryItem.userId, state.userId),
                                    eq(libraryItem.isActive, true),
                                    ne(libraryItem.type, 'FOLDER'),
                                ),
                            );

                        const folderPrompt = `
                            You are StudyMind AI, an educational assistant analyzing a student's study folder.

                            User Message: ${state.userMessage}
                            Folder Name: ${itemD.name}
                            Folder Contents:
                            ${folderContent.map(item => `- ${item.name} (${item.type})`).join('\n')}

                            Provide a comprehensive response that helps the student understand their available resources and how they relate to their request.`;

                        content = await this.generateResponse(folderPrompt);
                        break;
                    case 'NOTE':
                        const noteContent = itemD.metadata?.['notes'] || '';
                        content = await this.generateResponse(noteContent, systemPrompt);
                        break;
                    case 'DOCUMENT':
                        const documentContent = await this.vectorService.searchByItemUid(item.purpose, itemD.uid);
                        content = await this.generateResponse(documentContent, systemPrompt);
                        break;
                    case 'FLASHCARD':
                        const flashcardContent = itemD.metadata?.['cards']?.length
                            ? itemD.metadata['cards'].map(item => `- ${item.question}: ${item.answer}`).join('\n')
                            : '';
                        content = await this.generateResponse(flashcardContent, systemPrompt);
                        break;
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
