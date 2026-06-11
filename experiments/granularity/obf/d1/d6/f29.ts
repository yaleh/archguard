import type { Pg93, Jd94 } from './f25';
export class Pt110 {
    private readonly p271 = 100;
    private readonly p272 = 200;
    private readonly p124 = 10;
    m76(v958: string): Pg93 {
        const v959: Jd94[] = [];
        v959.push(...this.m273(v958));
        v959.push(...this.m274(v958));
        v959.push(...this.m275(v958));
        const v960 = v959.filter((v961) => v961.p70 === 'p170').length === 0;
        return {
            p72: v960,
            p218: v960,
            p215: v959,
        };
    }
    private m273(v962: string): Jd94[] {
        const v963: Jd94[] = [];
        const v964 = v962.matchAll(/r85/);
        const v965 = Array.from(v964).length;
        if (v965 > this.p271) {
            v963.push({
                p1: 'p345',
                p5: `s454${v965}s455${this.p271}s46`,
                p70: 's27',
            });
        }
        const v966 = v962.matchAll(/r91/);
        const v967 = Array.from(v966).length;
        if (v967 > this.p272) {
            v963.push({
                p1: 'p345',
                p5: `s456${v967}s455${this.p272}s46`,
                p70: 's27',
            });
        }
        return v963;
    }
    private m274(v968: string): Jd94[] {
        const v969: Jd94[] = [];
        const v970 = this.m269(v968);
        if (v970 > this.p124) {
            v969.push({
                p1: 'p225',
                p5: `s457${v970}s455${this.p124}s46`,
                p70: 's27',
            });
        }
        const v971 = v968.matchAll(/r92/);
        if (Array.from(v971).length > 0) {
            v969.push({
                p1: 'p225',
                p5: 's458',
                p70: 's27',
            });
        }
        return v969;
    }
    private m275(v972: string): Jd94[] {
        const v973: Jd94[] = [];
        const v974 = v972.matchAll(/r93/);
        for (const v975 of v974) {
            if (v975[1]) {
                v973.push({
                    p1: 's389',
                    p5: `s459${v975[1].substring(0, 30)}s435`,
                    p70: 's27',
                });
            }
        }
        const v976 = v972.matchAll(/r94/);
        for (const v977 of v976) {
            if (v977[1] && /r95/.test(v977[1])) {
                v973.push({
                    p1: 's389',
                    p5: `s460${v977[1]}`,
                    p70: 'p170',
                });
            }
        }
        return v973;
    }
    private m269(v978: string): number {
        let v979 = 0;
        let v980 = 0;
        for (const v981 of v978) {
            if (v981 === 's41') {
                v980++;
                v979 = Math.max(v979, v980);
            }
            else if (v981 === 's35') {
                v980--;
            }
        }
        return v979;
    }
}
