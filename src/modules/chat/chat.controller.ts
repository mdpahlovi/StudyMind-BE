import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateChatDto } from './chat.dto';
import { ChatService } from './chat.service';
import { CurrentUser } from '@/decorators/current-user.decorator';
import { User } from '@/database/schemas';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
    constructor(private readonly chatService: ChatService) {}

    @ApiOperation({ summary: 'Create a new chat' })
    @Post()
    async createChat(@Body() createChatDto: CreateChatDto) {
        return this.chatService.createChat(createChatDto);
    }

    @ApiOperation({ summary: 'Get all chat sessions' })
    @Get()
    async getChats(@Query() query: any, @CurrentUser() user: User) {
        return this.chatService.getChats(query, user);
    }

    @ApiOperation({ summary: 'Get a chat messages by session uid' })
    @Get(':uid')
    async getOneChat(@Param('uid') uid: string, @CurrentUser() user: User) {
        return this.chatService.getOneChat(uid, user);
    }
}
