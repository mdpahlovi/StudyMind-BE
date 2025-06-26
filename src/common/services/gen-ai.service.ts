import { DatabaseService } from '@/database/database.service';
import { libraryItem } from '@/database/schemas';
import { MessageDto } from '@/modules/chat/chat.dto';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';

type MessageType = 'CONTEXTUAL_CHAT' | 'CREATE_CONTENT' | 'ANALYZE_CONTENT';

const StudyMindState = Annotation.Root({
    session: Annotation<{ uid: string; title: string; description: string }>(),
    userMessage: Annotation<string>(),
    prevMessage: Annotation<Array<MessageDto>>(),
    prevSummary: Annotation<string>(),
    messageType: Annotation<MessageType>(),
    contentCreationQueue: Annotation<Array<{}>>(),
    currentCreationIndex: Annotation<number>(),
    createdContent: Annotation<Array<any>>(),
    sessionContext: Annotation<Array<{}>>(),
    mentionContext: Annotation<Array<{}>>(),
    response: Annotation<string>(),
    error: Annotation<string | null>(),
});

@Injectable()
export class GenAIService {
    private genAI: ChatGoogleGenerativeAI;
    private gptAi: ChatOpenAI;
    private graph;

    constructor(
        private readonly configService: ConfigService,
        private readonly databaseService: DatabaseService,
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

            console.log('Identify User Intent:', response);
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
            console.error('Identify User Intent: ', error);
            throw new BadRequestException('Failed to identify user intent');
        }
    }
    private async resolveMentions(state: typeof StudyMindState.State) {
        const ResolveMentionSchema = z.object({
            mentions: z.array(z.string()),
            sessions: z.array(z.string()),
        });

        const structureModel = this.genAI.withStructuredOutput(ResolveMentionSchema);
        const promptTemplate = ChatPromptTemplate.fromTemplate(
            `You are StudyMind AI, an educational assistant. User wants to {intent} content. Extract required @mention {{...}} from user's message and @created {{...}} from the previous chat summary.
            
            Previous Chat Summary: {prevSummary}
            User Message: {userMessage}
            
            Context Examples:
            1) Previous Chat Summary: "I created a folder 'Mathematics' @created {{uid: 'abc123', name: 'Mathematics', type: 'FOLDER'}}"
               User Message: "Create a document about calculus derivatives"
               → Need @created folder to place the document
            
            2) User Message: "@mention {{uid: 'xyz789', name: 'Calculus Chapter 3', type: 'DOCUMENT'}} create flashcards from this"
               → Need @mention document to read and create flashcards
            
            3) User Message: "@mention {{uid: 'doc123', name: 'Physics Notes', type: 'DOCUMENT'}} explain the second paragraph"
               → Need @mention document for analysis
            
            4) Previous Chat Summary: "Created flashcards @created {{uid: 'flash456', name: 'Algebra Basics', type: 'FLASHCARD'}}"
               User Message: "Make similar flashcards for geometry"
               → Need @created flashcards as reference
            
            Return:
            - mentions: Array of UIDs from @mention {{...}} patterns
            - sessions: Array of UIDs from @created {{...}} patterns that are contextually relevant
            `,
        );

        const response = await structureModel.invoke(
            await promptTemplate.formatMessages({
                prevSummary: state.prevSummary || '',
                userMessage: state.userMessage,
                intent: state.messageType.split('_')[0].toLowerCase(),
            }),
        );

        if (!response?.mentions && !response?.sessions) return state;

        const db = this.databaseService.database;
        const uniqueUid = [...new Set([...response.mentions, ...response.sessions])];

        const items = await db
            .select({
                id: libraryItem.id,
                uid: libraryItem.uid,
                name: libraryItem.name,
                type: libraryItem.type,
                metadata: libraryItem.metadata,
            })
            .from(libraryItem)
            .where(inArray(libraryItem.uid, uniqueUid));

        state.mentionContext = response.mentions.map(uid => items.find(item => item.uid === uid));
        state.sessionContext = response.sessions.map(uid => items.find(item => item.uid === uid));

        return state;
    }
    private planContentQueue(state: typeof StudyMindState.State) {
        /* ... */
    }
    private createOneContent(state: typeof StudyMindState.State) {
        /* ... */
    }
    private checkCreationProcess(state: typeof StudyMindState.State) {
        /* ... */
    }
    private analyzeContent(state: typeof StudyMindState.State) {
        /* ... */
    }
    private contextualChat(state: typeof StudyMindState.State) {
        /* ... */
    }
    private async generateUserReply(state: typeof StudyMindState.State) {
        try {
            if (state.messageType === 'CONTEXTUAL_CHAT') {
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

                console.log('Contextual Response:', response.text);
                return { ...state, response: response.text };
            } else if (state.messageType === 'CREATE_CONTENT') {
                return state;
            } else if (state.messageType === 'ANALYZE_CONTENT') {
                return state;
            }
        } catch (error) {
            console.error('Generate Reply: ', error);
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

            console.log('Graph Execution: ', result);
            return result;
        } catch (error) {
            console.error('Graph Execution:', error);
            throw new BadRequestException('Failed to generate response');
        }
    }

    async generateResponse(message: string) {
        try {
            const response = await this.genAI.invoke([new HumanMessage(message)]);
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

        console.log('Summary: ', response.text);
        return response.text;
    }
}
