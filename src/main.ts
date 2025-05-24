import { AppModule } from '@/app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as compression from 'compression';
import helmet from 'helmet';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);

    // Security
    app.use(helmet());
    app.use(compression());

    // CORS
    app.enableCors({
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        credentials: true,
    });

    // Global validation pipe
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: {
                enableImplicitConversion: true,
            },
        }),
    );

    // API versioning
    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: '1',
    });

    // Global prefix
    const apiPrefix = configService.get<string>('apiPrefix');
    app.setGlobalPrefix(apiPrefix);

    // Swagger documentation
    if (configService.get<string>('nodeEnv') !== 'production') {
        const config = new DocumentBuilder()
            .setTitle(configService.get<string>('swagger.title'))
            .setDescription(configService.get<string>('swagger.description'))
            .setVersion(configService.get<string>('swagger.version'))
            .addBearerAuth()
            .build();

        const document = SwaggerModule.createDocument(app, config);
        SwaggerModule.setup('docs', app, document);
    }

    const port = configService.get<number>('port');
    await app.listen(port);

    console.log(`🚀 Application is running on: http://localhost:${port}/${apiPrefix}`);
    console.log(`📚 API Documentation: http://localhost:${port}/docs`);
}

bootstrap();
