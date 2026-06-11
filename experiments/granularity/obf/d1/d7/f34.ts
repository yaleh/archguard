import { v12 } from 'pkg9';
import type { Jw214, Uu216 } from '../d8/f54';
import { Tw116 } from './f35';
import { Gw113 } from './f32';
export class Zf115 extends Gw113 {
    m289(v1117: string, v1118: string = 's471'): Jw214 {
        const v1119 = this.p288.x35(v1118, v1117, {
            overwrite: true,
        });
        const v1120 = v1119.x62()[0];
        if (!v1120) {
            throw new Tw116('s474', v1118);
        }
        return this.m301(v1120, v1118);
    }
    m301(v1121: any, v1122: string): Jw214 {
        const v1123 = v1121.x37();
        return {
            p205: `${v1122}s243${v1123}`,
            p19: v1123,
            p1: 'p599',
            p414: 's204',
            p557: this.m293(v1121),
            p559: [],
            p561: v1121.x63(),
            p558: {
                p329: v1122,
                p571: v1121.x40(),
                p572: v1121.x41(),
            },
        };
    }
    private m293(v1124: any): Uu216[] {
        const v1125: Uu216[] = [];
        for (const v1126 of v1124.x64()) {
            const v1127 = v1126.x46();
            v1125.push({
                p19: v1126.x37(),
                p1: 's210',
                p414: 's204',
                p570: v1127?.x47(),
            });
        }
        return v1125;
    }
}
