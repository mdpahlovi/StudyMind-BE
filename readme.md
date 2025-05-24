# StudyMind Backend

A production-ready NestJS application with Drizzle ORM, PostgreSQL, TypeScript, ESLint, and Prettier configured with a modular architecture.

## Features

- 🚀 **NestJS** - Progressive Node.js framework
- 🗃️ **Drizzle ORM** - Modern TypeScript ORM
- 🐘 **PostgreSQL** - Robust relational database
- 🔧 **TypeScript** - Type-safe development
- 📏 **ESLint & Prettier** - Code linting and formatting
- 🔐 **JWT Authentication** - Secure user authentication
- 📚 **Swagger/OpenAPI** - API documentation
- 🏗️ **Modular Architecture** - Clean and scalable code structure
- ✅ **Validation** - Request validation with class-validator
- 🛡️ **Security** - Helmet, CORS, and other security features
- 🐳 **Docker** - Containerized database setup

## Project Structure

```
src/
├── app.module.ts              # Root application module
├── main.ts                    # Application entry point
├── config/
│   └── configuration.ts       # Configuration management
├── common/
│   ├── common.module.ts
│   ├── services/
│   │   └── hash.service.ts    # Password hashing service
│   └── interceptors/
│       └── response.interceptor.ts
├── database/
│   ├── database.module.ts     # Database connection module
│   └── schemas/
│       ├── index.ts
│       └── user.schema.ts     # User database schema
└── modules/
    ├── auth/
    │   ├── auth.module.ts
    │   ├── auth.service.ts
    │   ├── auth.controller.ts
    │   ├── dto/
    │   ├── guards/
    │   └── strategies/
    ├── users/
    │   ├── users.module.ts
    │   ├── users.service.ts
    │   ├── users.controller.ts
    │   └── dto/
    └── health/
        ├── health.module.ts
        ├── health.service.ts
        └── health.controller.ts
```
