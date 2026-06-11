import v1296 from 'pkg14';
import type { Vw210 } from '../d8/f54';
export class Sq127 {
    private p343 = new Map<string, Vw210>();
    m344(v1297: string, v1298: string, v1299: () => Vw210): Vw210 {
        const v1300 = v1296
            .createHash('s486')
            .update(v1297)
            .update('s487')
            .update(v1298)
            .digest('s488');
        const v1301 = this.p343.get(v1300);
        if (v1301 !== undefined)
            return v1301;
        const v1302 = v1299();
        this.p343.set(v1300, v1302);
        return v1302;
    }
    get p345(): number {
        return this.p343.size;
    }
    m18(): void {
        this.p343.clear();
    }
}
