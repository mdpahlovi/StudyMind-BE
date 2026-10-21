import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { connect } from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';

export type LibraryEvent = 'created' | 'updated';

/** Message contract consumed by the Python Tools service (StudyMind/Tools). */
export interface LibraryEventPayload {
    event: LibraryEvent;
    item: Record<string, unknown>;
    fileUrl?: string;
    occurredAt: string;
}

/** Result payload the Python Tools service publishes after conversion. */
export interface LibraryProcessedPayload {
    event: 'processed';
    itemUid: string;
    occurredAt: string;
    status: 'success' | 'failed';
    fileType: string | null;
    text: string | null;
    structured: unknown;
    meta: Record<string, unknown> | null;
    files: Record<string, string> | null;
    error: string | null;
}

const PUBLISH_TIMEOUT_MS = 5_000;
const CONSUMER_PREFETCH = 10;

@Injectable()
export class RabbitMQService implements OnModuleDestroy {
    private readonly logger = new Logger(RabbitMQService.name);
    private readonly connection: AmqpConnectionManager | null;
    private readonly channel: ChannelWrapper | null;
    private readonly consumerChannels: ChannelWrapper[] = [];

    readonly processingQueue: string;
    readonly processedQueue: string;
    readonly deadLetterQueue: string;

    constructor(config: ConfigService) {
        const url = config.get<string>('rabbitmq.url');
        if (!url) {
            this.logger.warn('RABBITMQ_URL is not set; library events will not be published');
            this.processingQueue = '';
            this.processedQueue = '';
            this.deadLetterQueue = '';
            this.connection = null;
            this.channel = null;
            return;
        }

        this.processingQueue = config.get<string>('rabbitmq.processingQueue') ?? 'library.processing';
        this.processedQueue = config.get<string>('rabbitmq.processedQueue') ?? 'library.processed';
        this.deadLetterQueue = `${this.processedQueue}.dead`;

        const safeTarget = this.describeUrl(url);
        this.connection = connect([url]);
        this.connection.on('connect', () => this.logger.log(`Connected to RabbitMQ (${safeTarget})`));
        this.connection.on('disconnect', ({ err }) =>
            this.logger.warn(`RabbitMQ disconnected: ${err?.message ?? 'unknown error'}; retrying...`),
        );

        this.channel = this.connection.createChannel({
            json: true,
            setup: (channel: Channel) => channel.assertQueue(this.processingQueue, { durable: true }),
        });
    }

    /**
     * Publishing must never fail the HTTP request, so errors and timeouts are logged instead of thrown.
     * Delivery is at-least-once: a timed-out publish may still be sent after a reconnect,
     * so consumers must be idempotent on `item.uid`.
     */
    async publishLibraryEvent(event: LibraryEvent, item: object, fileUrl?: string): Promise<void> {
        if (!this.channel) {
            return;
        }

        const payload: LibraryEventPayload = {
            event,
            item: item as Record<string, unknown>,
            fileUrl,
            occurredAt: new Date().toISOString(),
        };

        const itemUid = String((payload.item as { uid?: string }).uid);

        try {
            await this.withTimeout(
                this.channel.publish('', this.processingQueue, payload, {
                    deliveryMode: 2,
                    contentType: 'application/json',
                }),
                PUBLISH_TIMEOUT_MS,
                `Publishing "${event}" event for item ${itemUid}`,
            );
            this.logger.log(`Published "${event}" event for item ${itemUid} to "${this.processingQueue}"`);
        } catch (error) {
            this.logger.error(`Failed to publish "${event}" event for item ${itemUid}: ${(error as Error).message}`);
        }
    }

    /**
     * A handler error requeues the message once; if it fails again it is moved
     * to the dead-letter queue so it cannot loop forever.
     */
    async consumeLibraryProcessed(handler: (payload: LibraryProcessedPayload) => Promise<void> | void): Promise<void> {
        if (!this.connection || !this.processedQueue) {
            return;
        }

        const channel = this.connection.createChannel({ json: true });
        this.consumerChannels.push(channel);

        await channel.addSetup(async (setup: Channel) => {
            await setup.assertQueue(this.processedQueue, { durable: true });
            await setup.assertQueue(this.deadLetterQueue, { durable: true });
            await setup.prefetch(CONSUMER_PREFETCH);

            await setup.consume(this.processedQueue, (message: ConsumeMessage | null) => {
                if (!message) return;
                void this.handleProcessedMessage(channel, message, handler).catch((error: Error) =>
                    this.logger.error(`Unexpected error handling result message: ${error.message}`),
                );
            });
        });
    }

    private async handleProcessedMessage(
        channel: ChannelWrapper,
        message: ConsumeMessage,
        handler: (payload: LibraryProcessedPayload) => Promise<void> | void,
    ): Promise<void> {
        let payload: LibraryProcessedPayload;
        try {
            payload = JSON.parse(message.content.toString()) as LibraryProcessedPayload;
        } catch (error) {
            this.logger.error(`Discarding malformed result message: ${(error as Error).message}`);
            channel.nack(message, false, false);
            return;
        }

        try {
            await handler(payload);
            channel.ack(message);
        } catch (error) {
            const reason = (error as Error).message;

            if (message.fields.redelivered) {
                this.logger.error(
                    `Failed again to handle processed result for item ${payload.itemUid}: ${reason}; moving to "${this.deadLetterQueue}"`,
                );
                await this.deadLetter(channel, payload, reason);
                channel.ack(message);
                return;
            }

            this.logger.error(`Failed to handle processed result for item ${payload.itemUid}: ${reason}; requeueing once`);
            channel.nack(message, false, true);
        }
    }

    private async deadLetter(channel: ChannelWrapper, payload: LibraryProcessedPayload, reason: string): Promise<void> {
        try {
            await channel.sendToQueue(
                this.deadLetterQueue,
                { payload, reason, failedAt: new Date().toISOString() },
                { deliveryMode: 2, contentType: 'application/json' },
            );
        } catch (error) {
            this.logger.error(
                `Could not dead-letter result for item ${payload.itemUid}: ${(error as Error).message}; payload=${JSON.stringify(payload)}`,
            );
        }
    }

    private describeUrl(url: string): string {
        try {
            return new URL(url).host;
        } catch {
            return 'unparseable url';
        }
    }

    private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    async onModuleDestroy(): Promise<void> {
        try {
            await Promise.all(this.consumerChannels.map(c => c.close()));
            await this.channel?.close();
            await this.connection?.close();
        } catch (error) {
            this.logger.warn(`Error while closing RabbitMQ: ${(error as Error).message}`);
        }
    }
}
