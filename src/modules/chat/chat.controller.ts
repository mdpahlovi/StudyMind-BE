import { User } from '@/database/schemas';
import { CurrentUser } from '@/decorators/current-user.decorator';
import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestQueryDto } from './chat.dto';
import { ChatService } from './chat.service';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
    constructor(private readonly chatService: ChatService) {}

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

    @ApiOperation({ summary: 'Request a query to a chat session' })
    @Patch(':uid')
    async requestQuery(@Param('uid') uid: string, @Body() body: RequestQueryDto, @CurrentUser() user: User) {
        return this.chatService.requestQuery(uid, body, user);
    }
}
