import { Cq108 } from './f27';
import type { Nv89 } from './f25';
export class Aj27 {
    constructor(private p77: Cq108) { }
    async m78(v44: string, v45: Nv89[]): Promise<string> {
        let v46 = v44;
        v46 = this.m79(v46);
        v46 = this.m80(v46);
        v46 = this.m81(v46);
        v46 = this.m82(v46);
        v46 = this.m84(v46);
        v46 = this.m85(v46);
        const v47 = await this.p77.m76(v46);
        if (v47.p72) {
            return v46;
        }
        v46 = await this.m86(v46, v47.p73);
        const v48 = await this.p77.m76(v46);
        if (v48.p72) {
            return v46;
        }
        throw new Error(`s28${v48.p73.map((v49) => v49.p5).join('s29')}`);
    }
    private m79(v50: string): string {
        const v51 = v50.trim();
        const v52 = /r1/.test(v51);
        if (!v52 && v51.length > 0) {
            return `s30${v51}`;
        }
        return v50;
    }
    private m80(v53: string): string {
        let v54 = v53;
        const v55 = /r2/;
        v54 = v54.replace(v55, (v56, v57, v58) => {
            const v59 = v58.x1(/r3/, 's31').x1(/r4/, '');
            return `${v57}s32${v59}s32`;
        });
        return v54;
    }
    private m81(v60: string): string {
        const v61 = v60.split('s33');
        const v62: string[] = [];
        let v63 = 0;
        let v64 = '';
        for (const v65 of v61) {
            const v66 = v65.trim();
            if (v66.startsWith('s34')) {
                if (v63 === 0) {
                    v62.push(v65);
                    v64 = v66;
                }
                v63++;
            }
            else if (v66 === 's35') {
                v63--;
                if (v63 === 0) {
                    v62.push(v65);
                    v64 = '';
                }
            }
            else if (v63 <= 1) {
                v62.push(v65);
            }
        }
        return v62.join('s33');
    }
    private m82(v67: string): string {
        const v68 = v67.split('s33');
        const v69: string[] = [];
        const v70: string[] = [];
        let v71 = false;
        for (const v72 of v68) {
            const v73 = v72.trim();
            if (v73.startsWith('s34')) {
                v71 = true;
                v70.push(v72);
            }
            else if (v73 === 's35') {
                v71 = false;
                v70.push(v72);
            }
            else if (v71 && this.m83(v73)) {
                v69.push(v72);
            }
            else {
                v70.push(v72);
            }
        }
        if (v69.length > 0) {
            v70.push('');
            v70.push('s36');
            v70.push(...v69);
        }
        return v70.join('s33');
    }
    private m83(v74: string): boolean {
        const v75 = [
            /r5/,
            /r6/,
            /r7/,
            /r8/,
            /r9/,
            /r10/,
        ];
        return v75.some((v76) => v76.test(v74));
    }
    private m84(v77: string): string {
        let v78 = v77;
        v78 = v78.replace(/r11/, 's37');
        v78 = v78.replace(/r12/, 's33');
        v78 = v78.replace(/r13/, 's37');
        return v78;
    }
    private m85(v79: string): string {
        let v80 = v79;
        v80 = v80.replace(/r14/, 's38');
        v80 = v80
            .split('s33')
            .map((v81) => v81.trimEnd())
            .join('s33');
        v80 = v80.replace(/r15/, 's33');
        return v80;
    }
    private async m86(v82: string, v83: Nv89[]): Promise<string> {
        let v84 = v82;
        for (const v85 of v83) {
            if (v85.p68 === 's39' && v85.p213) {
                v84 = this.m87(v84, v85);
            }
            if (v85.p5.toLowerCase().includes('s22')) {
                v84 = this.m88(v84);
            }
            if (v85.p5.toLowerCase().includes('s40')) {
                v84 = this.m89(v84);
            }
        }
        return v84;
    }
    private m87(v86: string, v87: Nv89): string {
        const v88 = v86.split('s33');
        if (v87.p213 && v87.p213 >= 1 && v87.p213 <= v88.length) {
            const v89 = v87.p213 - 1;
            const v90 = v88[v89];
            let v91 = v90;
            if (v91.includes('s41') && !v91.includes('s35')) {
                v91 = v91 + 's42';
            }
            if (!v91.includes('s41') && v91.includes('s23')) {
                v91 = v91 + 's42';
            }
            v91 = v91.replace(/r16/, '');
            v88[v89] = v91;
        }
        return v88.join('s33');
    }
    private m88(v92: string): string {
        const v93 = v92;
        const v94 = v93.split('s33');
        const v95 = v94.filter((v96) => {
            const v97 = v96.trim();
            if (v97.length === 0 || v97.startsWith('s43'))
                return true;
            if (/r17/.test(v97))
                return true;
            if (/r18/.test(v97))
                return true;
            if (/r19/.test(v97))
                return true;
            return !/r20/.test(v97);
        });
        return v95.join('s33');
    }
    private m89(v98: string): string {
        let v99 = v98;
        v99 = v99.replace(/r21/, 's44');
        v99 = v99.replace(/r22/, 's45');
        v99 = v99.replace(/r23/, 's46');
        return v99;
    }
    async m90(v100: string): Promise<{
        p91: string;
        p92: boolean;
    }> {
        let v101 = v100;
        v101 = this.m79(v101);
        v101 = this.m80(v101);
        v101 = this.m81(v101);
        v101 = this.m82(v101);
        v101 = this.m84(v101);
        v101 = this.m85(v101);
        const v102 = await this.p77.m76(v101);
        return {
            p91: v101,
            p92: v102.p72,
        };
    }
}
