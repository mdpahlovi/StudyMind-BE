import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateChatDto } from './chat.dto';
import { ChatService } from './chat.service';

@Controller('chats')
export class ChatController {
    constructor(private readonly chatService: ChatService) {}

    @Post()
    async createChat(@Body() createChatDto: CreateChatDto) {
        return this.chatService.createChat(createChatDto);
    }

    @Get()
    async getChats(@Query() query: any) {
        return this.chatService.getChats(query);
    }

    @Get(':id')
    async getChatById(@Param('id') id: number) {
        return this.chatService.getChatById(id);
    }
}
