import { v21 } from 'pkg10';
import v1257 from 'pkg11';
import v1258 from 'pkg12';
import { Xd131 } from './f43';
import type { Vw210, Jw214, Yf221 } from '../d8/f54';
import v1259 from 'pkg13';
import type { Sq127 } from './f41';
export interface Gc121 {
    p63?: number;
    p316?: boolean;
    p48?: string;
    p317?: Sq127;
}
export interface Wn122 {
    p253: Vw210;
    p318: number;
    p319: number;
    p320: number;
    p321: {
        p322: number;
        p323: number;
        p324: number;
        p325: number;
    };
}
interface Bf123 {
    p326: number;
    p327: number;
    p328: number;
}
interface We124 {
    p329: string;
    p330: number;
    p331: number;
}
interface Hn125 {
    p332: number;
    p333: number;
    p334: number;
    p318: number;
}
export class Qu126 extends v21 {
    private p63: number;
    private p316: boolean;
    private p335: ReturnType<typeof v1258>;
    private p48?: string;
    private p317?: Sq127;
    constructor(v1260: Gc121 = {}) {
        super();
        this.p63 = v1260.p63 ?? v1257.cpus().length;
        this.p316 = v1260.p316 ?? true;
        this.p48 = v1260.p48;
        this.p317 = v1260.p317;
        this.p335 = v1258(this.p63);
    }
    m336(): number {
        return this.p63;
    }
    m337(): boolean {
        return this.p316;
    }
    async m67(v1261: string[]): Promise<Vw210> {
        if (v1261.length === 0) {
            return this.m342();
        }
        this.emit('m160', { p332: v1261.length });
        const v1262 = Date.now();
        let v1263 = 0;
        let v1264 = 0;
        let v1265 = 0;
        const v1266 = await Promise.all(v1261.map((v1267) => this.p335(async () => {
            try {
                this.emit('s480', { p329: v1267 });
                const v1268 = await this.m339(v1267);
                v1263++;
                v1265++;
                this.emit('s481', {
                    p329: v1267,
                    p330: v1268.p210.length,
                    p331: v1268.p554.length,
                } as We124);
                this.emit('p108', {
                    p326: v1265,
                    p327: v1261.length,
                    p328: Math.round((v1265 / v1261.length) * 100),
                } as Bf123);
                return v1268;
            }
            catch (v1269) {
                v1264++;
                v1265++;
                this.emit('s482', {
                    p329: v1267,
                    p170: v1269 instanceof Error ? v1269.message : String(v1269),
                });
                this.emit('p108', {
                    p326: v1265,
                    p327: v1261.length,
                    p328: Math.round((v1265 / v1261.length) * 100),
                } as Bf123);
                if (!this.p316) {
                    throw v1269;
                }
                return this.m342();
            }
        })));
        const v1270 = this.m340(v1266);
        const v1271 = Date.now() - v1262;
        this.emit('s483', {
            p332: v1261.length,
            p333: v1263,
            p334: v1264,
            p318: v1271,
        } as Hn125);
        return v1270;
    }
    async m338(v1272: string[]): Promise<Wn122> {
        const v1273 = Date.now();
        const v1274 = process.memoryUsage();
        const v1275 = await this.m67(v1272);
        const v1276 = Date.now();
        const v1277 = process.memoryUsage();
        const v1278 = v1276 - v1273;
        const v1279 = v1272.length / (v1278 / 1000);
        return {
            p253: v1275,
            p318: v1278,
            p319: v1279,
            p320: v1272.length,
            p321: {
                p322: v1277.heapUsed - v1274.heapUsed,
                p323: v1277.heapTotal,
                p324: v1277.external,
                p325: v1277.rss,
            },
        };
    }
    private async m339(v1280: string): Promise<Vw210> {
        try {
            await v1259.access(v1280);
        }
        catch {
            return this.m342([v1280]);
        }
        let v1281: string;
        try {
            v1281 = await v1259.readFile(v1280, 's318');
        }
        catch {
            v1281 = '';
        }
        if (this.p317) {
            return this.p317.m344(v1280, v1281, () => {
                const v1282 = new Xd131(this.p48);
                return v1282.m66(v1281, v1280);
            });
        }
        const v1283 = new Xd131(this.p48);
        return v1283.m66(v1281, v1280);
    }
    private m340(v1284: Vw210[]): Vw210 {
        if (v1284.length === 0) {
            return this.m342();
        }
        const v1285: Jw214[] = [];
        const v1286: Yf221[] = [];
        const v1287: string[] = [];
        for (const v1288 of v1284) {
            v1285.push(...v1288.p210);
            v1286.push(...v1288.p554);
            v1287.push(...v1288.p553);
        }
        const v1289 = this.m341(v1286);
        return {
            p20: 's484',
            p421: 's485',
            p552: new Date().toISOString(),
            p553: v1287,
            p210: v1285,
            p554: v1289,
            p48: this.p48,
        };
    }
    private m341(v1290: Yf221[]): Yf221[] {
        const v1291 = new Set<string>();
        const v1292: Yf221[] = [];
        for (const v1293 of v1290) {
            const v1294 = `${v1293.p1}s284${v1293.p22}s284${v1293.p473}`;
            if (!v1291.has(v1294)) {
                v1291.add(v1294);
                v1292.push(v1293);
            }
        }
        return v1292;
    }
    private m342(v1295: string[] = []): Vw210 {
        return {
            p20: 's484',
            p421: 's485',
            p552: new Date().toISOString(),
            p553: v1295,
            p210: [],
            p554: [],
        };
    }
}
