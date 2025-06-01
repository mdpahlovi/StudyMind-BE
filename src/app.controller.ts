import { AppService } from '@/app.service';
import { Public } from '@/decorators/public.decorator';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Root')
@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Public()
    @Get()
    @ApiOperation({ summary: 'Get application info' })
    getHello() {
        return this.appService.getHello();
    }
}
