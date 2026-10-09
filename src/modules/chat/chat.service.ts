import { GenAIService } from '@/common/services/gen-ai.service';
import { VectorService } from '@/common/services/vector.service';
import { DatabaseService } from '@/database/database.service';
import { User } from '@/database/schemas';
import { chatMessages, chatSessions } from '@/database/schemas/chat.schema';
import { DocumentMetadata } from '@/database/schemas/library.schema';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray } from 'drizzle-orm';
import { DeleteBulkChatSessionDto, RequestQueryDto, UpdateBulkChatSessionDto, UpdateChatSessionDto } from './chat.dto';

@Injectable()
export class ChatService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly genAIService: GenAIService,
        private readonly vectorService: VectorService,
    ) {}

    async getChats(query: { [key: string]: string }, user: User) {
        const db = this.databaseService.database;

        const search = query.search || '';
        const isActive = query.isActive !== 'false';

        const chatSessionWhere = [eq(chatSessions.isActive, isActive), eq(chatSessions.userId, user.id)];
        const chatSessionOrder = [desc(chatSessions.lastMessageAt)];

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

        const { payload, createdDocuments } = await db.transaction(async tx => {
            const currMessage = body.message[body.message.length - 1];
            const chatMessage = body.message;

            const response = await this.genAIService.generateGraphResponses(user.id, uid, body.summary, chatMessage, tx);
            if (!response?.response) {
                throw new BadRequestException('Please provide more specific instructions. Thank you');
            }

            const chatSession = await tx
                .insert(chatSessions)
                .values({
                    uid: uid,
                    userId: user.id,
                    title: response?.session?.title,
                    summary: response?.session?.summary,
                    lastMessage: currMessage.message,
                    lastMessageAt: currMessage.createdAt,
                })
                .onConflictDoUpdate({
                    target: [chatSessions.uid],
                    set: {
                        summary: response?.session?.summary,
                        lastMessage: currMessage.message,
                        lastMessageAt: currMessage.createdAt,
                    },
                })
                .returning();

            const newMessages = await tx
                .insert(chatMessages)
                .values([
                    {
                        ...currMessage,
                        chatSessionId: chatSession[0].id,
                    },
                    {
                        role: 'ASSISTANT',
                        chatSessionId: chatSession[0].id,
                        message: response.response,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ])
                .returning();

            if (!newMessages?.length) {
                throw new BadRequestException('Failed to save chat messages');
            }

            return {
                // Indexed after the transaction commits so embedding never holds a connection open.
                createdDocuments: response.createdContent.filter(item => {
                    if (item.type !== 'DOCUMENT') return false;
                    const metadata = item.metadata as Partial<DocumentMetadata> | null;
                    return !!(metadata?.filePath || metadata?.fileUrl);
                }),
                payload: {
                    message: 'Chat session created successfully',
                    data: {
                        session: chatSession[0],
                        message: newMessages[1],
                        isCreatedItem: !!response.createdContent.length,
                    },
                },
            };
        });

        for (const document of createdDocuments) {
            await this.vectorService.indexDocumentItem(document);
        }

        return payload;
    }

    async deleteBulkChatSessions(body: DeleteBulkChatSessionDto, user: User) {
        const db = this.databaseService.database;

        const sessions = await db
            .select({ id: chatSessions.id })
            .from(chatSessions)
            .where(and(inArray(chatSessions.uid, body.uid), eq(chatSessions.userId, user.id), eq(chatSessions.isActive, false)));

        if (!sessions.length) {
            throw new NotFoundException('No removed chat sessions found');
        }

        const sessionIds = sessions.map(session => session.id);

        const deleted = await db.transaction(async tx => {
            await tx.delete(chatMessages).where(inArray(chatMessages.chatSessionId, sessionIds));
            return tx.delete(chatSessions).where(inArray(chatSessions.id, sessionIds)).returning({ uid: chatSessions.uid });
        });

        return { message: 'Removed chats deleted permanently', data: deleted };
    }

    async updateChatSession(uid: string, body: UpdateChatSessionDto, user: User) {
        const db = this.databaseService.database;

        const sessionData = await db.query.chatSessions.findFirst({
            where: and(eq(chatSessions.uid, uid), eq(chatSessions.userId, user.id)),
        });

        if (!sessionData) {
            throw new NotFoundException('Chat session not found');
        }

        const updatedData = await db
            .update(chatSessions)
            .set({
                ...(body.title ? { title: body.title } : {}),
                updatedAt: new Date(),
            })
            .where(and(eq(chatSessions.uid, uid), eq(chatSessions.userId, user.id)))
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
            .set({
                ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
                updatedAt: new Date(),
            })
            .where(and(inArray(chatSessions.uid, body.uid), eq(chatSessions.userId, user.id)))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update chat session');
        }

        return { message: 'Chat session updated successfully', data: updatedData };
    }
}
