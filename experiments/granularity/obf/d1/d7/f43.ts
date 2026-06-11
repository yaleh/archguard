import v1389 from 'pkg2';
import { v26 } from 'pkg9';
import { Kx227, Zv228 } from '../d10/f56';
import { Nj114 } from './f33';
import { Tr119 } from './f38';
import { Zf115 } from './f34';
import { Ac130 } from './f42';
import { Qz117 } from './f36';
import type { Vw210, Jw214, Yf221 } from '../d8/f54';
export class Xd131 {
    private p288: any;
    private p354: Nj114;
    private p355: Tr119;
    private p356: Zf115;
    private p357: Ac130;
    private p358: Qz117;
    private p48?: string;
    constructor(v1390?: string) {
        this.p48 = v1390;
        this.p288 = new v26({
            useInMemoryFileSystem: true,
            compilerOptions: {
                target: 99,
            },
        });
        this.p354 = new Nj114();
        this.p355 = new Tr119();
        this.p356 = new Zf115();
        this.p357 = new Ac130();
        this.p358 = new Qz117();
    }
    private m359(v1391: string): string {
        if (this.p48) {
            return v1389.relative(this.p48, v1391).replace(/r46/, 's110');
        }
        return v1391;
    }
    m66(v1392: string, v1393: string = 's496'): Vw210 {
        const v1394 = this.p288.x35(v1393, v1392, {
            overwrite: true,
        });
        const v1395: Jw214[] = [];
        const v1396: string[] = [v1393];
        const v1397 = this.m359(v1393);
        for (const v1398 of v1394.x36()) {
            const v1399 = this.p354['m290'](v1398, v1397);
            v1395.push(v1399);
        }
        for (const v1400 of v1394.x71()) {
            const v1401 = this.p355.m303(v1400, v1397);
            v1395.push(v1401);
        }
        for (const v1402 of v1394.x62()) {
            const v1403 = this.p356.m301(v1402, v1397);
            v1395.push(v1403);
        }
        v1395.push(...this.p358.m289(v1394, v1397));
        const v1404 = this.p357.m346(v1394);
        const v1405 = this.m360(v1395, v1404, v1397);
        return {
            p20: 's484',
            p421: 's485',
            p552: new Date().toISOString(),
            p553: v1396,
            p210: v1395,
            p554: v1405,
        };
    }
    m65(v1406: string, v1407: string = 's497', v1408?: any, v1409?: string[]): Vw210 {
        this.p48 = v1406;
        let v1410: any;
        if (v1408) {
            v1410 = v1408;
        }
        else {
            const v1411 = Kx227(v1406);
            const v1412 = v1411 ? Zv228(v1411) : undefined;
            v1410 = v1412
                ? new v26({ compilerOptions: { target: 99, ...v1412 } })
                : new v26({ compilerOptions: { target: 99 } });
            const v1413 = [
                `s498${v1406}s499`,
                `s498${v1406}s500`,
                `s498${v1406}s501`,
            ];
            const v1414 = (v1409 ?? []).map((v1415) => v1415.startsWith('s498') || v1389.isAbsolute(v1415) ? v1415 : `s498${v1406}s110${v1415}`);
            v1410.x84([
                `${v1406}s110${v1407}`,
                ...v1413,
                ...v1414,
            ]);
        }
        const v1416: Jw214[] = [];
        const v1417: Yf221[] = [];
        const v1418: string[] = [];
        for (const v1419 of v1410.x85()) {
            const v1420 = v1419.x86();
            v1418.push(v1420);
            const v1421 = this.m359(v1420);
            for (const v1422 of v1419.x36()) {
                const v1423 = this.p354['m290'](v1422, v1421);
                v1416.push(v1423);
            }
            for (const v1424 of v1419.x71()) {
                const v1425 = this.p355.m303(v1424, v1421);
                v1416.push(v1425);
            }
            for (const v1426 of v1419.x62()) {
                const v1427 = this.p356.m301(v1426, v1421);
                v1416.push(v1427);
            }
            v1416.push(...this.p358.m289(v1419, v1421));
            const v1428 = new Map<string, string>();
            for (const v1429 of v1419.x75()) {
                const v1430 = v1429.x87();
                if (!v1430)
                    continue;
                const v1431 = this.m359(v1430.x86());
                for (const v1432 of v1429.x77()) {
                    const v1433 = v1432.x37();
                    v1428.set(v1433, `${v1431}s243${v1433}`);
                }
            }
            const v1434 = this.p357.m346(v1419);
            const v1435 = v1434.map((v1436) => {
                const v1437 = `${v1421}s243${v1436.p22}`;
                let v1438 = v1436.p473;
                if (v1428.has(v1436.p473)) {
                    v1438 = v1428.get(v1436.p473)!;
                }
                return {
                    ...v1436,
                    p205: `${v1437}s44${v1436.p1}s44${v1438}`,
                    p22: v1437,
                    p473: v1438,
                };
            });
            v1417.push(...v1435);
        }
        const v1439: Vw210 = {
            p20: 's484',
            p421: 's485',
            p552: new Date().toISOString(),
            p553: v1418,
            p210: v1416,
            p554: v1417,
        };
        const v1440 = this.m361(v1439);
        const v1441 = this.m341(v1440.p554);
        return {
            ...v1440,
            p554: v1441,
        };
    }
    private m360(v1442: Jw214[], v1443: Yf221[], v1444: string): Yf221[] {
        const v1445 = new Map<string, string>();
        for (const v1446 of v1442) {
            if (!v1445.has(v1446.p19)) {
                v1445.set(v1446.p19, v1446.p205);
            }
        }
        return v1443.map((v1447) => {
            const v1448 = v1445.get(v1447.p22) ?? `${v1444}s243${v1447.p22}`;
            const v1449 = v1445.get(v1447.p473) ?? v1447.p473;
            if (v1448 === v1447.p22 && v1449 === v1447.p473) {
                return v1447;
            }
            return {
                ...v1447,
                p205: `${v1448}s44${v1447.p1}s44${v1449}`,
                p22: v1448,
                p473: v1449,
            };
        });
    }
    private m361(v1450: Vw210): Vw210 {
        const v1451 = new Set(v1450.p210.map((v1452) => v1452.p205));
        const v1453 = [
            /r99/,
            /r100/,
            /r101/,
            /r102/,
            /r103/,
        ];
        const v1454 = v1450.p554.filter((v1455) => {
            if (v1451.has(v1455.p473))
                return true;
            if (v1453.some((v1456) => v1456.test(v1455.p473)))
                return false;
            return true;
        });
        return { ...v1450, p554: v1454 };
    }
    private m341(v1457: Yf221[]): Yf221[] {
        const v1458 = new Set<string>();
        const v1459: Yf221[] = [];
        for (const v1460 of v1457) {
            const v1461 = `${v1460.p1}s284${v1460.p22}s284${v1460.p473}`;
            if (!v1458.has(v1461)) {
                v1458.add(v1461);
                v1459.push(v1460);
            }
        }
        return v1459;
    }
    m362(v1462: Vw210, v1463: boolean = false): string {
        return JSON.stringify(v1462, null, v1463 ? 2 : undefined);
    }
}
