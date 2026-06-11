import { v27 } from 'pkg15';
export const Wt178 = 's484' as const;
export interface Fz179 {
    p509?: string[];
    p510?: string[];
    p511?: string[];
    p512?: string[];
    p201?: Record<string, string>;
    p513?: number;
}
export interface Iv180 {
    p20: typeof Wt178;
    p509: string[];
    p510: string[];
    p511: string[];
    p512: string[];
    p201?: Record<string, string>;
    p513?: number;
    p474: number;
    p514?: string;
    p515?: string;
}
function Jo181(v1464: string): boolean {
    return v1464.includes('s272') || v1464.includes('s487') || v1464.startsWith('s110');
}
const Zh182 = v27.x89().x88((v1465, v1466) => {
    if (Jo181(v1465)) {
        v1466.x90({
            p68: v27.x92.x91,
            p5: 's549',
        });
    }
});
export const Ne183 = v27
    .x94({
    p509: v27.x96(Zh182).x95(),
    p510: v27.x96(Zh182).x95(),
    p511: v27.x96(Zh182).x95(),
    p512: v27.x96(Zh182).x95(),
    p201: v27.x97(Zh182, v27.x89()).x95(),
    p513: v27.x101().x100().x99(1).x98(5).x95(),
})
    .x93();
export const Kj184 = v27.x94({
    p20: v27.x102(Wt178),
    p509: v27.x96(v27.x89()),
    p510: v27.x96(v27.x89()),
    p511: v27.x96(v27.x89()),
    p512: v27.x96(v27.x89()),
    p201: v27.x97(v27.x89(), v27.x89()).x95(),
    p513: v27.x101().x100().x99(1).x98(5).x95(),
    p474: v27.x101().x99(0).x98(1),
    p514: v27.x89().x95(),
    p515: v27.x89().x95(),
});
export const Aa185 = Ne183;
type Wg186 = Fz179 | Partial<Iv180> | undefined;
function Vy187(v1467?: string[]): string[] | undefined {
    if (!v1467)
        return undefined;
    return v1467.filter((v1468) => !Jo181(v1468));
}
function Ry188(v1469?: Record<string, string>): Record<string, string> | undefined {
    if (!v1469)
        return undefined;
    const v1470 = Object.entries(v1469).reduce<Record<string, string>>((v1471, [v1472, v1473]) => {
        if (!Jo181(v1472)) {
            v1471[v1472] = v1473;
        }
        return v1471;
    }, {});
    return Object.keys(v1470).length > 0 ? v1470 : undefined;
}
export function Eg189(v1474: Iv180): Iv180 {
    return {
        ...v1474,
        p509: Vy187(v1474.p509) ?? [],
        p510: Vy187(v1474.p510) ?? [],
        p511: Vy187(v1474.p511) ?? [],
        p512: Vy187(v1474.p512) ?? [],
        p201: Ry188(v1474.p201),
    };
}
function Oa190(v1475?: Wg186): Partial<Iv180> {
    if (!v1475)
        return {};
    return {
        ...v1475,
        p509: Vy187(v1475.p509),
        p510: Vy187(v1475.p510),
        p511: Vy187(v1475.p511),
        p512: Vy187(v1475.p512),
        p201: Ry188(v1475.p201),
    };
}
function Aw191(...v1476: Array<string[] | undefined>): string[] {
    const v1477: string[] = [];
    const v1478 = new Set<string>();
    for (const v1479 of v1476) {
        for (const v1480 of v1479 ?? []) {
            if (v1480.startsWith('s498')) {
                const v1481 = v1480.slice(1);
                if (!v1481)
                    continue;
                v1478.delete(v1481);
                const v1482 = v1477.indexOf(v1481);
                if (v1482 >= 0) {
                    v1477.splice(v1482, 1);
                }
                continue;
            }
            if (v1478.has(v1480))
                continue;
            v1478.add(v1480);
            v1477.push(v1480);
        }
    }
    return v1477;
}
export function Cw192(v1483?: Wg186, v1484?: Wg186, v1485?: Wg186): Partial<Iv180> {
    const v1486 = Oa190(v1485);
    const v1487 = Oa190(v1484);
    const v1488 = Oa190(v1483);
    const v1489 = {
        ...(v1486.p201 ?? {}),
        ...(v1487.p201 ?? {}),
        ...(v1488.p201 ?? {}),
    };
    return {
        p20: v1488.p20 ??
            v1487.p20 ??
            v1486.p20 ??
            Wt178,
        p509: Aw191(v1486.p509, v1487.p509, v1488.p509),
        p510: Aw191(v1486.p510, v1487.p510, v1488.p510),
        p511: Aw191(v1486.p511, v1487.p511, v1488.p511),
        p512: Aw191(v1486.p512, v1487.p512, v1488.p512),
        p201: Object.keys(v1489).length > 0 ? v1489 : undefined,
        p513: v1488.p513 ??
            v1487.p513 ??
            v1486.p513,
        p474: v1488.p474 ??
            v1487.p474 ??
            v1486.p474,
        p514: v1488.p514 ??
            v1487.p514 ??
            v1486.p514,
        p515: v1488.p515 ??
            v1487.p515 ??
            v1486.p515,
    };
}
