import v866 from 'pkg6';
import type { Ei88, Nv89, Yi90 } from './f25';
export class Cq108 {
    private p188 = false;
    constructor() {
    }
    async m76(v867: string): Promise<Ei88> {
        this.m194();
        if (!v867 || v867.trim().length === 0) {
            return {
                p72: false,
                p73: [
                    {
                        p5: 's426',
                        p68: 's427',
                    },
                ],
                p74: [],
            };
        }
        try {
            await v866.x34(v867, {
                suppressErrors: false,
            });
            return {
                p72: true,
                p73: [],
                p74: this.m259(v867),
            };
        }
        catch (v868) {
            return {
                p72: false,
                p73: this.m257(v868),
                p74: [],
            };
        }
    }
    private m194(): void {
        if (!this.p188) {
            v866.x23({
                startOnLoad: false,
                theme: 's26',
                securityLevel: 's312',
            });
            this.p188 = true;
        }
    }
    private m257(v869: unknown): Nv89[] {
        const v870: Nv89[] = [];
        if (v869 instanceof Error) {
            const v871 = v869.message;
            const v872 = v871.match(/r76/);
            const v873 = v871.match(/r77/);
            const v874: Nv89 = {
                p5: this.m258(v871),
            };
            if (v872?.[1]) {
                v874.p213 = parseInt(v872[1], 10);
            }
            if (v873?.[1]) {
                v874.p214 = parseInt(v873[1], 10);
            }
            if (v871.includes('s389')) {
                v874.p68 = 's39';
            }
            else if (v871.includes('p228')) {
                v874.p68 = 's428';
            }
            else if (v871.includes('s22')) {
                v874.p68 = 's429';
            }
            else {
                v874.p68 = 's430';
            }
            v870.push(v874);
        }
        else if (typeof v869 === 'string') {
            v870.push({
                p5: v869,
                p68: 's430',
            });
        }
        else {
            v870.push({
                p5: 's431',
                p68: 's430',
            });
        }
        return v870;
    }
    private m258(v875: string): string {
        return (v875
            .replace(/r78/, '')
            .replace(/r79/, '')
            .replace(/r80/, '')
            .trim() || 's315');
    }
    private m259(v876: string): Yi90[] {
        const v877: Yi90[] = [];
        const v878 = v876.matchAll(/r81/);
        for (const v879 of v878) {
            if (v879[1]) {
                v877.push({
                    p5: `s432${v879[1]}`,
                    p71: 's433',
                });
            }
        }
        const v880 = v876.matchAll(/r82/);
        for (const v881 of v880) {
            if (v881[1]) {
                v877.push({
                    p5: `s434${v881[1].substring(0, 20)}s435`,
                    p71: 's436',
                });
            }
        }
        const v882 = v876.matchAll(/r83/);
        for (const v883 of v882) {
            if (!v883[1] && v883[2]) {
                v877.push({
                    p5: `s437${v883[2]}`,
                    p71: 's438',
                });
            }
        }
        return v877;
    }
}
