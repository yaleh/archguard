import type { Vw210 } from '../d8/f54';
import type { Hy98 } from './f25';
import { Cq108 } from './f27';
import { Ck111 } from './f30';
import { Pt110 } from './f29';
import { Vs109 } from './f28';
export class Gt107 {
    private p77: Cq108;
    private p246: Ck111;
    private p247: Pt110;
    private p248: Vs109;
    constructor(v838?: any) {
        this.p77 = new Cq108();
        this.p246 = new Ck111();
        this.p247 = new Pt110();
        this.p248 = new Vs109();
    }
    async m76(v839: string, v840: Vw210): Promise<Hy98> {
        const v841 = await this.p77.m76(v839);
        const v842 = this.p246.m76(v839, v840);
        const v843 = this.p247.m76(v839);
        const v844 = this.p248.m76(v839, v840);
        const v845 = this.m249({
            p228: v841,
            p229: v842,
            m184: v843,
            p230: v844,
        });
        return {
            p228: v841,
            p229: v842,
            m184: v843,
            p230: v844,
            p231: v845,
        };
    }
    private m249(v846: {
        p228: {
            p72: boolean;
        };
        p229: {
            p72: boolean;
        };
        m184: {
            p72: boolean;
            p218: boolean;
        };
        p230: {
            p72: boolean;
        };
    }): Hy98['p231'] {
        const v847: string[] = [];
        if (!v846.p228.p72) {
            v847.push('s396');
        }
        if (!v846.m184.p218) {
            v847.push('s397');
        }
        const v848 = v846.p228.p72 && v846.m184.p218;
        return {
            p72: v848 && v846.p229.p72 && v846.p230.p72,
            p232: v848,
            p233: v847,
        };
    }
    async m250(v849: string, v850: Vw210): Promise<{
        p251: boolean;
        p252: Array<{
            p19: string;
            p253: any;
        }>;
    }> {
        const v851 = await this.p77.m76(v849);
        const v852 = this.p246.m76(v849, v850);
        const v853 = this.p247.m76(v849);
        const v854 = this.p248.m76(v849, v850);
        const v855 = this.m249({
            p228: v851,
            p229: v852,
            m184: v853,
            p230: v854,
        });
        return {
            p251: v855.p232,
            p252: [
                { p19: 'p228', p253: v851 },
                { p19: 'p229', p253: v852 },
                { p19: 'm184', p253: v853 },
                { p19: 'p230', p253: v854 },
            ],
        };
    }
    m254(): Cq108 {
        return this.p77;
    }
    m255(v856: {
        p251: boolean;
        p252: Array<{
            p19: string;
            p253: any;
        }>;
    }): string {
        const v857: string[] = [];
        if (v856.p251) {
            v857.push('s398');
        }
        else {
            v857.push('s399');
        }
        for (const v858 of v856.p252) {
            v857.push(`s400${v858.p19.charAt(0).toUpperCase() + v858.p19.slice(1)}s401`);
            if (v858.p19 === 'p228') {
                v857.push(`s402${v858.p253.x29 ? 's403' : 's404'}`);
                if (v858.p253.x3 && v858.p253.x3.x16 > 0) {
                    v857.push(`s405${v858.p253.x3.x16}s406`);
                    for (const v859 of v858.p253.x3.x17(0, 10)) {
                        v857.push(`s230${v859.x4}${v859.x5 ? `s407${v859.x5}s46` : ''}`);
                    }
                    if (v858.p253.x3.x16 > 10) {
                        v857.push(`s136${v858.p253.x3.x16 - 10}s408`);
                    }
                }
            }
            else if (v858.p19 === 'p229') {
                v857.push(`s402${v858.p253.x29 ? 's403' : 's404'}`);
                if (v858.p253.x30 && v858.p253.x30.x16 > 0) {
                    v857.push(`s409${v858.p253.x30.x16}s406`);
                    for (const v860 of v858.p253.x30.x17(0, 5)) {
                        v857.push(`s133${v860.x31}s135${v860.x4}`);
                    }
                    if (v858.p253.x30.x16 > 5) {
                        v857.push(`s136${v858.p253.x30.x16 - 5}s410`);
                    }
                }
            }
            else if (v858.p19 === 'm184') {
                v857.push(`s411${v858.p253.x32 ? 's412' : 's413'}`);
                if (v858.p253.x30 && v858.p253.x30.x16 > 0) {
                    v857.push(`s409${v858.p253.x30.x16}s406`);
                    for (const v861 of v858.p253.x30) {
                        v857.push(`s133${v861.x33}s135${v861.x4}`);
                    }
                }
            }
            else if (v858.p19 === 'p230') {
                v857.push(`s414${v858.p253.x9?.x8(1) || 's126'}s127`);
                if (v858.p253.x15 && v858.p253.x15.x16 > 0) {
                    v857.push(`s415${v858.p253.x15.x16}s406`);
                    for (const v862 of v858.p253.x15.x17(0, 3)) {
                        v857.push(`s133${v862.x18}s135${v862.x4}`);
                    }
                }
            }
            v857.push('');
        }
        return v857.join('s33');
    }
    m256(v863: Hy98): string {
        const v864: string[] = [];
        if (v863.p231.p72) {
            v864.push('s123');
        }
        else {
            v864.push('s115');
        }
        v864.push(`s416${v863.p228.p72 ? 's403' : 's404'}`);
        if (v863.p228.p73.length > 0) {
            v864.push(`s417${v863.p228.p73.length}`);
        }
        v864.push(`s418${v863.p229.p72 ? 's403' : 's404'}`);
        if (v863.p229.p215.length > 0) {
            v864.push(`s419${v863.p229.p215.length}`);
        }
        v864.push(`s420${v863.m184.p218 ? 's421' : 's422'}`);
        if (v863.m184.p215.length > 0) {
            v864.push(`s419${v863.m184.p215.length}`);
        }
        v864.push(`s423${v863.p230.p219}s127`);
        if (v863.p230.p221.length > 0) {
            v864.push(`s424${v863.p230.p221.length}`);
        }
        if (v863.p231.p233.length > 0) {
            v864.push('s425');
            v863.p231.p233.forEach((v865) => {
                v864.push(`s230${v865}`);
            });
        }
        return v864.join('s33');
    }
}
