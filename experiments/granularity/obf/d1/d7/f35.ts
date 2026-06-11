export class Tw116 extends Error {
    constructor(v1128: string, public readonly p27: string, public readonly p213?: number, public readonly p214?: number) {
        super(v1128);
        this.name = 's475';
        Error.captureStackTrace(this, this.constructor);
    }
}
