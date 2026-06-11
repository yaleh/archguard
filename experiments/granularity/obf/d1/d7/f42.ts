import { v22, v23, v24, v25, } from 'pkg9';
import type { Yf221 } from '../d8/f54';
import { Gw113 } from './f32';
function Vk128(v1303: string): boolean {
    return v1303.startsWith('s243') || v1303.startsWith('s110') || v1303.startsWith('s489');
}
function Wp129(v1304: any): Set<string> {
    const v1305 = new Set<string>();
    for (const v1306 of v1304.x75()) {
        const v1307 = v1306.x76();
        if (Vk128(v1307)) {
            continue;
        }
        for (const v1308 of v1306.x77()) {
            v1305.add(v1308.x37());
        }
        const v1309 = v1306.x78();
        if (v1309) {
            v1305.add(v1309.x47());
        }
        const v1310 = v1306.x79();
        if (v1310) {
            v1305.add(v1310.x47());
        }
    }
    return v1305;
}
export class Ac130 extends Gw113 {
    m289(v1311: string, v1312: string = 's471'): Yf221[] {
        const v1313 = this.p288.x35(v1312, v1311, {
            overwrite: true,
        });
        return this.m346(v1313);
    }
    m346(v1314: any): Yf221[] {
        const v1315: Yf221[] = [];
        const v1316 = new Set<string>();
        const v1317 = Wp129(v1314);
        for (const v1318 of v1314.x36()) {
            v1315.push(...this.m347(v1318, v1316, v1317));
        }
        for (const v1319 of v1314.x71()) {
            v1315.push(...this.m348(v1319, v1316, v1317));
        }
        v1315.push(...this.m349(v1314, v1316, v1317));
        return v1315;
    }
    private m347(v1320: any, v1321: Set<string>, v1322: Set<string> = new Set()): Yf221[] {
        const v1323: Yf221[] = [];
        const v1324 = v1320.x37();
        if (!v1324)
            return v1323;
        const v1325 = v1320.x72();
        if (v1325) {
            const v1326 = v1325.x73().x47();
            this.m350(v1323, v1321, 's215', v1324, v1326);
        }
        for (const v1327 of v1320.x80()) {
            const v1328 = v1327.x73().x47();
            this.m350(v1323, v1321, 's217', v1324, v1328);
        }
        for (const v1329 of v1320.x43()) {
            const v1330 = this.m351(v1329.x48().x47());
            if (v1330 && this.m352(v1330) && !v1322.has(v1330)) {
                this.m350(v1323, v1321, 's96', v1324, v1330);
            }
        }
        for (const v1331 of v1320.x45()) {
            for (const v1332 of v1331.x53()) {
                const v1333 = this.m351(v1332.x48().x47());
                if (v1333 && this.m352(v1333) && !v1322.has(v1333)) {
                    this.m350(v1323, v1321, 's96', v1324, v1333);
                }
            }
        }
        for (const v1334 of v1320.x44()) {
            const v1335 = this.m351(v1334.x52().x47());
            if (v1335 && this.m352(v1335) && !v1322.has(v1335)) {
                this.m350(v1323, v1321, 's221', v1324, v1335);
            }
            for (const v1336 of v1334.x53()) {
                const v1337 = this.m351(v1336.x48().x47());
                if (v1337 && this.m352(v1337) && !v1322.has(v1337)) {
                    this.m350(v1323, v1321, 's221', v1324, v1337);
                }
            }
        }
        return v1323;
    }
    private m348(v1338: any, v1339: Set<string>, v1340: Set<string> = new Set()): Yf221[] {
        const v1341: Yf221[] = [];
        const v1342 = v1338.x37();
        for (const v1343 of v1338.x72()) {
            const v1344 = v1343.x73().x47();
            this.m350(v1341, v1339, 's215', v1342, v1344);
        }
        for (const v1345 of v1338.x43()) {
            const v1346 = this.m351(v1345.x48().x47());
            if (v1346 &&
                this.m352(v1346) &&
                !v1340.has(v1346) &&
                v1346 !== v1342) {
                this.m350(v1341, v1339, 's96', v1342, v1346);
            }
        }
        return v1341;
    }
    private m349(v1347: any, v1348: Set<string>, v1349: Set<string>): Yf221[] {
        const v1350: Yf221[] = [];
        const v1351 = new Set<string>();
        for (const v1352 of v1347.x75()) {
            const v1353 = v1352.x76();
            if (!Vk128(v1353)) {
                continue;
            }
            for (const v1354 of v1352.x77()) {
                v1351.add(v1354.x37());
            }
        }
        const v1355 = (v1356: string, v1357: string): void => {
            for (const v1358 of v1351) {
                if (v1358 === v1356) {
                    continue;
                }
                const v1359 = new RegExp(`s440${v1358}s440`);
                if (v1359.test(v1357)) {
                    this.m350(v1350, v1348, 's221', v1356, v1358);
                }
            }
        };
        for (const v1360 of v1347.x65()) {
            const v1361 = v1360.x37();
            if (!v1361)
                continue;
            const v1362 = v1360.x81();
            if (!v1362)
                continue;
            v1355(v1361, v1362.x47());
        }
        for (const v1363 of v1347.x82()) {
            const v1364 = v1363.x46();
            if (!v1364)
                continue;
            if (v1364.x57() !== v25.x83)
                continue;
            const v1365 = v1363.x37();
            v1355(v1365, v1364.x47());
        }
        return v1350;
    }
    private m350(v1366: Yf221[], v1367: Set<string>, v1368: Yf221['p1'], v1369: string, v1370: string): void {
        const v1371 = `${v1368}s284${v1369}s284${v1370}`;
        if (!v1367.has(v1371)) {
            v1367.add(v1371);
            v1366.push({
                p205: `${v1369}s44${v1368}s44${v1370}`,
                p1: v1368,
                p22: v1369,
                p473: v1370,
            });
        }
    }
    private m351(v1372: string): string | null {
        v1372 = v1372.trim();
        if (v1372.startsWith('s45'))
            return null;
        if (v1372.startsWith('s41'))
            return null;
        if (v1372.startsWith('s490'))
            return null;
        if (v1372.startsWith('s191')) {
            const v1373 = v1372.match(/r27/);
            if (v1373) {
                return v1373[2];
            }
        }
        if (v1372.startsWith('s192')) {
            const v1374 = v1372.split('s193');
            if (v1374.length > 0) {
                const v1375 = v1374[v1374.length - 1];
                if (v1375 && v1375.length > 0) {
                    return v1375;
                }
                else if (v1374.length > 1) {
                    return v1374[v1374.length - 2];
                }
            }
            return null;
        }
        if (v1372.endsWith('s491')) {
            return this.m351(v1372.slice(0, -2));
        }
        const v1376 = v1372.match(/r98/);
        if (v1376) {
            const v1377 = v1376[1];
            const v1378 = v1376[2];
            const v1379: string[] = [];
            let v1380 = 0;
            let v1381 = '';
            for (const v1382 of v1378) {
                if (v1382 === 's1')
                    v1380++;
                if (v1382 === 's3')
                    v1380--;
                if (v1382 === 's31' && v1380 === 0) {
                    v1379.push(v1381.trim());
                    v1381 = '';
                }
                else {
                    v1381 += v1382;
                }
            }
            if (v1381.trim()) {
                v1379.push(v1381.trim());
            }
            for (const v1383 of v1379) {
                const v1384 = this.m351(v1383);
                if (v1384) {
                    return v1384;
                }
            }
            return null;
        }
        if (v1372.includes('s200')) {
            const v1385 = v1372.split('s200');
            if (v1385[0]) {
                return this.m351(v1385[0]);
            }
        }
        if (this.m353(v1372)) {
            return null;
        }
        return v1372;
    }
    private m352(v1386: string): boolean {
        return !this.m353(v1386);
    }
    private m353(v1387: string): boolean {
        const v1388 = new Set([
            'string',
            'number',
            'boolean',
            's492',
            's197',
            's22',
            's311',
            'undefined',
            's493',
            'object',
            'symbol',
            'bigint',
            's180',
            's179',
            's183',
            's185',
            's181',
            's182',
            's494',
            's495',
        ]);
        return v1388.has(v1387);
    }
}
