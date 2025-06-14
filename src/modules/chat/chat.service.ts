import { SupabaseService } from '@/common/services/supabase.service';
import { DatabaseService } from '@/database/database.service';
import { Injectable } from '@nestjs/common';
import { CreateChatDto } from './chat.dto';

@Injectable()
export class ChatService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly supabaseService: SupabaseService,
    ) {}

    async createChat(createChatDto: CreateChatDto) {}

    async getChats(query: any) {}

    async getChatById(id: number) {}
}
