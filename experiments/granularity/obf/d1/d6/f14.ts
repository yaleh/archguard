import type { Vw210 } from '../d8/f54';
import { Rx34 } from './f11';
export function Rx48(v259: Vw210, v260: boolean): void {
    const v261 = new Set(v259.p210.map((v262) => v262.p205));
    const v263: string[] = [];
    for (const v264 of v259.p554) {
        const v265 = v261.has(v264.p22);
        const v266 = v261.has(v264.p473);
        if (!v265 || !v266) {
            const v267 = !v265 && Rx34(v264.p22);
            const v268 = !v266 && Rx34(v264.p473);
            if (!v267 || !v268) {
                const v269: string[] = [];
                if (!v265 && !v267)
                    v269.push(`s228${v264.p22}`);
                if (!v266 && !v268)
                    v269.push(`s229${v264.p473}`);
                if (v269.length > 0) {
                    v263.push(`s230${v264.p22}s231${v264.p473}s62${v269.join('s29')}s46`);
                }
            }
        }
    }
    if (v263.length > 0) {
        console.warn(`s232${v263.length}s233`);
        console.warn(v263.join('s33'));
    }
    if (v260) {
        const v270 = v259.p554.filter((v271) => (!v261.has(v271.p22) && Rx34(v271.p22)) ||
            (!v261.has(v271.p473) && Rx34(v271.p473))).length;
        if (v270 > 0) {
            console.debug(`s234${v270}s235`);
        }
    }
    for (const v272 of v259.p210) {
        if (v272.p19.includes('s33') || v272.p19.includes('s223')) {
            throw new Error(`s236${v272.p19}`);
        }
    }
}
