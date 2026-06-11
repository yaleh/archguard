import { v18, v19, v20 } from 'pkg9';
import type { Jw214, Uu216, Al217 } from '../d8/f54';
import { Tw116 } from './f35';
import { Gw113 } from './f32';
export class Tr119 extends Gw113 {
    m289(v1140: string, v1141: string = 's471'): Jw214 {
        const v1142 = this.p288.x35(v1141, v1140, {
            overwrite: true,
        });
        const v1143 = v1142.x71()[0];
        if (!v1143) {
            throw new Tw116('s478', v1141);
        }
        return this.m303(v1143, v1141);
    }
    m303(v1144: any, v1145: string): Jw214 {
        const v1146 = v1144.x37();
        return {
            p205: `${v1145}s243${v1146}`,
            p19: v1146,
            p1: 'p598',
            p414: 's204',
            p557: this.m293(v1144),
            p559: [],
            p563: this.m304(v1144),
            p562: this.m292(v1144),
            p558: {
                p329: v1145,
                p571: v1144.x40(),
                p572: v1144.x41(),
            },
        };
    }
    private m304(v1147: any): string[] | undefined {
        const v1148 = v1147.x72();
        if (v1148.length === 0) {
            return undefined;
        }
        return v1148.map((v1149) => v1149.x73().x47());
    }
    private m292(v1150: any): string[] | undefined {
        const v1151 = v1150.x42();
        if (v1151.length === 0) {
            return undefined;
        }
        return v1151.map((v1152) => v1152.x37());
    }
    private m293(v1153: any): Uu216[] {
        const v1154: Uu216[] = [];
        for (const v1155 of v1153.x43()) {
            v1154.push(this.m305(v1155));
        }
        for (const v1156 of v1153.x44()) {
            v1154.push(this.m306(v1156));
        }
        return v1154;
    }
    private m305(v1157: any): Uu216 {
        const v1158: Uu216 = {
            p19: v1157.x37(),
            p1: 's210',
            p414: 's204',
            p477: v1157.x48().x47(),
            p568: v1157.x50(),
        };
        if (v1157.x74()) {
            v1158.p569 = true;
        }
        return v1158;
    }
    private m306(v1159: any): Uu216 {
        return {
            p19: v1159.x37(),
            p1: 'p499',
            p414: 's204',
            p565: this.m297(v1159),
            p479: v1159.x52().x47(),
        };
    }
    private m297(v1160: any): Al217[] {
        return v1160.x53().map((v1161) => {
            const v1162 = v1161.x46();
            return {
                p19: v1161.x37(),
                p1: v1161.x48().x47(),
                p569: v1161.x54() || v1161.x55(),
                p570: v1162?.x47(),
            };
        });
    }
}
