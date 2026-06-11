import v1163 from 'pkg2';
import type { Vw210, Si222, Bj220, Os146, Cf223, Vm224, } from '../d8/f54';
export class Rh120 {
    m307(v1164: Vw210, v1165: Os146): Si222 {
        const { p210: v1166, p554: v1167 } = v1164;
        const v1168 = !!v1164.p555?.p506;
        const { p311: v1169, p312: v1170 } = this.m310(v1164);
        const v1171 = !v1168 && v1165 !== 'p440';
        const v1172 = v1171 ? this.m313(v1164, v1170) : undefined;
        const v1173 = v1171 ? this.m314(v1164, v1170) : undefined;
        return {
            p121: v1165,
            p330: v1166.length,
            p331: v1167.length,
            p575: this.m308(v1167),
            p576: v1169,
            p577: this.m309(v1167),
            p578: v1173,
            p460: v1172,
        };
    }
    private m308(v1174: Vw210['p554']): Partial<Record<Bj220, number>> {
        const v1175: Partial<Record<Bj220, number>> = {};
        for (const v1176 of v1174) {
            v1175[v1176.p1] = (v1175[v1176.p1] ?? 0) + 1;
        }
        return v1175;
    }
    private m309(v1177: Vw210['p554']): number {
        if (v1177.length === 0)
            return 0;
        const v1178 = v1177.filter((v1179) => v1179.p574 !== undefined && v1179.p574 !== 's479').length;
        return Math.round((v1178 / v1177.length) * 100) / 100;
    }
    private m310(v1180: Vw210): {
        p311: number;
        p312: string[][];
    } {
        const { p210: v1181, p554: v1182 } = v1180;
        if (v1181.length === 0)
            return { p311: 0, p312: [] };
        const v1183 = new Set(v1181.map((v1184) => v1184.p205));
        const v1185 = v1182.filter((v1186) => v1183.has(v1186.p22) && v1183.has(v1186.p473));
        const v1187 = new Map<string, string[]>();
        const v1188 = new Map<string, string[]>();
        for (const v1189 of v1183) {
            v1187.set(v1189, []);
            v1188.set(v1189, []);
        }
        for (const v1190 of v1185) {
            v1187.get(v1190.p22).push(v1190.p473);
            v1188.get(v1190.p473).push(v1190.p22);
        }
        const v1191 = new Set<string>();
        const v1192: string[] = [];
        for (const v1193 of v1183) {
            if (!v1191.has(v1193))
                this.m315(v1193, v1187, v1191, v1192);
        }
        const v1194 = new Set<string>();
        const v1195: string[][] = [];
        while (v1192.length > 0) {
            const v1196 = v1192.pop();
            if (!v1194.has(v1196)) {
                const v1197: string[] = [];
                this.m315(v1196, v1188, v1194, v1197);
                v1195.push(v1197);
            }
        }
        return {
            p311: v1195.length,
            p312: v1195.filter((v1198) => v1198.length > 1),
        };
    }
    private m313(v1199: Vw210, v1200: string[][]): Vm224[] {
        const { p210: v1201, p48: v1202 } = v1199;
        const v1203 = (v1204: string): string => {
            if (!v1204)
                return '';
            if (v1202 && v1163.isAbsolute(v1204)) {
                return v1163.relative(v1202, v1204).replace(/r46/, 's110');
            }
            return v1204;
        };
        const v1205 = new Map<string, string>();
        const v1206 = new Map<string, string>();
        for (const v1207 of v1201) {
            v1205.set(v1207.p205, v1203(v1207.p558?.p329 ?? ''));
            v1206.set(v1207.p205, v1207.p19);
        }
        return v1200
            .map((v1208) => ({
            p345: v1208.length,
            p557: v1208,
            p583: v1208.map((v1209) => v1206.get(v1209) ?? v1209),
            p584: [...new Set(v1208.map((v1210) => v1205.get(v1210) ?? '').filter(Boolean))],
        }))
            .sort((v1211, v1212) => v1212.p345 - v1211.p345);
    }
    private m314(v1213: Vw210, v1214: string[][]): Cf223[] {
        const { p210: v1215, p554: v1216, p48: v1217 } = v1213;
        const v1218 = (v1219: string): string => {
            if (!v1219)
                return '';
            if (v1217 && v1163.isAbsolute(v1219)) {
                return v1163.relative(v1217, v1219).replace(/r46/, 's110');
            }
            return v1219;
        };
        const v1220 = new Map<string, typeof v1215>();
        for (const v1221 of v1215) {
            const v1222 = v1218(v1221.p558?.p329 ?? '');
            if (!v1222)
                continue;
            if (!v1220.has(v1222))
                v1220.set(v1222, []);
            v1220.get(v1222).push(v1221);
        }
        const v1223 = new Set(v1215.map((v1224) => v1224.p205));
        const v1225 = new Map<string, number>();
        const v1226 = new Map<string, number>();
        for (const v1227 of v1216) {
            if (!v1223.has(v1227.p22) || !v1223.has(v1227.p473))
                continue;
            v1226.set(v1227.p22, (v1226.get(v1227.p22) ?? 0) + 1);
            v1225.set(v1227.p473, (v1225.get(v1227.p473) ?? 0) + 1);
        }
        const v1228 = new Map<string, string>();
        for (const v1229 of v1215) {
            v1228.set(v1229.p205, v1218(v1229.p558?.p329 ?? ''));
        }
        const v1230 = new Map<string, number>();
        for (const v1231 of v1214) {
            const v1232 = new Set(v1231.map((v1233) => v1228.get(v1233) ?? '').filter(Boolean));
            for (const v1234 of v1232) {
                v1230.set(v1234, (v1230.get(v1234) ?? 0) + 1);
            }
        }
        const v1235: Cf223[] = [];
        for (const [v1236, v1237] of v1220) {
            let v1238 = 0;
            let v1239 = 0;
            let v1240 = 0;
            let v1241 = 0;
            let v1242 = 0;
            for (const v1243 of v1237) {
                if (v1243.p558.p572 > v1238)
                    v1238 = v1243.p558.p572;
                for (const v1244 of v1243.p557) {
                    if (v1244.p1 === 'p499' || v1244.p1 === 's213')
                        v1239++;
                    else if (v1244.p1 === 's210' || v1244.p1 === 's476')
                        v1240++;
                }
                v1241 += v1225.get(v1243.p205) ?? 0;
                v1242 += v1226.get(v1243.p205) ?? 0;
            }
            v1235.push({
                p329: v1236,
                p579: v1238,
                p330: v1237.length,
                p469: v1239,
                p470: v1240,
                p580: v1241,
                p581: v1242,
                p582: v1230.get(v1236) ?? 0,
            });
        }
        v1235.sort((v1245, v1246) => v1246.p580 - v1245.p580 || v1246.p581 - v1245.p581);
        return v1235;
    }
    private m315(v1247: string, v1248: Map<string, string[]>, v1249: Set<string>, v1250: string[] | null): void {
        const v1251: [
            string,
            number
        ][] = [[v1247, 0]];
        v1249.add(v1247);
        while (v1251.length > 0) {
            const v1252 = v1251[v1251.length - 1];
            const [v1253, v1254] = v1252;
            const v1255 = v1248.get(v1253) ?? [];
            if (v1254 < v1255.length) {
                v1252[1]++;
                const v1256 = v1255[v1254];
                if (!v1249.has(v1256)) {
                    v1249.add(v1256);
                    v1251.push([v1256, 0]);
                }
            }
            else {
                v1251.pop();
                if (v1250 !== null)
                    v1250.push(v1253);
            }
        }
    }
}
