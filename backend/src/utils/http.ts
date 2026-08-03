import type { IncomingMessage, ServerResponse } from 'node:http';

export async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString('utf8');

    if (!rawBody.trim()) {
        throw new Error('Request body is empty!');
    }

    return JSON.parse(rawBody) as T;
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown ) {
    response.writeHead(statusCode, {
        'content-type': 'application/json',
    });

    response.end(JSON.stringify(payload));
}