import { DownloadService } from '@/common/services/download.service';
import { GenAIService } from '@/common/services/gen-ai.service';
import { SupabaseService } from '@/common/services/supabase.service';
import { DatabaseService } from '@/database/database.service';
import { libraryItem, User } from '@/database/schemas';
import { chatMessages, chatSessions } from '@/database/schemas/chat.schema';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray } from 'drizzle-orm';
import { RequestQueryDto, UpdateBulkChatSessionDto, UpdateChatSessionDto } from './chat.dto';

@Injectable()
export class ChatService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly supabaseService: SupabaseService,
        private readonly genAIService: GenAIService,
        private readonly downloadService: DownloadService,
    ) {}

    async getChats(query: any, user: User) {
        const db = this.databaseService.database;

        const search = query.search || '';

        const chatSessionWhere = [eq(chatSessions.isActive, true), eq(chatSessions.userId, user.id)];
        const chatSessionOrder = [desc(chatSessions.updatedAt)];

        if (search) {
            chatSessionWhere.push(ilike(chatSessions.title, `%${search}%`));
        }

        const total = await db
            .select({ count: count() })
            .from(chatSessions)
            .where(and(...chatSessionWhere));

        const sessions = await db
            .select()
            .from(chatSessions)
            .where(and(...chatSessionWhere))
            .orderBy(...chatSessionOrder);

        return {
            message: 'Chat sessions fetched successfully',
            data: {
                sessions: sessions || [],
                total: total?.length ? total[0].count : 0,
            },
        };
    }

    async getOneChat(uid: string, user: User) {
        const db = this.databaseService.database;

        const session = await db
            .select()
            .from(chatSessions)
            .where(and(eq(chatSessions.uid, uid), eq(chatSessions.userId, user.id)))
            .orderBy(desc(chatSessions.updatedAt));

        if (!session?.length) {
            throw new NotFoundException('Chat session not found');
        }

        const messages = await db
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.chatSessionId, session[0].id))
            .orderBy(asc(chatMessages.createdAt));

        return {
            message: 'Chat session fetched successfully',
            data: {
                session: session[0],
                messages: messages || [],
            },
        };
    }

    async requestQuery(uid: string, body: RequestQueryDto, user: User) {
        const db = this.databaseService.database;

        return await db.transaction(async tx => {
            const currMessage = body.message[body.message.length - 1];
            const chatMessage = body.message;

            const initialDecision = await this.genAIService.generateInitialDecision(chatMessage);
            if (!initialDecision?.action) {
                throw new BadRequestException('Please provide more specific instructions. Thank you.');
            }

            // Create or update chat session
            const chatSession = await tx
                .insert(chatSessions)
                .values({
                    uid: uid,
                    userId: user.id,
                    title: initialDecision?.title || 'Unnamed Chat',
                    description: initialDecision?.description || '',
                    lastMessage: currMessage.message,
                    lastMessageAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: [chatSessions.uid],
                    set: {
                        lastMessage: currMessage.message,
                        lastMessageAt: new Date(),
                    },
                })
                .returning();

            // Insert current message
            await tx.insert(chatMessages).values({
                ...currMessage,
                chatSessionId: chatSession[0].id,
            });

            if (!chatSession?.length || !chatMessage?.length) {
                throw new NotFoundException('Chat session or message not found. Please try again.');
            }

            let response = '';
            if (initialDecision.action === 'CHAT') {
                response = await this.genAIService.generateContextualResponse(chatMessage);
            }
            if (initialDecision.action === 'READ') {
                // response = await this.genAIService.generateContentAnalysis(chatMessage);
            }
            if (initialDecision.action === 'CREATE') {
                let references = [];

                // Get reference items
                if (initialDecision?.references?.length) {
                    references = await tx
                        .select()
                        .from(libraryItem)
                        .where(
                            inArray(
                                libraryItem.uid,
                                initialDecision.references.map(ref => ref.uid),
                            ),
                        );
                }

                // Content generation prompt
                const createResponse = await this.genAIService.generateContentCreation(chatMessage, references);
                if (!createResponse?.name || !createResponse?.type) {
                    throw new BadRequestException('Please provide more specific instructions. What do you want to create?');
                }
                if (['DOCUMENT', 'AUDIO', 'VIDEO', 'IMAGE'].includes(createResponse?.type) && !createResponse?.prompt) {
                    throw new BadRequestException('Please provide more specific instructions. What do you want to create?');
                }

                let metadata = {};
                if (createResponse?.type === 'DOCUMENT') {
                    metadata = await this.downloadService.downloadPdf(createResponse.prompt, createResponse.name);
                } else if (createResponse?.type === 'AUDIO') {
                    metadata = await this.downloadService.downloadFile(
                        `https://text.pollinations.ai/${createResponse.prompt}?model=openai-audio&voice=nova`,
                        createResponse.name,
                        createResponse?.metadata?.fileType || 'mp3',
                    );
                } else if (createResponse?.type === 'VIDEO') {
                } else if (createResponse?.type === 'IMAGE') {
                    const resolution = createResponse?.metadata?.resolution?.split('x');
                    const width = resolution?.length === 2 ? resolution[0] : '1024';
                    const height = resolution?.length === 2 ? resolution[1] : '1024';
                    metadata = await this.downloadService.downloadFile(
                        `https://image.pollinations.ai/prompt/${createResponse.prompt}?width=${width}&height=${height}`,
                        createResponse.name,
                        createResponse?.metadata?.fileType || 'png',
                    );
                }

                const createdItem = await tx
                    .insert(libraryItem)
                    .values({
                        name: createResponse.name,
                        type: createResponse.type,
                        parentId: createResponse?.parentId || null,
                        userId: user.id,
                        metadata: { ...(createResponse?.metadata || {}), ...metadata },
                    })
                    .returning();

                if (createdItem?.length) {
                    response = `An item has been created successfully in your library. click here to view.\n\n@created {uid: '${createdItem[0].uid}', name: '${createdItem[0].name}', type: '${createdItem[0].type}'}`;
                } else {
                    throw new BadRequestException('Failed to create item. Please try again later.');
                }
            }

            if (response) {
                const message = await tx
                    .insert(chatMessages)
                    .values({
                        role: 'ASSISTANT',
                        chatSessionId: chatSession[0].id,
                        message: response,
                    })
                    .returning();

                return {
                    message: 'Chat session requested successfully',
                    data: {
                        session: chatSession[0],
                        message: message[0],
                    },
                };
            } else {
                throw new BadRequestException('Failed to generate response. Please try again later.');
            }
        });
    }

    async updateChatSession(uid: string, body: UpdateChatSessionDto, user: User) {
        const db = this.databaseService.database;

        const [doesChatSessionsExist] = await db.select().from(chatSessions).where(eq(chatSessions.uid, uid));

        if (!doesChatSessionsExist) {
            throw new NotFoundException('Chat session not found');
        }

        const updatedData = await db
            .update(chatSessions)
            .set({
                ...(body.title ? { name: body.title } : {}),
                updatedAt: new Date(),
            })
            .where(eq(chatSessions.uid, uid))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update chat session');
        }

        return { message: 'Chat session updated successfully', data: updatedData[0] };
    }

    async updateBulkChatSession(body: UpdateBulkChatSessionDto, user: User) {
        const db = this.databaseService.database;

        const updatedData = await db
            .update(chatSessions)
            .set({ isActive: false, updatedAt: new Date() })
            .where(inArray(chatSessions.uid, body.uid))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update chat session');
        }

        return { message: 'Chat session updated successfully', data: updatedData };
    }
}
