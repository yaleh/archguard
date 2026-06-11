import type { Jw214, Ti212, Uu216, Yf221 } from '../d8/f54';
export const Pk35: Record<string, string> = {
    p597: 's186',
    p598: 's187',
    p599: 's188',
    p600: 's186',
    p601: 's187',
    p602: 's189',
    p603: 's190',
};
export function Bu36(v210: Ti212): string {
    return v210 === 's23' ? 'p597' : v210;
}
export function Sh37(v211: string): string {
    if (v211.startsWith('s191')) {
        const v212 = v211.match(/r27/);
        if (v212) {
            return v212[1];
        }
    }
    if (v211.startsWith('s192')) {
        const v213 = v211.split('s193');
        const v214 = v213[v213.length - 1];
        if (v214)
            return v214;
    }
    const v215 = v211.match(/r28/);
    if (v215) {
        return v215[1];
    }
    if (v211.startsWith('s41') || v211.includes('s194')) {
        return 's195';
    }
    return v211;
}
export function Uk38(v216: string): string {
    if (!v216)
        return 's196';
    return v216.replace(/r29/, '').replace(/r30/, 's44');
}
export function Yy39(v217: string): string {
    v217 = v217.replace(/r31/, 's37');
    v217 = v217.replace(/r32/, 's37');
    return v217;
}
export function Is40(v218: string): string {
    if (!v218)
        return 's197';
    let v219 = Yy39(v218);
    let v220: number;
    do {
        v220 = v219.length;
        v219 = v219.replace(/r33/, 'object');
    } while (v219.length !== v220 && v219.includes('s41'));
    const v221 = /r34/;
    if (v221.test(v219))
        return 's197';
    v219 = v219.replace(/r35/, 's198');
    while (v219.includes('s199')) {
        v219 = v219.replace(/r36/, 's37');
        v219 = v219.replace(/r37/, 's197');
    }
    if (v219.includes('s200'))
        return 's197';
    if (v219.includes('s201'))
        return 'object';
    let v222: number;
    do {
        v222 = v219.length;
        v219 = v219.replace(/r38/, 's180');
    } while (v219.length !== v222);
    v219 = v219.replace(/r39/, 's180');
    v219 = v219.replace(/r40/, 's180');
    while (v219.match(/r41/)) {
        v219 = v219.replace(/r36/, 's37');
    }
    v219 = v219.replace(/r42/, 's197');
    v219 = v219.replace(/r4/, 's99').trim();
    if (v219.length > 50 || v219 === '')
        return 's197';
    return v219;
}
export function Sz41(v223: Uu216, v224: {
    p114: boolean;
    p115: boolean;
}): boolean {
    if (v223.p414 === 's202' && !v224.p114)
        return false;
    if (v223.p414 === 's203' && !v224.p115)
        return false;
    return true;
}
export function Be42(v225: Uu216['p414']): string {
    switch (v225) {
        case 's204':
            return 's205';
        case 's202':
            return 's206';
        case 's203':
            return 's207';
        default:
            return 's205';
    }
}
export function Qo43(v226: Uu216): string {
    const v227 = Be42(v226.p414);
    const v228 = v226.p566 ? 's208' : '';
    const v229 = v226.p560 ? 's209' : '';
    if (v226.p1 === 's210') {
        const v230 = v226.p568 ? 's211' : '';
        const v231 = v226.p569 ? 's212' : '';
        const v232 = v226.p477 ? `s70${Is40(v226.p477)}` : '';
        return `${v227}${v228}${v229}${v230}${v226.p19}${v231}${v232}`;
    }
    if (v226.p1 === 'p499' || v226.p1 === 's213') {
        const v233 = v226.p567 ? 's214' : '';
        const v234 = v226.p479 ? `s70${Is40(v226.p479)}` : '';
        const v235 = v226.p565
            ?.map((v236) => {
            const v237 = v236.p569 ? 's212' : '';
            const v238 = v236.p1 ? `s70${Is40(v236.p1)}` : '';
            return `${v236.p19}${v237}${v238}`;
        })
            .join('s29') || '';
        return `${v227}${v228}${v229}${v233}${v226.p19}s45${v235}s46${v234}`;
    }
    return `${v227}${v226.p19}`;
}
export function Tc44(v239: Yf221, v240: Map<string, string>): string {
    const v241 = (v242: string): string => Uk38(Sh37(v240.get(v242) ?? v242));
    const v243 = v241(v239.p22);
    const v244 = v241(v239.p473);
    switch (v239.p1) {
        case 's215':
            return `${v244}s216${v243}`;
        case 's217':
            return `${v244}s218${v243}`;
        case 's96':
            return `${v243}s219${v244}`;
        case 's97':
            return `${v243}s220${v244}`;
        case 's221':
        default:
            return `${v243}s222${v244}`;
    }
}
export function Kr45(v245: string): boolean {
    return (v245.startsWith('s41') ||
        v245.startsWith('s223') ||
        v245.startsWith('s224') ||
        v245.startsWith('s45') ||
        v245.includes('s194') ||
        /r43/.test(v245) ||
        /r44/.test(v245) ||
        /r45/.test(v245));
}
export function Si46(v246: Jw214, v247: number, v248: {
    p114: boolean;
    p115: boolean;
}): string[] {
    const v249: string[] = [];
    const v250 = 's92'.repeat(v247);
    const v251 = Uk38(Sh37(v246.p19));
    v249.push(`${v250}s225${v251}s42`);
    for (const v252 of v246.p557 || []) {
        if (!Sz41(v252, v248))
            continue;
        v249.push(`${v250}s92${Qo43(v252)}`);
    }
    v249.push(`${v250}s35`);
    return v249;
}
