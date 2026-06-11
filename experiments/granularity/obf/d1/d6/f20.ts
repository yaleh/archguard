import { v1 } from 'pkg3';
import { v2 } from 'pkg4';
import { v3 } from 'pkg5';
export interface Gx58 {
    p123: string;
    p165: number;
    p166: boolean;
    p167?: Record<string, string>;
}
export interface Mr59 {
    p168: string;
    p106: string;
}
export interface Vl60 {
    p168: string;
    p169: boolean;
    p104?: string;
    p170?: string;
}
const Ub61 = v2(new URL('s297', import.meta.url));
function Wn62(v638: string[]): string[] {
    return v638.filter((v639) => !v639.startsWith('s298'));
}
export class Pi63 {
    private p171: any[] = [];
    private p172: any[] = [];
    private p173: Array<{
        p174: Mr59;
    }> = [];
    private p175 = new Map<string, (v640: Vl60) => void>();
    private p176 = new Map<any, string>();
    private p177 = new Map<any, number>();
    private p178 = false;
    private readonly p179 = 3;
    constructor(private readonly p180: number, private readonly p181: Gx58) { }
    private m182(): any {
        const v641 = new v1(Ub61, {
            workerData: this.p181,
            execArgv: Wn62(process.execArgv),
            resourceLimits: { maxOldGenerationSizeMb: 2048 },
        });
        v641.on('p5', (v642: Vl60) => this.m186(v641, v642));
        v641.on('p170', (v643) => {
            console.error(`s299${v643.message}`);
        });
        v641.on('s300', (v644) => this.m183(v641, v644));
        this.p172.push(v641);
        return v641;
    }
    m160(): void {
        for (let v645 = 0; v645 < this.p180; v645++) {
            this.p171.push(this.m182());
        }
    }
    private m183(v646: any, v647: number): void {
        if (v647 === 0 || this.p178)
            return;
        const v648 = this.p176.get(v646);
        if (v648) {
            const v649 = this.p175.get(v648);
            if (v649) {
                this.p175.delete(v648);
                v649({ p168: v648, p169: false, p170: `s301${v647}s46` });
            }
            this.p176.delete(v646);
        }
        const v650 = this.p172.indexOf(v646);
        if (v650 !== -1)
            this.p172.splice(v650, 1);
        const v651 = this.p177.get(v646) ?? 0;
        if (v651 < this.p179) {
            console.warn(`s302${v647}s303${v651 + 1}s110${this.p179}s46`);
            const v652 = this.m182();
            this.p177.set(v652, v651 + 1);
            const v653 = this.p171.indexOf(v646);
            if (v653 !== -1)
                this.p171[v653] = v652;
        }
        else {
            console.error(`s304${this.p179}s305`);
            const v654 = this.p171.indexOf(v646);
            if (v654 !== -1)
                this.p171.splice(v654, 1);
        }
        this.p177.delete(v646);
    }
    m184(v655: Omit<Mr59, 'p168'>): Promise<Vl60> {
        const v656: Mr59 = { ...v655, p168: v3() };
        return new Promise((v657) => {
            this.p175.set(v656.p168, v657);
            this.m185(v656);
        });
    }
    private m185(v658: Mr59): void {
        const v659 = this.p172.pop();
        if (v659) {
            this.p176.set(v659, v658.p168);
            v659.postMessage(v658);
        }
        else {
            this.p173.push({ p174: v658 });
        }
    }
    private m186(v660: any, v661: Vl60): void {
        this.p176.delete(v660);
        const v662 = this.p175.get(v661.p168);
        if (v662) {
            this.p175.delete(v661.p168);
            v662(v661);
        }
        const v663 = this.p173.shift();
        if (v663) {
            this.p176.set(v660, v663.p174.p168);
            v660.postMessage(v663.p174);
        }
        else {
            this.p172.push(v660);
        }
    }
    async m187(): Promise<void> {
        this.p178 = true;
        await Promise.all(this.p171.map((v664) => v664.terminate()));
        for (const { p174: v665 } of this.p173) {
            const v666 = this.p175.get(v665.p168);
            if (v666) {
                this.p175.delete(v665.p168);
                v666({ p168: v665.p168, p169: false, p170: 's306' });
            }
        }
        this.p173 = [];
        for (const [v667, v668] of this.p175) {
            v668({ p168: v667, p169: false, p170: 's306' });
        }
        this.p175.clear();
    }
}
