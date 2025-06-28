import { DatabaseService } from '@/database/database.service';
import { LibraryItem, libraryItem, LibraryItemType } from '@/database/schemas';
import { MessageDto } from '@/modules/chat/chat.dto';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, PromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { inArray } from 'drizzle-orm';
import { OutputFixingParser, StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';
import { DownloadService } from './download.service';

type MessageType = 'CONTEXTUAL_CHAT' | 'CREATE_CONTENT' | 'ANALYZE_CONTENT';

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
    private dbTxn;

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
            .addNode('createContentQueue', this.createContentQueue.bind(this))
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
                3. CONTEXTUAL_CHAT: General discussions/Q&A without content creation or analysis
                
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

            if (!response.title || !response.description || !response.messageType) {
                throw new BadRequestException('Failed to identify user intent');
            }

            console.log(`[Node] Identify User Intent: [${response.messageType}]`);
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

            if (!response?.mentions?.length && !response?.sessions?.length) {
                console.log('[Node] Resolve Mention: [No Valid Mentions Found]');
                return state;
            }

            const db = this.dbTxn ? this.dbTxn : this.databaseService.database;

            const itemsUid = [...response.mentions, ...response.sessions].map(item => item.uid);
            const itemData = await db.select().from(libraryItem).where(inArray(libraryItem.uid, itemsUid));

            state.mentionContext = await this.putInState(response.mentions, itemData as any);
            state.sessionContext = await this.putInState(response.sessions, itemData as any);

            console.log(`[Node] Resolve Mention: [${response.mentions.length} Mentions Found, ${response.sessions.length} Sessions Found]`);
            return state;
        } catch (error) {
            this.logger.error('Resolve Mention: ', error);
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
                        uid: item.uid,
                        name: item.name,
                        type: item.type,
                        parentId: item.parentId == null ? 0 : item.parentId,
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
            if (state.messageType === 'CONTEXTUAL_CHAT') {
                console.log('[Node] Generate User Reply');
                return state;
            } else if (state.messageType === 'CREATE_CONTENT') {
                const promptTemplate = ChatPromptTemplate.fromTemplate(`
                    You are StudyMind AI. You successfully created content for the user.

                    User Message: {userMessage}
                    Created Content: {createdContent}

                    Generate a short, friendly success message that:
                    - Confirms what was created
                    - Encourages continued learning
                    - Ends with "Click here to view ↓"

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
                    response: `${response.text}\n${state.createdContent
                        .map(content => {
                            return `@created ${JSON.stringify({ ...content, metadata: null })}`;
                        })
                        .join('\n')}`,
                };
            } else if (state.messageType === 'ANALYZE_CONTENT') {
                console.log('[Node] Generate User Reply');
                return state;
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

        console.log('Summary');
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
