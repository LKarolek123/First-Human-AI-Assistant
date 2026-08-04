import { createServer } from 'node:http';
import { healthRoute } from './routes/health';
import type { CreateRealtimeSessionRequest } from './contracts/realtime';
import { readJsonBody, sendJson } from './utils/http';
import {
    createRealtimeCallConfigRoute,
    createRealtimePreviewRoute
} from './routes/realtime';


const HOST = '127.0.0.1';
const PORT = 4317;

const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health'){
        const payload = healthRoute();

        response.writeHead(200, {
            'content-type': 'application/json',
        });
        response.end(JSON.stringify(payload));
        return;
    };
    if (request.method === 'POST' && request.url === '/realtime/preview') {
        try {
            const body = await readJsonBody<CreateRealtimeSessionRequest>(request);
            const payload = createRealtimePreviewRoute(body);

            sendJson(response, 200, payload);
        } catch (error) {
            sendJson(response, 400, {
                error: error instanceof Error ? error.message : 'Invalid request body!',
            })
        }

        return;
    }
    if (request.method === 'POST' && request.url === '/realtime/call-config') {
        try {
            const body = await readJsonBody<CreateRealtimeSessionRequest>(request);
            const payload = createRealtimeCallConfigRoute(body);
            sendJson(response, 200, payload);


        } catch (error) {
            sendJson(response, 400, {
                error: error instanceof Error ? error.message : 'Invalid request body!',
            })
        }
        return;
    };

    response.writeHead(404, {
        'content-type': 'application/json',
    });
    response.end(JSON.stringify({ error: 'Not found' }));    
});


server.listen(PORT, HOST, () => {
        console.log(`XO JS backend listening on http://${HOST}:${PORT}`);
});