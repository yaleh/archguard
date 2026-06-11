import { v13, v14, v15, v16, v17, } from 'pkg9';
import type { Jw214, Uu216 } from '../d8/f54';
export class Qz117 {
    m289(v1129: any, v1130: string): Jw214[] {
        const v1131: Jw214[] = [];
        for (const v1132 of v1129.x65()) {
            if (!v1132.x66())
                continue;
            const v1133 = v1132.x37();
            if (!v1133)
                continue;
            v1131.push({
                p205: `${v1130}s243${v1133}`,
                p19: v1133,
                p1: 'function',
                p414: 's204',
                p557: this.m302(v1132),
                p558: {
                    p329: v1130,
                    p571: v1132.x40(),
                    p572: v1132.x41(),
                },
            });
        }
        for (const v1134 of v1129.x67()) {
            if (!v1134.x66())
                continue;
            for (const v1135 of v1134.x68()) {
                const v1136 = v1135.x46();
                if (!v1136)
                    continue;
                if (v13.x69(v1136) || v13.x70(v1136)) {
                    const v1137 = v1135.x37();
                    v1131.push({
                        p205: `${v1130}s243${v1137}`,
                        p19: v1137,
                        p1: 'function',
                        p414: 's204',
                        p557: this.m302(v1136),
                        p558: {
                            p329: v1130,
                            p571: v1135.x40(),
                            p572: v1135.x41(),
                        },
                    });
                }
            }
        }
        return v1131;
    }
    private m302(v1138: any | any | any): Uu216[] {
        return v1138.x53().map((v1139) => ({
            p19: v1139.x37(),
            p1: 's476' as const,
            p414: 's204' as const,
            p477: v1139.x48().x47(),
        }));
    }
}
