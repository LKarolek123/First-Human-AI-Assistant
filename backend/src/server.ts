import { createServer } from 'node:http';
import { healthRoute } from './routes/health';

const HOST = '127.0.0.1';
const PORT = 4317;

const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health'){
        const payload = healthRoute();

        response.writeHead(200, {
            'content-type': 'application/json',
        });
        response.end(JSON.stringify(payload));
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