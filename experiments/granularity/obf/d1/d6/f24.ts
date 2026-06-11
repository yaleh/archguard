import type { Az204, Mu206, Go205, } from '../d8/d9/f53';
interface Dh70 {
    p201?: Record<string, string>;
}
const Me71 = [
    's347',
    's348',
    's349',
    's350',
];
function Sa72(v746: string): string {
    return v746.replace(/r72/, 's44') || 's351';
}
function Ck73(v747: number): string {
    if (v747 >= 10)
        return 's352';
    if (v747 >= 3)
        return 's353';
    return 's95';
}
function Dx74(v748: string): string | null {
    const v749 = v748.lastIndexOf('s110');
    return v749 > 0 ? v748.slice(0, v749) : null;
}
function Wh75(v750: string): string {
    return v750.replace(/r46/, 's110').replace(/r73/, '').replace(/r74/, '').replace(/r75/, '');
}
function Ah76(v751: string, v752?: Record<string, string>): {
    p129: string;
    p130: string;
} | null {
    if (!v752)
        return null;
    const v753 = v751.replace(/r46/, 's110');
    const v754 = Object.entries(v752)
        .map(([v755, v756]) => ({ p129: Wh75(v755), p130: v756 }))
        .filter(({ p129: v757 }) => v753 === v757 || v753.startsWith(`${v757}s110`))
        .sort((v758, v759) => v759.p129.length - v758.p129.length);
    return v754[0] ?? null;
}
interface Og77 {
    p202: Go205 | null;
    p203?: string;
    p204: Og77[];
}
function Dx78(v760: Og77): string {
    return v760.p202 ? v760.p202.p205 : v760.p203;
}
function Ak79(v761: Go205[]): Og77[] {
    const v762 = new Set(v761.map((v763) => v763.p205));
    const v764 = new Map<string, Og77>();
    for (const v765 of v761) {
        v764.set(v765.p205, { p202: v765, p204: [] });
    }
    const v766 = new Map<string | null, Set<string>>();
    for (const v767 of v762) {
        let v768: string = v767;
        let v769: string | null = Dx74(v768);
        while (true) {
            if (!v766.has(v769))
                v766.set(v769, new Set());
            v766.get(v769).add(v768);
            if (v769 === null)
                break;
            v768 = v769;
            v769 = Dx74(v768);
        }
    }
    function Gl80(v770: string | null): Og77[] {
        const v771 = v766.get(v770);
        if (!v771)
            return [];
        const v772: Og77[] = [];
        for (const v773 of v771) {
            if (v762.has(v773)) {
                const v774 = v764.get(v773);
                for (const v775 of Gl80(v773))
                    v774.p204.push(v775);
                v772.push(v774);
            }
            else {
                const v776 = Gl80(v773);
                if (v776.length === 0) {
                }
                else if (v776.length === 1)
                    v772.push(v776[0]);
                else
                    v772.push({ p202: null, p203: v773, p204: v776 });
            }
        }
        return v772;
    }
    return Gl80(null);
}
function Va81(v777: Og77, v778: string[], v779: number, v780: Array<{
    p205: string;
    p206: number;
}>, v781: Set<string>, v782: {
    p207?: boolean;
} = {}): void {
    const v783 = 's92'.repeat(v779);
    const v784 = Dx78(v777);
    const v785 = Sa72(v784);
    const v786 = v784 || 's354';
    const v787 = v777.p202 !== null ? (v781.has(v784) ? 's355' : 's356') : '';
    if (v777.p204.length === 0) {
        v778.push(`${v783}${v785}s93${v786}s94${v787}`);
    }
    else if (v782.p207 && v777.p202 !== null) {
        v778.push(`${v783}${v785}s93${v786}s94${v787}`);
        for (const v788 of v777.p204) {
            Va81(v788, v778, v779, v780, v781);
        }
    }
    else {
        const v789 = `${v785}s357`;
        v780.push({ p205: v789, p206: v779 });
        v778.push(`${v783}s358${v789}s93${v786}s94`);
        if (v777.p202 !== null) {
            v778.push(`${v783}s92${v785}s93${v786}s94${v787}`);
        }
        for (const v790 of v777.p204) {
            Va81(v790, v778, v779 + 1, v780, v781);
        }
        v778.push(`${v783}s359`);
    }
}
export function Av82(v791: Az204, v792: Dh70 = {}): string {
    const v793: string[] = [];
    v793.push('s360');
    v793.push('s91');
    v793.push('');
    const v794 = v791.p458.filter((v795) => v795.p1 !== 's361');
    const v796 = v791.p458.filter((v797) => v797.p1 === 's361');
    const v798 = new Set(v791.p460.flatMap((v799) => v799.p550));
    const v800: Array<{
        p205: string;
        p206: number;
    }> = [];
    const v801 = Ak79(v794);
    const v802 = new Map<string, Og77[]>();
    const v803: Og77[] = [];
    for (const v804 of v801) {
        const v805 = Ah76(Dx78(v804), v792.p201);
        if (!v805) {
            v803.push(v804);
            continue;
        }
        if (!v802.has(v805.p130)) {
            v802.set(v805.p130, []);
        }
        v802.get(v805.p130)?.push(v804);
    }
    for (const [v806, v807] of v802.entries()) {
        const v808 = `s246${Sa72(v806)}`;
        v800.push({ p205: v808, p206: 1 });
        v793.push(`s245${v808}s93${v806}s94`);
        for (const v809 of v807) {
            Va81(v809, v793, 2, v800, v798, {
                p207: v809.p202 !== null && Dx78(v809) === v806,
            });
        }
        v793.push('s248');
    }
    for (const v810 of v803) {
        Va81(v810, v793, 1, v800, v798);
    }
    if (v796.length > 0) {
        v793.push('s362');
        for (const v811 of v796) {
            const v812 = Sa72(v811.p205);
            const v813 = v811.p205;
            v793.push(`s247${v812}s93${v813}s363`);
        }
        v793.push('s248');
    }
    v793.push('s364');
    v793.push('s365');
    v793.push('s366');
    if (v796.length > 0) {
        v793.push('s367');
    }
    if (v798.size > 0) {
        v793.push('s368');
    }
    v793.push('s369');
    v793.push('s248');
    v793.push('s370');
    v793.push('');
    for (const { p205: v814, p206: v815 } of v800) {
        const v816 = Math.min(v815 - 1, Me71.length - 1);
        v793.push(`s371${v814}s99${Me71[v816]}`);
    }
    if (v796.length > 0) {
        v793.push(`s372`);
    }
    v793.push('');
    v793.push('s373');
    v793.push('s374');
    v793.push('s375');
    v793.push('');
    const v817: Array<Set<string>> = v791.p460.map((v818) => new Set(v818.p550));
    const v819 = (v820: Mu206): boolean => v817.some((v821) => v821.has(v820.p6) && v821.has(v820.p7));
    const v822: Mu206[] = [];
    const v823: Mu206[] = [];
    for (const v824 of v791.p459) {
        if (v819(v824)) {
            v823.push(v824);
        }
        else {
            v822.push(v824);
        }
    }
    let v825 = 0;
    const v826: number[] = [];
    for (const v827 of v822) {
        const v828 = Sa72(v827.p6);
        const v829 = Sa72(v827.p7);
        const v830 = Ck73(v827.p465);
        const v831 = v827.p465 > 1 ? `s376${v827.p465}s377` : '';
        v793.push(`s92${v828}s99${v830}${v831}s99${v829}`);
        v825++;
    }
    for (const v832 of v823) {
        const v833 = Sa72(v832.p6);
        const v834 = Sa72(v832.p7);
        const v835 = Ck73(v832.p465);
        const v836 = v832.p465 > 1 ? `s376${v832.p465}s377` : '';
        v793.push(`s92${v833}s99${v835}${v836}s99${v834}`);
        v826.push(v825);
        v825++;
    }
    if (v826.length > 0) {
        v793.push('');
        for (const v837 of v826) {
            v793.push(`s378${v837}s379`);
        }
    }
    v793.push('');
    return v793.join('s33');
}
