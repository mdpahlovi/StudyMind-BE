import { type User } from '@/database/schemas';
import { CurrentUser } from '@/decorators/current-user.decorator';
import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestQueryDto, UpdateBulkChatSessionDto, UpdateChatSessionDto } from './chat.dto';
import { ChatService } from './chat.service';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
    constructor(private readonly chatService: ChatService) {}

    @ApiOperation({ summary: 'Get all chat sessions' })
    @Get()
    async getChats(@Query() query: { [key: string]: string }, @CurrentUser() user: User) {
        return this.chatService.getChats(query, user);
    }

    @ApiOperation({ summary: 'Get a chat messages by session uid' })
    @Get(':uid')
    async getOneChat(@Param('uid') uid: string, @CurrentUser() user: User) {
        return this.chatService.getOneChat(uid, user);
    }

    @ApiOperation({ summary: 'Update bulk library items' })
    @Patch('update/bulk')
    async updateBulkLibraryItems(@Body() body: UpdateBulkChatSessionDto, @CurrentUser() user: User) {
        return this.chatService.updateBulkChatSession(body, user);
    }

    @ApiOperation({ summary: 'Update a library item' })
    @Patch('update/:uid')
    async updateLibraryItem(@Param('uid') uid: string, @Body() body: UpdateChatSessionDto, @CurrentUser() user: User) {
        return this.chatService.updateChatSession(uid, body, user);
    }

    @ApiOperation({ summary: 'Request a query to a chat session' })
    @Patch(':uid')
    async requestQuery(@Param('uid') uid: string, @Body() body: RequestQueryDto, @CurrentUser() user: User) {
        return this.chatService.requestQuery(uid, body, user);
    }
}
