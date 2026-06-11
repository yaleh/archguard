import { v7, v8, v9, v10, v1079, v11, } from 'pkg9';
import type { Jw214, Pj213, Uu216, Al217, Mb219 } from '../d8/f54';
import { Tw116 } from './f35';
import { Gw113 } from './f32';
export class Nj114 extends Gw113 {
    m289(v1080: string, v1081: string = 's471'): Jw214 {
        const v1082 = this.p288.x35(v1081, v1080, {
            overwrite: true,
        });
        const v1083 = v1082.x36()[0];
        if (!v1083) {
            throw new Tw116('s472', v1081);
        }
        return this.m290(v1083, v1081);
    }
    private m290(v1084: any, v1085: string): Jw214 {
        const v1086 = v1084.x37() || 's473';
        return {
            p205: `${v1085}s243${v1086}`,
            p19: v1086,
            p1: 's23',
            p414: this.m291(v1084),
            p560: v1084.x38(),
            p557: this.m293(v1084),
            p559: this.m300(v1084.x39()),
            p562: this.m292(v1084),
            p558: {
                p329: v1085,
                p571: v1084.x40(),
                p572: v1084.x41(),
            },
        };
    }
    private m291(v1087: any): Pj213 {
        return 's204';
    }
    private m292(v1088: any): string[] | undefined {
        const v1089 = v1088.x42();
        if (v1089.length === 0) {
            return undefined;
        }
        return v1089.map((v1090) => v1090.x37());
    }
    private m293(v1091: any): Uu216[] {
        const v1092: Uu216[] = [];
        for (const v1093 of v1091.x43()) {
            v1092.push(this.m294(v1093));
        }
        for (const v1094 of v1091.x44()) {
            v1092.push(this.m295(v1094));
        }
        for (const v1095 of v1091.x45()) {
            v1092.push(this.m296(v1095));
        }
        return v1092;
    }
    private m294(v1096: any): Uu216 {
        const v1097 = v1096.x46();
        return {
            p19: v1096.x37(),
            p1: 's210',
            p414: this.m298(v1096),
            p477: v1096.x48().x47(),
            p566: v1096.x49(),
            p568: v1096.x50(),
            p570: v1097?.x47(),
            p559: this.m300(v1096.x39()),
        };
    }
    private m295(v1098: any): Uu216 {
        return {
            p19: v1098.x37(),
            p1: 'p499',
            p414: this.m298(v1098),
            p566: v1098.x49(),
            p567: v1098.x51(),
            p560: v1098.x38(),
            p565: this.m297(v1098),
            p479: v1098.x52().x47(),
            p559: this.m300(v1098.x39()),
        };
    }
    private m296(v1099: any): Uu216 {
        return {
            p19: 's213',
            p1: 's213',
            p414: this.m299(v1099),
            p565: this.m297(v1099),
        };
    }
    private m297(v1100: any | any): Al217[] {
        return v1100.x53().map((v1101) => {
            const v1102 = v1101.x46();
            return {
                p19: v1101.x37(),
                p1: v1101.x48().x47(),
                p569: v1101.x54() || v1101.x55(),
                p570: v1102?.x47(),
            };
        });
    }
    private m298(v1103: any | any): Pj213 {
        const v1104 = v1103.x56();
        for (const v1105 of v1104) {
            const v1106 = v1105.x57();
            if (v1106 === v11.x58)
                return 's202';
            if (v1106 === v11.x59)
                return 's203';
            if (v1106 === v11.x60)
                return 's204';
        }
        return 's204';
    }
    private m299(v1107: any): Pj213 {
        const v1108 = v1107.x56();
        for (const v1109 of v1108) {
            const v1110 = v1109.x57();
            if (v1110 === v11.x58)
                return 's202';
            if (v1110 === v11.x59)
                return 's203';
            if (v1110 === v11.x60)
                return 's204';
        }
        return 's204';
    }
    private m300(v1111: any[]): Mb219[] {
        if (v1111.length === 0) {
            return [];
        }
        return v1111.map((v1112) => {
            const v1113 = v1112.x37();
            const v1114 = v1112.x61();
            const v1115: Mb219 = {
                p19: v1113,
            };
            if (v1114.length > 0) {
                v1115.p573 = v1114.map((v1116) => v1116.x47());
            }
            return v1115;
        });
    }
}
