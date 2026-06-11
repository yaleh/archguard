import v273 from 'pkg2';
import type { Vw210, Jw214, Uu216, Yf221 } from '../d8/f54';
import type { Fo143 } from '../d8/f48';
import { Bu8, Gq7 } from '../d4/f2';
import type { Io83, Jw85, Zf86, Rp99, Iz100, } from './f25';
import { Lw28 } from './f8';
import { Ln47 } from './f13';
import { Rx48 } from './f14';
const Bm49: Record<string, string> = {
    p597: 's186',
    p598: 's187',
    p599: 's188',
    p600: 's186',
    p601: 's187',
    p602: 's189',
    p603: 's190',
};
function Dn50(v274: string, v275: Gq7 = Bu8): string {
    if (v274 === 's23')
        return 'p597';
    if (v274 in Bm49)
        return v274;
    const v276 = v275.m16(v274);
    if (v276?.p34 && v276.p34 !== 's26') {
        return v276.p34 === 's24' ? 'p598' : 'p597';
    }
    return 'p597';
}
export class Hs51 {
    private readonly p116: Vw210;
    private readonly p117: Required<Rp99>;
    private readonly p118?: Fo143;
    private readonly p119: Lw28;
    private readonly p50: boolean;
    private p120: Map<string, string> | null = null;
    constructor(v277: Vw210, v278: {
        p121: Io83;
        p122: Jw85;
        p123?: Iz100;
        p114?: boolean;
        p115?: boolean;
        p124?: number;
        p50?: boolean;
    }, v279?: Fo143) {
        this.p116 = v277;
        this.p117 = {
            p121: v278.p121,
            p122: v278.p122,
            p123: v278.p123 || { p19: 's26' },
            p114: v278.p114 ?? true,
            p115: v278.p115 ?? true,
            p124: v278.p124 ?? 3,
        };
        this.p118 = v279;
        this.p50 = v278.p50 ?? false;
        this.p119 = new Lw28();
    }
    m99(): string {
        Rx48(this.p116, this.p50);
        let v280: string;
        switch (this.p117.p121) {
            case 'p440':
                v280 = this.m125();
                break;
            case 'p499':
                v280 = this.m133();
                break;
            case 's23':
            default:
                v280 = this.m132();
                break;
        }
        const v281 = v280.split('s33');
        const v282 = v281.shift() || 's109';
        const v283: string[] = [v282];
        if (this.p118 && this.p118.p425?.p405 !== false) {
            const v284 = this.p119.m97(this.p118);
            if (v284) {
                v283.push(v284);
                v283.push('');
            }
        }
        v283.push(...v281);
        if (this.p118 && this.p118.p425?.p409) {
            const v285 = this.p119.m98(this.p118);
            if (v285) {
                const v286 = this.p118.p425.p411 || 's237';
                if (v286 === 's237') {
                    v283.push(v285);
                }
                else {
                    const v287 = v283.findIndex((v288) => !v288.startsWith('s43') && v288 !== v282);
                    if (v287 !== -1) {
                        v283.splice(v287, 0, v285);
                    }
                }
            }
        }
        const v289 = v283.join('s33');
        return this.m150(v289);
    }
    private m125(): string {
        if (this.m126()) {
            return this.m131();
        }
        const v290: string[] = ['s109'];
        const v291 = Ln47(this.p116, this.p117.p122);
        for (const v292 of v291) {
            const v293: string[] = [];
            for (const v294 of v292.p210) {
                const v295 = this.p116.p210.find((v296) => v296.p205 === v294);
                if (v295) {
                    v293.push(`s238${this.m145(this.m136(v295.p19))}`);
                }
            }
            if (v293.length === 0)
                continue;
            v290.push(`s239${this.m145(v292.p19)}s42`);
            v290.push(...v293);
            v290.push('s240');
        }
        v290.push(...this.m141(v291));
        return v290.join('s33');
    }
    private m126(): Record<string, string> | undefined {
        const v297 = this.p116.p555?.p436?.p201;
        return v297 && Object.keys(v297).length > 0 ? v297 : undefined;
    }
    private m127(v298: string): string {
        const v299 = v298.replace(/r46/, 's110');
        const v300 = this.p116.p48?.replace(/r46/, 's110');
        if (v300 && v273.isAbsolute(v298)) {
            return v273.posix.dirname(v273.posix.relative(v300, v299));
        }
        return v273.posix.dirname(v299);
    }
    private m128(v301: string, v302: Record<string, string>): {
        p129: string;
        p130: string;
    } | null {
        const v303 = v301.replace(/r46/, 's110');
        const v304 = Object.entries(v302)
            .map(([v305, v306]) => ({ p129: v305.replace(/r46/, 's110'), p130: v306 }))
            .filter(({ p129: v307 }) => v303 === v307 || v303.startsWith(`${v307}s110`))
            .sort((v308, v309) => v309.p129.length - v308.p129.length);
        return v304[0] ?? null;
    }
    private m131(): string {
        const v310 = this.m126();
        if (!v310) {
            return this.m125();
        }
        const v311 = this.p117.p122.p209?.p212 ?? 's241';
        const v312: string[] = [`s242${v311}`];
        const v313 = new Map<string, string>();
        const v314: string[] = [];
        const v315 = new Set<string>();
        for (const v316 of this.p116.p210) {
            const v317 = v316.p558?.p329;
            if (!v317)
                continue;
            const v318 = this.m127(v317);
            if (!v318 || v318 === 's243')
                continue;
            v313.set(v316.p205, v318);
            v313.set(v316.p19, v318);
            if (!v315.has(v318)) {
                v315.add(v318);
                v314.push(v318);
            }
        }
        const v319 = new Map<string, string[]>();
        const v320: string[] = [];
        for (const v321 of v314) {
            const v322 = this.m128(v321, v310);
            if (!v322) {
                v320.push(v321);
                continue;
            }
            if (!v319.has(v322.p130)) {
                v319.set(v322.p130, []);
            }
            v319.get(v322.p130)?.push(v321);
        }
        const v323 = (v324: string) => this.m145(`s244${v324}`);
        for (const [v325, v326] of v319.entries()) {
            if (v326.length === 0)
                continue;
            v312.push(`s245${this.m145(`s246${v325}`)}s93${v325}s94`);
            for (const v327 of v326) {
                v312.push(`s247${v323(v327)}s93${v327}s94`);
            }
            v312.push('s248');
        }
        for (const v328 of v320) {
            v312.push(`s92${v323(v328)}s93${v328}s94`);
        }
        const v329 = new Set<string>();
        for (const v330 of this.p116.p554) {
            const v331 = v313.get(v330.p22) ??
                v313.get(this.m136(v330.p22));
            const v332 = v313.get(v330.p473) ??
                v313.get(this.m136(v330.p473));
            if (!v331 || !v332 || v331 === v332) {
                continue;
            }
            const v333 = `s92${v323(v331)}s222${v323(v332)}`;
            if (!v329.has(v333)) {
                v329.add(v333);
                v312.push(v333);
            }
        }
        return v312.join('s33');
    }
    private m132(): string {
        const v334: string[] = ['s109'];
        for (const [v335, v336] of Object.entries(Bm49)) {
            v334.push(`s249${v335}s99${v336}`);
        }
        v334.push('');
        const v337 = Ln47(this.p116, this.p117.p122);
        const v338 = this.p116.p210.filter((v339) => v339.p1 !== 'function');
        const v340 = new Set(v338.map((v341) => v341.p19));
        const v342 = new Set(v338.map((v343) => v343.p205));
        const v344 = this.m140(v342);
        if (v337.length > 0 && v337[0]?.p19 !== 's226') {
            for (const v345 of v337) {
                const v346: string[] = [];
                for (const v347 of v345.p210) {
                    const v348 = v338.find((v349) => v349.p205 === v347);
                    if (v348) {
                        v346.push(...this.m134(v348, 2, true));
                    }
                }
                if (v346.length === 0)
                    continue;
                v334.push(`s239${this.m145(v345.p19)}s42`);
                v334.push(...v346);
                v334.push('s240');
            }
            for (const v350 of this.p116.p554) {
                const v351 = v340.has(v350.p22) || v342.has(v350.p22);
                const v352 = !v351 && v344.has(v350.p22);
                const v353 = v351 || v352;
                const v354 = v342.has(v350.p473) ||
                    v340.has(v350.p473) ||
                    v352 ||
                    !this.m139(v350.p473);
                if (v353 && v354) {
                    v334.push(`s92${this.m138(v350)}`);
                }
            }
        }
        else {
            for (const v355 of v338) {
                v334.push(...this.m134(v355, 1, true));
            }
            for (const v356 of this.p116.p554) {
                const v357 = v340.has(v356.p22) || v342.has(v356.p22);
                const v358 = !v357 && v344.has(v356.p22);
                const v359 = v357 || v358;
                const v360 = v342.has(v356.p473) ||
                    v340.has(v356.p473) ||
                    v358 ||
                    !this.m139(v356.p473);
                if (v359 && v360) {
                    v334.push(`s92${this.m138(v356)}`);
                }
            }
        }
        v334.push('');
        v334.push('s250');
        const v361 = new Set<string>();
        for (const v362 of v338) {
            const v363 = this.m145(this.m136(v362.p19));
            if (v361.has(v363))
                continue;
            v361.add(v363);
            v334.push(`s251${v363}s252${Dn50(v362.p1)}`);
        }
        return v334.join('s33');
    }
    private m133(): string {
        const v364: string[] = ['s109'];
        for (const [v365, v366] of Object.entries(Bm49)) {
            v364.push(`s249${v365}s99${v366}`);
        }
        v364.push('');
        const v367 = Ln47(this.p116, this.p117.p122);
        const v368 = this.p116.p210.filter((v369) => v369.p1 !== 'function');
        const v370 = new Set(v368.map((v371) => v371.p19));
        const v372 = new Set(v368.map((v373) => v373.p205));
        if (v367.length > 0 && v367[0]?.p19 !== 's226') {
            for (const v374 of v367) {
                const v375: string[] = [];
                for (const v376 of v374.p210) {
                    const v377 = v368.find((v378) => v378.p205 === v376);
                    if (v377) {
                        v375.push(...this.m134(v377, 2, true));
                    }
                }
                if (v375.length === 0)
                    continue;
                v364.push(`s239${this.m145(v374.p19)}s42`);
                v364.push(...v375);
                v364.push('s240');
            }
        }
        else {
            for (const v379 of v368) {
                v364.push(...this.m134(v379, 1, true));
            }
        }
        const v380 = this.m140(v372);
        for (const v381 of this.p116.p554) {
            const v382 = v370.has(v381.p22) || v372.has(v381.p22);
            const v383 = !v382 && v380.has(v381.p22);
            const v384 = v382 || v383;
            if (v384 && (v383 || !this.m139(v381.p473))) {
                v364.push(`s92${this.m138(v381)}`);
            }
        }
        v364.push('');
        v364.push('s250');
        const v385 = new Set<string>();
        for (const v386 of v368) {
            const v387 = this.m145(this.m136(v386.p19));
            if (v385.has(v387))
                continue;
            v385.add(v387);
            v364.push(`s251${v387}s252${Dn50(v386.p1)}`);
        }
        return v364.join('s33');
    }
    private m134(v388: Jw214, v389: number, v390 = false): string[] {
        const v391: string[] = [];
        const v392 = 's92'.repeat(v389);
        const v393 = this.m145(this.m136(v388.p19));
        const v394 = 's23';
        v391.push(`${v392}${v394}s99${v393}s42`);
        const v395 = v388.p557 || [];
        for (const v396 of v395) {
            if (!this.m143(v396)) {
                continue;
            }
            const v397 = this.m135(v396, v390);
            v391.push(`${v392}s92${v397}`);
        }
        v391.push(`${v392}s35`);
        return v391;
    }
    private m135(v398: Uu216, v399: boolean): string {
        const v400 = this.m144(v398.p414);
        const v401 = v398.p566 ? 's208' : '';
        const v402 = v398.p560 ? 's209' : '';
        if (v398.p1 === 's210') {
            const v403 = v398.p568 ? 's211' : '';
            const v404 = v398.p569 ? 's212' : '';
            const v405 = v398.p477 ? `s70${this.m146(v398.p477)}` : '';
            return `${v400}${v401}${v402}${v403}${v398.p19}${v404}${v405}`;
        }
        else if (v398.p1 === 'p499' || v398.p1 === 's213') {
            const v406 = v398.p567 ? 's214' : '';
            const v407 = v398.p479 ? `s70${this.m146(v398.p479)}` : '';
            const v408 = v398.p565
                ?.map((v409) => {
                const v410 = v409.p569 ? 's212' : '';
                const v411 = v409.p1 ? `s70${this.m146(v409.p1)}` : '';
                return `${v409.p19}${v410}${v411}`;
            })
                .join('s29') || '';
            return `${v400}${v401}${v402}${v406}${v398.p19}s45${v408}s46${v407}`;
        }
        else {
            return `${v400}${v398.p19}`;
        }
    }
    private m136(v412: string): string {
        if (v412.startsWith('s191')) {
            const v413 = v412.match(/r27/);
            if (v413) {
                return v413[2];
            }
        }
        if (v412.startsWith('s192')) {
            const v414 = v412.split('s193');
            if (v414.length > 0) {
                const v415 = v414[v414.length - 1];
                if (v415 && v415.length > 0) {
                    return v415;
                }
            }
        }
        const v416 = v412.match(/r28/);
        if (v416) {
            return v416[1];
        }
        if (v412.startsWith('s41') || v412.includes('s194')) {
            return 's195';
        }
        return v412;
    }
    private get p137(): Map<string, string> {
        if (!this.p120) {
            this.p120 = new Map(this.p116.p210.map((v417) => [v417.p205, v417.p19]));
        }
        return this.p120;
    }
    private m138(v418: Yf221): string {
        const v419 = (v420: string): string => {
            const v421 = this.p137.get(v420);
            return this.m145(this.m136(v421 ?? v420));
        };
        const v422 = v419(v418.p22);
        const v423 = v419(v418.p473);
        switch (v418.p1) {
            case 's215':
                return `${v423}s216${v422}`;
            case 's217':
                return `${v423}s218${v422}`;
            case 's96':
                return `${v422}s219${v423}`;
            case 's97':
                return `${v422}s220${v423}`;
            case 's221':
            default:
                return `${v422}s222${v423}`;
        }
    }
    private m139(v424: string): boolean {
        return (v424.startsWith('s41') ||
            v424.startsWith('s223') ||
            v424.startsWith('s224') ||
            v424.startsWith('s45') ||
            v424.includes('s194') ||
            /r43/.test(v424) ||
            /r44/.test(v424) ||
            /r45/.test(v424));
    }
    private m140(v425: Set<string>): Map<string, string> {
        const v426 = new Map<string, string>();
        for (const v427 of v425) {
            const v428 = v427.lastIndexOf('s243');
            if (v428 > 0) {
                const v429 = v427.substring(0, v428);
                if (!v426.has(v429)) {
                    v426.set(v429, v427);
                }
            }
        }
        return v426;
    }
    private m141(v430: Zf86[]): string[] {
        const v431: string[] = [];
        const v432 = new Set(this.p116.p210.map((v433) => v433.p19));
        const v434 = new Set(this.p116.p210.map((v435) => v435.p205));
        const v436 = this.m140(v434);
        for (const v437 of this.p116.p554) {
            const v438 = v432.has(v437.p22) || v434.has(v437.p22);
            const v439 = !v438 && v436.has(v437.p22);
            const v440 = v438 || v439;
            if (v440 && (v439 || !this.m139(v437.p473))) {
                v431.push(`s92${this.m138(v437)}`);
            }
        }
        return v431;
    }
    private m142(): Zf86[] {
        if (this.p117.p122.p208.length === 0) {
            return [
                {
                    p19: 's226',
                    p210: this.p116.p210.map((v441) => v441.p205),
                    p211: 's227',
                },
            ];
        }
        return this.p117.p122.p208.map((v442) => ({
            p19: v442.p19,
            p210: v442.p210.filter((v443) => this.p116.p210.some((v444) => v444.p205 === v443)),
            p211: v442.p211,
        }));
    }
    private m143(v445: Uu216): boolean {
        if (v445.p414 === 's202' && !this.p117.p114) {
            return false;
        }
        if (v445.p414 === 's203' && !this.p117.p115) {
            return false;
        }
        return true;
    }
    private m144(v446: Uu216['p414']): string {
        switch (v446) {
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
    private m145(v447: string): string {
        if (!v447)
            return 's196';
        let v448 = v447;
        v448 = v448.replace(/r29/, '');
        return v448.replace(/r30/, 's44');
    }
    private m146(v449: string): string {
        if (!v449)
            return 's197';
        v449 = this.m147(v449);
        let v450 = v449;
        let v451: number;
        do {
            v451 = v450.length;
            v450 = v450.replace(/r33/, 'object');
        } while (v450.length !== v451 && v450.includes('s41'));
        const v452 = /r34/;
        if (v452.test(v450)) {
            return 's197';
        }
        v450 = v450.replace(/r35/, 's198');
        while (v450.includes('s199')) {
            v450 = v450.replace(/r36/, 's37');
            v450 = v450.replace(/r37/, 's197');
        }
        if (v450.includes('s200')) {
            return 's197';
        }
        if (v450.includes('s201')) {
            return 'object';
        }
        let v453: number;
        do {
            v453 = v450.length;
            v450 = v450.replace(/r38/, 's180');
        } while (v450.length !== v453);
        v450 = v450.replace(/r39/, 's180');
        v450 = v450.replace(/r40/, 's180');
        while (v450.match(/r41/)) {
            v450 = v450.replace(/r36/, 's37');
        }
        v450 = v450.replace(/r42/, 's197');
        v450 = v450.replace(/r4/, 's99').trim();
        if (v450.length > 50 || v450 === '') {
            return 's197';
        }
        return v450;
    }
    private m147(v454: string): string {
        const v455 = /r31/;
        v454 = v454.replace(v455, 's37');
        const v456 = /r32/;
        v454 = v454.replace(v456, 's37');
        return v454;
    }
    public m148(v457: number): Array<{
        p19: string | null;
        p149: string;
    }> {
        const v458 = this.p116.p210.filter((v459) => v459.p1 !== 'function');
        const v460 = Ln47(this.p116, this.p117.p122);
        const v461 = new Set(v458.map((v462) => v462.p205));
        const v463 = v460.filter((v464) => v464.p210.some((v465) => v461.has(v465)));
        const v466 = v458.length;
        const v467 = v466 > v457 &&
            v463.length > 1 &&
            !(v463.length === 1 && v463[0].p19 === 's226');
        if (!v467) {
            return [{ p19: null, p149: this.m99() }];
        }
        const v468 = new Set(v458.map((v469) => v469.p205));
        const v470 = new Set(v458.map((v471) => v471.p19));
        const v472: Array<{
            p19: string | null;
            p149: string;
        }> = [];
        for (const v473 of v463) {
            const v474 = new Set(v473.p210);
            const v475 = v458.filter((v476) => v474.has(v476.p205));
            if (v475.length === 0)
                continue;
            const v477 = new Set(v475.map((v478) => v478.p19));
            const v479: string[] = ['s109'];
            for (const [v480, v481] of Object.entries(Bm49)) {
                v479.push(`s249${v480}s99${v481}`);
            }
            v479.push('');
            v479.push(`s239${this.m145(v473.p19)}s42`);
            for (const v482 of v475) {
                v479.push(...this.m134(v482, 2, true));
            }
            v479.push('s240');
            const v483 = this.m140(v468);
            for (const v484 of this.p116.p554) {
                const v485 = v474.has(v484.p22) || v477.has(v484.p22);
                const v486 = !v485 && v483.has(v484.p22);
                const v487 = v485 || v486;
                const v488 = v468.has(v484.p473) || v470.has(v484.p473);
                const v489 = v488 || v486 || !this.m139(v484.p473);
                if (v487 && v489) {
                    v479.push(`s92${this.m138(v484)}`);
                }
            }
            v479.push('');
            v479.push('s250');
            const v490 = new Set<string>();
            for (const v491 of v475) {
                const v492 = this.m145(this.m136(v491.p19));
                if (v490.has(v492))
                    continue;
                v490.add(v492);
                v479.push(`s251${v492}s252${Dn50(v491.p1)}`);
            }
            v472.push({ p19: v473.p19, p149: this.m150(v479.join('s33')) });
        }
        return v472;
    }
    private m150(v493: string): string {
        let v494 = v493.trim();
        v494 = v494.replace(/r14/, 's38');
        return v494;
    }
}
