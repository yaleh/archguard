import type { Jy196 } from '../d8/d9/f52';
import type { Vw210 } from '../d8/f54';
const Dd68 = 20;
export class Lm69 {
    m184(v721: Jy196, v722: Vw210): string {
        const v723 = new Map<string, number>();
        for (const v724 of v721.p528) {
            v723.set(v724.p534, v724.p536);
        }
        const v725: string[] = [];
        const v726: string[] = [];
        const v727: string[] = [];
        for (const v728 of v722.p210) {
            if (v728.p1 === 's23' || v728.p1 === 'p598') {
                const v729 = v723.get(v728.p205) ?? 0;
                const v730 = this.m200(v728.p19 ?? v728.p205, 30);
                if (v729 >= 0.7)
                    v725.push(v730);
                else if (v729 >= 0.3)
                    v726.push(v730);
                else
                    v727.push(v730);
            }
        }
        const v731 = v721.p527
            .filter((v732) => v732.p529 === 's333')
            .map((v733) => this.m200(v733.p205, 30));
        const v734: string[] = ['s334'];
        v734.push('s335');
        const v735 = v725.slice(0, Dd68);
        for (const v736 of v735) {
            v734.push(`s247${this.m199(v736)}s93${v736}s94`);
        }
        if (v725.length > Dd68) {
            v734.push(`s336${v725.length - Dd68}s337`);
        }
        v734.push('s248');
        v734.push('s338');
        const v737 = v726.slice(0, Dd68);
        for (const v738 of v737) {
            v734.push(`s247${this.m199(v738)}s93${v738}s94`);
        }
        if (v726.length > Dd68) {
            v734.push(`s339${v726.length - Dd68}s337`);
        }
        v734.push('s248');
        v734.push('s340');
        const v739 = v727.slice(0, Dd68);
        for (const v740 of v739) {
            v734.push(`s247${this.m199(v740)}s93${v740}s94`);
        }
        if (v727.length > Dd68) {
            v734.push(`s341${v727.length - Dd68}s337`);
        }
        v734.push('s248');
        if (v731.length > 0) {
            v734.push('s342');
            const v741 = v731.slice(0, Dd68);
            for (const v742 of v741) {
                v734.push(`s247${this.m199('s343' + v742)}s93${v742}s94`);
            }
            if (v731.length > Dd68) {
                v734.push(`s344${v731.length - Dd68}s337`);
            }
            v734.push('s248');
        }
        return v734.join('s33');
    }
    private m199(v743: string): string {
        return v743.replace(/r30/, 's44').replace(/r71/, 's345');
    }
    private m200(v744: string, v745: number): string {
        return v744.length > v745 ? v744.slice(0, v745 - 1) + 's346' : v744;
    }
}
