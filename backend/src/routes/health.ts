export type HealthStatus = {
    status: 'ok';
    service: 'xo-js-backend';
};

export function healthRoute(): HealthStatus {
    return {
        status: 'ok',
        service: 'xo-js-backend',
    }
}