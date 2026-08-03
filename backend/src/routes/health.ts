export type HealthStatus = {
    status: 'ok';
    service: 'xo-js-backend';
};
/** jesli wywolana, wysyla ze serwer dziala **/
export function healthRoute(): HealthStatus {
    return {
        status: 'ok',
        service: 'xo-js-backend',
    }
}