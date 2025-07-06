import { DownloadService } from '@/common/services/download.service';
import { GenAIService } from '@/common/services/gen-ai.service';
import { SupabaseService } from '@/common/services/supabase.service';
import { DatabaseService } from '@/database/database.service';
import { User } from '@/database/schemas';
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

    async getChats(query: { [key: string]: string }, user: User) {
        const db = this.databaseService.database;

        const search = query.search || '';

        const chatSessionWhere = [eq(chatSessions.isActive, true), eq(chatSessions.userId, user.id)];
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

        return await db.transaction(async tx => {
            const currMessage = body.message[body.message.length - 1];
            const chatMessage = body.message;

            const response = await this.genAIService.generateGraphResponses(user.id, uid, chatMessage, tx);
            if (!response?.response) {
                throw new BadRequestException('Please provide more specific instructions. Thank you');
            }

            // Create or update chat session
            const chatSession = await tx
                .insert(chatSessions)
                .values({
                    uid: uid,
                    userId: user.id,
                    title: response?.session?.title,
                    summary: response?.session?.description,
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
                    },
                ])
                .returning();

            if (newMessages?.length) {
                return {
                    message: 'Chat session created successfully',
                    data: {
                        session: chatSession[0],
                        message: newMessages[1],
                        isCreatedItem: !!response.createdContent.length,
                    },
                };
            }
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async updateChatSession(uid: string, body: UpdateChatSessionDto, user: User) {
        const db = this.databaseService.database;

        const [doesChatSessionsExist] = await db.select().from(chatSessions).where(eq(chatSessions.uid, uid));

        if (!doesChatSessionsExist) {
            throw new NotFoundException('Chat session not found');
        }

        const updatedData = await db
            .update(chatSessions)
            .set({
                ...(body.title ? { title: body.title } : {}),
                updatedAt: new Date(),
            })
            .where(eq(chatSessions.uid, uid))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update chat session');
        }

        return { message: 'Chat session updated successfully', data: updatedData[0] };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async updateBulkChatSession(body: UpdateBulkChatSessionDto, user: User) {
        const db = this.databaseService.database;

        const updatedData = await db
            .update(chatSessions)
            .set({
                ...(body.isActive ? { isActive: body.isActive } : {}),
                updatedAt: new Date(),
            })
            .where(inArray(chatSessions.uid, body.uid))
            .returning();

        if (!updatedData[0] || !updatedData[0]?.uid) {
            throw new BadRequestException('Failed to update chat session');
        }

        return { message: 'Chat session updated successfully', data: updatedData };
    }
}
