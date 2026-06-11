import type { Vw210 } from '../d8/f54';
export class Pw29 {
    m99(v133: Vw210): string {
        const { p210: v134, p554: v135 } = v133;
        if (!v134 || v134.length === 0) {
            return 's89';
        }
        const v136: string[] = [
            's90',
            's91',
        ];
        const v137 = (v138: string) => v138.replace(/r24/, 's44');
        for (const v139 of v134) {
            const v140 = v137(v139.p205 || v139.p19);
            const v141 = v139.p19;
            v136.push(`s92${v140}s93${v141}s94`);
        }
        const v142 = new Set(v134.map((v143) => v137(v143.p205 || v143.p19)));
        for (const v144 of v135 ?? []) {
            const v145 = v137(v144.p22);
            const v146 = v137(v144.p473);
            if (!v142.has(v145) || !v142.has(v146))
                continue;
            let v147 = 's95';
            if (v144.p1 === 's96')
                v147 = 's95';
            else if (v144.p1 === 's97')
                v147 = 's98';
            v136.push(`s92${v145}s99${v147}s99${v146}`);
        }
        return v136.join('s33');
    }
}
