export default () => ({
    nodeEnv: process.env.NODE_ENV,
    port: parseInt(process.env.PORT, 10),
    apiPrefix: process.env.API_PREFIX,
    appVersion: process.env.APP_VERSION,
    database: {
        url: process.env.DATABASE_URL,
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT, 10),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        name: process.env.DB_NAME,
    },
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN,
    },
    swagger: {
        title: process.env.SWAGGER_TITLE,
        description: process.env.SWAGGER_DESCRIPTION,
        version: process.env.SWAGGER_VERSION,
    },
    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
    },
    supabase: {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_ANON_KEY,
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
    },
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        index: process.env.PINECONE_INDEX,
    },
    stable_duffusion: {
        apiKey: process.env.STABLE_DIFFUSION_API_KEY,
    },
    tools: process.env.STUDYMIND_TOOLS,
});
