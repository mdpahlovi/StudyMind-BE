export default () => ({
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 4000,
    apiPrefix: process.env.API_PREFIX || 'api/v1',
    database: {
        url: process.env.DATABASE_URL,
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        name: process.env.DB_NAME || 'studymind',
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'default-secret',
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },
    swagger: {
        title: process.env.SWAGGER_TITLE || 'StudyMind API',
        description: process.env.SWAGGER_DESCRIPTION || 'API documentation for StudyMind application',
        version: process.env.SWAGGER_VERSION || '1.0',
    },
});
