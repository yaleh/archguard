import type { Vw210 } from '../d8/f54';
import type { Xn95, Al96, If97 } from './f25';
export class Vs109 {
    m76(v884: string, v885: Vw210): Xn95 {
        const v886 = this.m260(v884, v885);
        const v887 = this.m266(v884, v885, v886);
        const v888 = this.m267(v886);
        return {
            p72: v888 >= 60,
            p219: v888,
            p220: v886,
            p221: v887,
        };
    }
    private m260(v889: string, v890: Vw210): Al96 {
        return {
            p222: this.m261(v889, v890),
            p223: this.m263(v889, v890),
            p224: this.m264(v889),
            p225: this.m265(v889, v890),
        };
    }
    private m261(v891: string, v892: Vw210): number {
        let v893 = 100;
        const v894 = v891.split('s33');
        const v895 = v894.filter((v896) => v896.length > 100);
        v893 -= v895.length * 2;
        const v897 = this.m269(v891);
        v893 -= (v897 - 3) * 5;
        const v898 = v894.every((v899, v900) => {
            if (v899.trim().length === 0)
                return true;
            const v901 = this.m268(v899, v894, v900);
            const v902 = v899.search(/r84/);
            return Math.abs(v902 - v901) <= 2;
        });
        if (v898) {
            v893 += 5;
        }
        return Math.max(0, Math.min(100, v893));
    }
    private m262(v903: string): string {
        let v904 = v903.replace(/r29/, '');
        v904 = v904.replace(/r30/, 's44');
        return v904;
    }
    private m263(v905: string, v906: Vw210): number {
        let v907 = 0;
        for (const v908 of v906.p210) {
            const v909 = new RegExp(`s439${this.m270(v908.p19)}s440`, 's441');
            if (v909.test(v905)) {
                v907++;
            }
        }
        const v910 = v906.p210.length > 0 ? (v907 / v906.p210.length) * 100 : 100;
        let v911 = 0;
        for (const v912 of v906.p554) {
            const v913 = this.m262(v912.p22);
            const v914 = this.m262(v912.p473);
            const v915 = new RegExp(`s440${this.m270(v913)}s440`);
            const v916 = new RegExp(`s440${this.m270(v914)}s440`);
            if (v915.test(v905) && v916.test(v905)) {
                v911++;
            }
        }
        const v917 = v906.p554.length > 0 ? (v911 / v906.p554.length) * 100 : 100;
        return Math.round((v910 + v917) / 2);
    }
    private m264(v918: string): number {
        let v919 = 100;
        const v920 = Array.from(v918.matchAll(/r85/));
        const v921 = v920.map((v922) => v922[1] ?? '').filter(Boolean);
        const v923 = /r86/;
        const v924 = v921.filter((v925) => v925 && !v923.test(v925));
        v919 -= v924.length * 5;
        const v926 = Array.from(v918.matchAll(/r87/));
        const v927 = v926.filter((v928) => v928[1] !== undefined).length;
        const v929 = v926.length;
        if (v929 > 0) {
            const v930 = (v927 / v929) * 100;
            if (v930 < 80) {
                v919 -= 10;
            }
        }
        return Math.max(0, Math.min(100, v919));
    }
    private m265(v931: string, v932: Vw210): number {
        let v933 = 100;
        const v934 = v932.p210.length;
        v933 -= Math.max(0, (v934 - 20) * 2);
        const v935 = v932.p554.length;
        v933 -= Math.max(0, (v935 - 30) * 2);
        const v936 = new Map<string, number>();
        for (const v937 of v932.p554) {
            v936.set(v937.p22, (v936.get(v937.p22) ?? 0) + 1);
            v936.set(v937.p473, (v936.get(v937.p473) ?? 0) + 1);
        }
        for (const [v938, v939] of v936) {
            if (v939 > 10) {
                v933 -= (v939 - 10) * 2;
            }
        }
        return Math.max(0, Math.min(100, v933));
    }
    private m266(v940: string, v941: Vw210, v942: Al96): If97[] {
        const v943: If97[] = [];
        if (v942.p222 < 70) {
            v943.push({
                p1: 'p209',
                p5: 's442',
                p226: 's134',
                p227: 's443',
            });
        }
        if (v942.p223 < 80) {
            v943.push({
                p1: 's391',
                p5: 's444',
                p226: 's393',
                p227: 's445',
            });
        }
        if (v942.p224 < 70) {
            v943.push({
                p1: 's392',
                p5: 's446',
                p226: 's394',
                p227: 's447',
            });
        }
        if (v942.p225 < 60) {
            v943.push({
                p1: 'p122',
                p5: 's448',
                p226: 's393',
                p227: 's449',
            });
        }
        const v944 = Array.from(v940.matchAll(/r85/));
        if (v944.length > 30) {
            v943.push({
                p1: 'p209',
                p5: 's450',
                p226: 's393',
                p227: 's451',
            });
        }
        return v943;
    }
    private m267(v945: Al96): number {
        return Math.round(v945.p222 * 0.25 +
            v945.p223 * 0.35 +
            v945.p224 * 0.2 +
            v945.p225 * 0.2);
    }
    private m268(v946: string, v947: string[], v948: number): number {
        const v949 = v946.trim();
        if (v949.startsWith('s35') || v949.startsWith('s452')) {
            let v950 = 0;
            for (let v951 = 0; v951 < v948; v951++) {
                const v952 = v947[v951];
                if (v952) {
                    v950 += (v952.match(/r88/) || []).length;
                    v950 -= (v952.match(/r89/) || []).length;
                }
            }
            return Math.max(0, v950 * 2);
        }
        return 0;
    }
    private m269(v953: string): number {
        let v954 = 0;
        let v955 = 0;
        for (const v956 of v953) {
            if (v956 === 's41') {
                v955++;
                v954 = Math.max(v954, v955);
            }
            else if (v956 === 's35') {
                v955--;
            }
        }
        return v954;
    }
    private m270(v957: string): string {
        return v957.replace(/r90/, 's453');
    }
}
