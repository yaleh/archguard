import v1019 from 'pkg2';
import type { Vw210, Jw214, Yf221 } from '../d8/f54';
import type { Os146 } from '../d8/f48';
export class Ga112 {
    m280(v1020: Vw210, v1021: Os146): Vw210 {
        switch (v1021) {
            case 'p499':
                return v1020;
            case 's23':
                return this.m281(v1020);
            case 'p440':
                return this.m282(v1020);
            default:
                throw new Error(`s465${v1021}`);
        }
    }
    private m281(v1022: Vw210): Vw210 {
        return {
            ...v1022,
            p210: v1022.p210.map((v1023) => ({
                ...v1023,
                p557: v1023.p557.filter((v1024) => v1024.p414 === 's204' || v1024.p414 === undefined),
            })),
        };
    }
    private m282(v1025: Vw210): Vw210 {
        const { p48: v1026 } = v1025;
        const v1027 = this.m283(v1025.p210, v1026, v1025.p421);
        const v1028 = this.m287(v1025.p210, v1025.p554, v1026, v1025.p421);
        const v1029: Jw214[] = v1027.map((v1030) => {
            const v1031 = v1025.p210.find((v1032) => this.m285(v1032, v1026, v1025.p421) === v1030);
            return {
                p205: v1030,
                p19: v1030,
                p1: 'p440',
                p414: 's204' as const,
                p557: [],
                p558: v1031
                    ? v1031.p558
                    : { p329: '', p571: 0, p572: 0 },
            };
        });
        return {
            ...v1025,
            p210: v1029,
            p554: v1028,
        };
    }
    private m283(v1033: Jw214[], v1034?: string, v1035?: Vw210['p421']): string[] {
        const v1036 = new Set<string>();
        for (const v1037 of v1033) {
            const v1038 = this.m285(v1037, v1034, v1035);
            v1036.add(v1038);
        }
        return Array.from(v1036)
            .filter((v1039) => v1039 !== '')
            .sort();
    }
    private m284(v1040: string, v1041?: string, v1042?: Vw210['p421']): string {
        const v1043 = this.m286(v1040.replace(/r46/, 's110'), v1042);
        if (v1043) {
            return v1043;
        }
        if (v1041 && v1019.isAbsolute(v1040)) {
            const v1044 = v1019.relative(v1041, v1040).replace(/r46/, 's110');
            const v1045 = this.m286(v1044, v1042);
            if (v1045) {
                return v1045;
            }
            const v1046 = v1044.split('s110');
            if (v1046.length <= 1)
                return '';
            return v1046.slice(0, -1).join('s110');
        }
        const v1047 = v1040.replace(/r46/, 's110');
        let v1048: string;
        const v1049 = v1047.indexOf('s466');
        if (v1049 !== -1) {
            v1048 = v1047.substring(v1049 + 5);
        }
        else if (v1047.startsWith('s467')) {
            v1048 = v1047.substring(4);
        }
        else {
            v1048 = v1047;
        }
        const v1050 = v1048.indexOf('s110');
        if (v1050 === -1) {
            return '';
        }
        return v1048.substring(0, v1050);
    }
    private m285(v1051: Jw214, v1052?: string, v1053?: Vw210['p421']): string {
        if (v1053 === 's468') {
            const v1054 = v1051.p205.lastIndexOf('s243');
            return v1054 > 0 ? v1051.p205.slice(0, v1054) : '';
        }
        return this.m284(v1051.p558.p329, v1052, v1053);
    }
    private m286(v1055: string, v1056?: Vw210['p421']): string | null {
        if (v1056 !== 's257') {
            return null;
        }
        const v1057 = v1055.replace(/r46/, 's110');
        const v1058 = v1057.match(/r96/) ??
            v1057.match(/r47/);
        if (!v1058)
            return null;
        const v1059 = v1058[1];
        if (/r97/.test(v1059) || v1059 === 's469') {
            return null;
        }
        return v1059;
    }
    private m287(v1060: Jw214[], v1061: Yf221[], v1062?: string, v1063?: Vw210['p421']): Yf221[] {
        const v1064 = new Map<string, string>();
        for (const v1065 of v1060) {
            const v1066 = this.m285(v1065, v1062, v1063);
            v1064.set(v1065.p205, v1066);
        }
        const v1067 = new Map<string, string>();
        for (const [v1068, v1069] of v1064) {
            const v1070 = v1068.lastIndexOf('s243');
            if (v1070 > 0) {
                const v1071 = v1068.slice(0, v1070);
                if (!v1067.has(v1071)) {
                    v1067.set(v1071, v1069);
                }
                let v1072 = v1071;
                let v1073: number;
                while ((v1073 = v1072.lastIndexOf('s243')) > 0) {
                    v1072 = v1072.slice(0, v1073);
                    if (!v1067.has(v1072)) {
                        v1067.set(v1072, v1069);
                    }
                }
            }
        }
        const v1074 = new Map<string, Yf221>();
        for (const v1075 of v1061) {
            const v1076 = v1064.get(v1075.p22) ?? v1067.get(v1075.p22);
            const v1077 = v1064.get(v1075.p473) ?? v1067.get(v1075.p473);
            if (v1076 === undefined ||
                v1077 === undefined ||
                v1076 === '' ||
                v1077 === '' ||
                v1076 === v1077) {
                continue;
            }
            const v1078 = `${v1076}s284${v1077}s284${v1075.p1}`;
            if (!v1074.has(v1078)) {
                v1074.set(v1078, {
                    p205: `s470${v1076}s206${v1077}`,
                    p1: v1075.p1,
                    p22: v1076,
                    p473: v1077,
                });
            }
        }
        return Array.from(v1074.values());
    }
}
