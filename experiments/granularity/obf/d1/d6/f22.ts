import v676 from 'pkg7';
import v677 from 'pkg2';
import v678 from 'pkg6';
import v679 from 'pkg8';
import type { Xp101, Wc102 } from './f25';
export { Cl53 } from './f18';
import { Cl53 } from './f18';
export class Ym67 {
    private readonly p117: Required<Xp101>;
    private p188 = false;
    constructor(v680?: Partial<Xp101>) {
        this.p117 = {
            p235: v680?.p235 ?? 'p104',
            p123: v680?.p123 ?? { p19: 's26' },
            p236: v680?.p236 ?? 'p607',
            p237: v680?.p237 ?? 2000,
            p238: v680?.p238 ?? 2000,
        };
    }
    async m189(v681: string): Promise<string> {
        this.m194();
        try {
            const { svg: v682 } = await v678.x24(this.m195(), v681);
            if (this.p117.p236 !== 's143') {
                const v683 = v682.match(/r64/);
                if (v683) {
                    return v682.replace(/r68/, `s293${this.p117.p236}s294`);
                }
                else {
                    return v682.replace(/r66/, `s295${this.p117.p236}s296`);
                }
            }
            return v682;
        }
        catch (v684) {
            throw new Error(`s314${v684 instanceof Error ? v684.message : 's315'}`);
        }
    }
    async m190(v685: string): Promise<string> {
        this.m194();
        try {
            const { svg: v686 } = await v678.x24(this.m195(), v685);
            return v686;
        }
        catch (v687) {
            throw new Error(`s314${v687 instanceof Error ? v687.message : 's315'}`);
        }
    }
    async m191(v688: string, v689: string): Promise<void> {
        try {
            const v690 = await this.m189(v688);
            await this.m192(v690, v689);
        }
        catch (v691) {
            throw new Error(`s316${v689}s70${v691 instanceof Error ? v691.message : 's315'}`);
        }
    }
    async m192(v692: string, v693: string): Promise<void> {
        const v694 = Buffer.from(v692);
        await v676.ensureDir(v677.dirname(v693));
        const v695 = v692.match(/r69/);
        let v696 = 300;
        let v697: number | undefined;
        let v698: number | undefined;
        const v699 = 32767;
        if (v695) {
            const [, , v700, v701] = v695[1].split(/r70/).map(Number);
            const v702 = v700 || 0;
            const v703 = v701 || 0;
            const v704 = v702 * (300 / 72);
            const v705 = v703 * (300 / 72);
            if (v702 > v699 || v703 > v699) {
                const v706 = Math.min(v699 / v702, v699 / v703);
                v697 = Math.floor(v702 * v706);
                v698 = Math.floor(v703 * v706);
                v696 = 72;
            }
            else if (v704 > v699 || v705 > v699) {
                const v707 = Math.max(v702, v703);
                v696 = Math.floor(((v699 * 0.9) / v707) * 72);
                v696 = Math.max(72, Math.min(300, v696));
            }
        }
        let v708 = v679(v694, { density: v696, limitInputPixels: false });
        const v709 = v697 ?? v699;
        const v710 = v698 ?? v699;
        v708 = v708.x25(v709, v710, {
            fit: 's317',
            withoutEnlargement: true,
        });
        if (this.p117.p236 !== 's143') {
            v708.x26({
                p604: this.m198(this.p117.p236),
            });
        }
        await v708.x28().x27(v693);
    }
    async m193(v711: string, v712: Wc102): Promise<void> {
        try {
            await Promise.all([
                v676.ensureDir(v677.dirname(v712.p103)),
                v676.ensureDir(v677.dirname(v712.p104)),
                v676.ensureDir(v677.dirname(v712.p105)),
            ]);
            const [v713] = await Promise.all([
                this.m189(v711),
                v676.writeFile(v712.p103, v711, 's318'),
            ]);
            const v714 = Cl53(v713);
            await Promise.all([
                v676.writeFile(v712.p104, v714, 's318'),
                this.m192(v714, v712.p105),
            ]);
        }
        catch (v715) {
            throw new Error(`s319${v715 instanceof Error ? v715.message : 's315'}`);
        }
    }
    private m194(): void {
        if (!this.p188) {
            const v716 = {
                p605: false,
                p123: this.p117.p123.p19 ?? 's26',
                p606: 's312' as const,
                p167: this.p117.p123.p234,
                p165: 200000,
            };
            v678.x23(v716);
            this.p188 = true;
        }
    }
    private m195(): string {
        return `s320${Date.now()}s206${Math.random().toString(36).substr(2, 9)}`;
    }
    m196(): Xp101 {
        return { ...this.p117 };
    }
    m197(v717: Partial<Xp101>): void {
        if (v717.p235 !== undefined) {
            this.p117.p235 = v717.p235;
        }
        if (v717.p123 !== undefined) {
            this.p117.p123 = v717.p123;
        }
        if (v717.p236 !== undefined) {
            this.p117.p236 = v717.p236;
        }
        if (v717.p237 !== undefined) {
            this.p117.p237 = v717.p237;
        }
        if (v717.p238 !== undefined) {
            this.p117.p238 = v717.p238;
        }
        if (this.p188) {
            this.p188 = false;
            this.m194();
        }
    }
    private m198(v718: string): string {
        if (v718.startsWith('s321')) {
            return v718;
        }
        const v719: Record<string, string> = {
            p607: 's322',
            p608: 's323',
            p609: 's324',
            p610: 's325',
            p611: 's326',
            p612: 's327',
            p613: 's328',
            p614: 's329',
            p615: 's330',
            p616: 's330',
            p617: 's331',
            p618: 's331',
            p619: 's332',
            p620: 's332',
        };
        const v720 = v718.toLowerCase();
        if (v719[v720]) {
            return v719[v720];
        }
        return v718;
    }
}
