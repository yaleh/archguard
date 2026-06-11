import type { Vw210 } from '../d8/f54';
import type { Jw85, Zf86, Ox87, Tx104 } from './f25';
export class Lf52 {
    private readonly p109: Required<Tx104>;
    constructor(v495?: Partial<Tx104>) {
        this.p109 = {
            p239: 's253',
            p240: v495?.p240 ?? 10,
            p241: v495?.p241 ?? Infinity,
            p242: v495?.p242 ?? [],
        };
    }
    m151(v496: Vw210): Jw85 {
        if (v496.p210.length === 0) {
            return {
                p208: [],
                p209: {
                    p212: 's241',
                    p211: 's254',
                },
            };
        }
        const v497 = this.m152(v496);
        if (v497) {
            return v497;
        }
        const v498 = this.m153(v496);
        const v499 = this.m157(v498);
        const v500 = this.m158(v499);
        const v501 = this.m159(v500);
        return {
            p208: v500,
            p209: v501,
        };
    }
    private m152(v502: Vw210): Jw85 | null {
        if (this.p109.p242.length === 0) {
            return null;
        }
        const v503 = new Map<string, string[]>();
        const v504 = new Set<string>();
        const v505 = [...this.p109.p242].sort((v506, v507) => (v507.p245 ?? 0) - (v506.p245 ?? 0));
        for (const v508 of v505) {
            for (const v509 of v502.p210) {
                if (v504.has(v509.p205)) {
                    continue;
                }
                if (v508.p243.test(v509.p558.p329)) {
                    if (!v503.has(v508.p244)) {
                        v503.set(v508.p244, []);
                    }
                    v503.get(v508.p244).push(v509.p205);
                    v504.add(v509.p205);
                }
            }
        }
        if (v503.size === 0) {
            return null;
        }
        const v510: Zf86[] = Array.from(v503.entries()).map(([v511, v512]) => ({
            p19: v511,
            p210: v512,
            p211: 's255',
        }));
        return {
            p208: v510,
            p209: {
                p212: 's241',
                p211: 's256',
            },
        };
    }
    private m153(v513: Vw210): Zf86[] {
        const v514 = new Map<string, string[]>();
        const v515 = new Map<string, string>();
        for (const v516 of v513.p210) {
            const v517 = v516.p1 === 'p440' || v516.p19.includes('s110');
            const v518 = v513.p421 === 's257'
                ? this.m154(v516.p558.p329)
                : null;
            const v519 = v517
                ? v516.p19.split('s110')[0]
                : (v518 ?? this.m155(v516.p558.p329));
            if (!v514.has(v519)) {
                v514.set(v519, []);
            }
            if (v518) {
                v515.set(v519, `s258${v519}`);
            }
            v514.get(v519).push(v516.p205);
            if (v517) {
                v515.set(v519, `s259${v519}s110`);
            }
        }
        return Array.from(v514.entries()).map(([v520, v521]) => ({
            p19: this.m156(v520),
            p210: v521,
            p211: v515.get(v520) ?? `s259${v520}`,
        }));
    }
    private m154(v522: string): string | null {
        if (!v522 || v522.trim() === '') {
            return null;
        }
        const v523 = v522.replace(/r46/, 's110');
        const v524 = v523.match(/r47/);
        if (!v524) {
            return null;
        }
        const v525 = v524[1];
        if (!v525 || v525 === 's260') {
            return null;
        }
        return v525;
    }
    private m155(v526: string): string {
        if (!v526 || v526.trim() === '') {
            return 's261';
        }
        const v527 = v526.replace(/r46/, 's110');
        const v528 = v527.split('s110');
        const v529 = v528.findIndex((v530) => ['s260', 's262', 'p208', 's263', 's264', 's265'].includes(v530));
        if (v529 >= 0) {
            if (v528[v529] === 'p208' && v529 + 1 < v528.length) {
                const v531 = v528[v529 + 1];
                if (v531) {
                    return v531;
                }
            }
            if (v529 + 1 < v528.length) {
                const v532 = v528[v529 + 1];
                if (v532 &&
                    !['s266', 's267', 'p463', 's268', 's269', 's270', 's271'].includes(v532)) {
                    return v532;
                }
            }
        }
        if (v528.length >= 2) {
            const v533 = v528[v528.length - 2];
            if (v533 && v533 !== 's243' && v533 !== 's272' && v533 !== '') {
                return v533;
            }
        }
        return 's261';
    }
    private m156(v534: string): string {
        const v535 = v534
            .split(/r48/)
            .map((v536) => (v536 ? v536.charAt(0).toUpperCase() + v536.slice(1) : ''))
            .join('s99');
        if (!v535.includes('s273') && !v535.includes('s274')) {
            return `${v535}s275`;
        }
        return v535;
    }
    private m157(v537: Zf86[]): Zf86[] {
        const v538 = 2;
        const v539: Zf86[] = [];
        const v540 = new Set<number>();
        for (let v541 = 0; v541 < v537.length; v541++) {
            if (v540.has(v541)) {
                continue;
            }
            const v542 = v537[v541];
            if (!v542)
                continue;
            const v543 = v542.p211?.includes('s110') ||
                v542.p211?.startsWith('s276');
            if (v542.p210.length <= v538 && !v543 && v541 + 1 < v537.length) {
                const v544 = v537[v541 + 1];
                const v545 = v544?.p211?.includes('s110') || v544?.p211?.startsWith('s276');
                if (v544 && !v540.has(v541 + 1) && !v545) {
                    v539.push({
                        p19: `${v542.p19}s277${v544.p19}`,
                        p210: [...v542.p210, ...v544.p210],
                        p211: `s278${v542.p211}s29${v544.p211}`,
                    });
                    v540.add(v541 + 1);
                    continue;
                }
            }
            v539.push(v542);
        }
        return v539;
    }
    private m158(v546: Zf86[]): Zf86[] {
        let v547 = [...v546];
        if (v547.length > this.p109.p240) {
            v547 = v547
                .sort((v548, v549) => v549.p210.length - v548.p210.length)
                .slice(0, this.p109.p240);
        }
        if (this.p109.p241 < Infinity) {
            v547 = v547.map((v550) => ({
                ...v550,
                p210: v550.p210.slice(0, this.p109.p241),
            }));
        }
        return v547;
    }
    private m159(v551: Zf86[]): Ox87 {
        let v552: Ox87['p212'] = 's241';
        if (v551.length <= 2) {
            v552 = 's279';
        }
        else if (v551.length > 5) {
            v552 = 's241';
        }
        const v553 = `s280${v552}s281${v551.length}s282`;
        return {
            p212: v552,
            p211: v553,
        };
    }
}
