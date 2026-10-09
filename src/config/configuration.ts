export default () => ({
    nodeEnv: process.env.NODE_ENV,
    port: parseInt(process.env.PORT, 10),
    apiPrefix: process.env.API_PREFIX,
    appVersion: process.env.APP_VERSION,
    database: {
        url: process.env.DATABASE_URL,
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
    supabase: {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_ANON_KEY,
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
    },
    retrieval: {
        topK: parseInt(process.env.RETRIEVAL_TOP_K ?? '8', 10),
        minScore: parseFloat(process.env.RETRIEVAL_MIN_SCORE ?? '0.5'),
    },
    tools: process.env.STUDYMIND_TOOLS,
});
