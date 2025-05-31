import { HashService } from '@/common/services/hash.service';
import { DatabaseService } from '@/database/database.service';
import { CreateUser, User, users } from '@/database/schemas/user.schema';
import { LoginUserDto, RegisterUserDto } from '@/modules/auth/auth.dto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';

export interface OAuthUserProfile {
    name: string;
    email: string;
    picture: string;
}

@Injectable()
export class AuthService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly hashService: HashService,
        private readonly jwtService: JwtService,
    ) {}

    async login(loginUserDto: LoginUserDto) {
        const { email, password } = loginUserDto;
        const db = this.databaseService.database;
        const [user] = await db.select().from(users).where(eq(users.email, email));

        // If user does not exist, throw error
        if (!user) {
            throw new NotFoundException('Please check your credentials');
        }

        // If user has no password, throw error
        if (!user.password) {
            if (user.provider !== 'CREDENTIAL') {
                throw new BadRequestException(`Please use ${user.provider.toLowerCase()} to login`);
            } else {
                throw new BadRequestException('Please reset your password');
            }
        }

        // If password does not match, throw error
        if (!(await this.hashService.compare(password, user.password))) {
            throw new NotFoundException('Please check your credentials');
        }

        delete user.password;
        return {
            message: 'User logged in successfully',
            data: {
                user,
                accessToken: this.jwtService.sign(user, { expiresIn: '1h' }),
                refreshToken: this.jwtService.sign(user, { expiresIn: '7d' }),
            },
        };
    }

    async register(registerUserDto: RegisterUserDto) {
        const { name, email, password } = registerUserDto;
        const db = this.databaseService.database;

        const [existingUser] = await db.select().from(users).where(eq(users.email, email));

        // If user already exists, throw error
        if (existingUser) {
            throw new BadRequestException(`An account already exists with '${email}'. Please login.`);
        }

        const hashedPassword = await this.hashService.hash(password);

        const createUserPayload: CreateUser = {
            isActive: true,
            name,
            email,
            password: hashedPassword,
            provider: 'CREDENTIAL',
        };

        const [createdUser] = await db.insert(users).values(createUserPayload).returning();

        delete createdUser.password;
        return {
            message: 'User registered successfully',
            data: {
                user: createdUser,
                accessToken: this.jwtService.sign(createdUser, { expiresIn: '1h' }),
                refreshToken: this.jwtService.sign(createdUser, { expiresIn: '7d' }),
            },
        };
    }

    async validateOAuthLogin(profile: OAuthUserProfile, provider: 'GOOGLE' | 'FACEBOOK') {
        const db = this.databaseService.database;
        const [user] = await db.select().from(users).where(eq(users.email, profile.email));

        if (user) {
            const updateUserPayload = {
                name: profile.name,
                photo: profile.picture,
                provider: provider,
            };

            const [updatedUser] = await db.update(users).set(updateUserPayload).where(eq(users.uid, user.uid)).returning();
            return updatedUser;
        } else {
            const createUserPayload = {
                isActive: true,
                name: profile.name,
                email: profile.email,
                photo: profile.picture,
                provider: provider,
                password: null,
            };

            const [createdUser] = await db.insert(users).values(createUserPayload).returning();
            return createdUser;
        }
    }

    async loginOAuth(user: User) {
        delete user.password;
        return {
            message: 'User logged in successfully',
            data: {
                user,
                accessToken: this.jwtService.sign(user, { expiresIn: '1h' }),
                refreshToken: this.jwtService.sign(user, { expiresIn: '7d' }),
            },
        };
    }
}
