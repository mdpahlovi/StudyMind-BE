import { GenAIService } from '@/common/services/gen-ai.service';
import { SupabaseService } from '@/common/services/supabase.service';
import { DatabaseService } from '@/database/database.service';
import { User } from '@/database/schemas';
import { chatMessages, chatSessions } from '@/database/schemas/chat.schema';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike } from 'drizzle-orm';
import { RequestQueryDto } from './chat.dto';

@Injectable()
export class ChatService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly supabaseService: SupabaseService,
        private readonly genAIService: GenAIService,
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

        let chatSession = await db
            .select()
            .from(chatSessions)
            .where(and(eq(chatSessions.uid, uid), eq(chatSessions.userId, user.id)))
            .orderBy(desc(chatSessions.updatedAt));

        if (!chatSession?.length) {
            chatSession = await db
                .insert(chatSessions)
                .values({
                    uid: uid,
                    userId: user.id,
                    title: 'Unnamed Chat',
                    lastMessage: body.message,
                    lastMessageAt: new Date(),
                })
                .returning();

            await db.insert(chatMessages).values({ ...body, chatSessionId: chatSession[0].id });
        } else {
            chatSession = await db
                .update(chatSessions)
                .set({
                    lastMessage: body.message,
                    lastMessageAt: new Date(),
                })
                .where(eq(chatSessions.uid, uid))
                .returning();
        }

        const response = await this.genAIService.generateResponse(body.message);
        const genAIMessage = await db
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
                message: genAIMessage[0],
            },
        };
    }
}
