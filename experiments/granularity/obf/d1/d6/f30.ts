import type { Vw210 } from '../d8/f54';
import type { Ab91, Ci92 } from './f25';
export class Ck111 {
    m76(v982: string, v983: Vw210): Ab91 {
        const v984: Ci92[] = [];
        v984.push(...this.m276(v982, v983));
        v984.push(...this.m277(v982, v983));
        v984.push(...this.m278(v983));
        v984.push(...this.m279(v982, v983));
        return {
            p72: v984.length === 0,
            p215: v984,
        };
    }
    private m276(v985: string, v986: Vw210): Ci92[] {
        const v987: Ci92[] = [];
        for (const v988 of v986.p210) {
            const v989 = new RegExp(`s439${this.m270(v988.p19)}s440`, 's441');
            if (!v989.test(v985)) {
                v987.push({
                    p1: 's385',
                    p5: `s461${v988.p19}`,
                    p216: v988.p19,
                    p217: {
                        p205: v988.p205,
                        p1: v988.p1,
                    },
                });
            }
        }
        return v987;
    }
    private m277(v990: string, v991: Vw210): Ci92[] {
        const v992: Ci92[] = [];
        for (const v993 of v991.p554) {
            const v994 = v991.p210.some((v995) => v995.p205 === v993.p22);
            const v996 = v991.p210.some((v997) => v997.p205 === v993.p473);
            if (!v994 || !v996) {
                v992.push({
                    p1: 's386',
                    p5: `s462${v993.p22}s231${v993.p473}`,
                    p217: {
                        p621: v993.p205,
                        p622: v993.p1,
                        p595: v994,
                        p596: v996,
                    },
                });
            }
        }
        return v992;
    }
    private m278(v998: Vw210): Ci92[] {
        const v999: Ci92[] = [];
        const v1000 = new Set<string>();
        const v1001 = new Set<string>();
        const v1002 = (v1003: string): boolean => {
            if (v1001.has(v1003)) {
                return true;
            }
            if (v1000.has(v1003)) {
                return false;
            }
            v1000.add(v1003);
            v1001.add(v1003);
            const v1004 = v998.p554.filter((v1005) => v1005.p22 === v1003);
            for (const v1006 of v1004) {
                if (v1002(v1006.p473)) {
                    return true;
                }
            }
            v1001.delete(v1003);
            return false;
        };
        for (const v1007 of v998.p210) {
            if (v1002(v1007.p205)) {
                v999.push({
                    p1: 's387',
                    p5: `s463${v1007.p19}`,
                    p216: v1007.p19,
                });
                break;
            }
        }
        return v999;
    }
    private m279(v1008: string, v1009: Vw210): Ci92[] {
        const v1010: Ci92[] = [];
        const v1011 = new Map<string, number>();
        for (const v1012 of v1009.p210) {
            v1011.set(v1012.p205, 0);
        }
        for (const v1013 of v1009.p554) {
            v1011.set(v1013.p22, (v1011.get(v1013.p22) ?? 0) + 1);
            v1011.set(v1013.p473, (v1011.get(v1013.p473) ?? 0) + 1);
        }
        for (const [v1014, v1015] of v1011.entries()) {
            if (v1015 === 0) {
                const v1016 = v1009.p210.find((v1017) => v1017.p205 === v1014);
                if (v1016) {
                    v1010.push({
                        p1: 's388',
                        p5: `s464${v1016.p19}`,
                        p216: v1016.p19,
                        p217: {
                            p205: v1016.p205,
                        },
                    });
                }
            }
        }
        return v1010;
    }
    private m270(v1018: string): string {
        return v1018.replace(/r90/, 's453');
    }
}
