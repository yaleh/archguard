import type { Vw210 } from '../d8/f54';
import type { Ik144, Os146, Fo143 } from '../d8/f48';
import type { Jw85 } from './f25';
import { Lf52 } from './f16';
import { Hs51 } from './f15';
import { Gt107 } from './f26';
import { Ym67 } from './f22';
import { Aj27 } from './f7';
import { type Ed56, Jg57 } from './f19';
export interface Af30 {
    p100: string;
    p101: string;
    p102: {
        p103: string;
        p104: string;
        p105: string;
    };
}
export interface Pz31 {
    p19: string;
    p106: string;
    p107: {
        p103: string;
        p104: string;
        p105: string;
    };
}
export class Vr32 {
    private p108: Ed56;
    constructor(private p109: Ik144, v148?: Ed56) {
        this.p108 = v148 ?? new Jg57();
    }
    async m110(v149: Vw210, v150: Af30, v151: Os146, v152?: Fo143): Promise<Pz31[]> {
        if (!v149.p210 || v149.p210.length === 0) {
            return [];
        }
        const v153 = this.p108;
        try {
            v153.m160('s100');
            const v154 = new Lf52();
            const v155 = v154.m151(v149);
            v153.m161(`s101${v155.p208.length}s102`);
            v153.m160('s103');
            const v156 = new Hs51(v149, {
                p121: v151,
                p122: v155,
                p50: this.p109.p50 || false,
            }, v152);
            const v157 = this.p109.p435 ?? 150;
            const v158 = v151 === 's23' || v151 === 'p499'
                ? v156.m148(v157)
                : [{ p19: null as string | null, p149: v156.m99() }];
            const v159 = v158.length > 1 || v158[0]?.p19 !== null;
            v153.m161(v159
                ? `s104${v158.length}s105`
                : 's106');
            const v160 = v150.p102.p103.replace(/r25/, '');
            if (v159) {
                v153.m161(`s107${v158.length}s108`);
                return v158
                    .filter((v161) => v161.p149.trim().length > 's109'.length)
                    .map(({ p19: v162, p149: v163 }) => {
                    const v164 = (v162 ?? v150.p101).replace(/r26/, 's44');
                    const v165 = v162 === null
                        ? v150.p102
                        : {
                            p103: `${v160}s110${v164}s111`,
                            p104: `${v160}s110${v164}s112`,
                            p105: `${v160}s110${v164}s113`,
                        };
                    return { p19: v164, p106: v163, p107: v165 };
                });
            }
            let v166 = v158[0].p149;
            v153.m160('s114');
            const v167 = new Gt107(this.p109);
            const v168 = await v167.m250(v166, v149);
            if (!v168.p251) {
                v153.m162('s115');
                console.error(v167.m255(v168));
                v153.m160('s116');
                const v169 = v167.m254();
                const v170 = new Aj27(v169);
                try {
                    const v171 = v168.p252
                        .find((v172) => v172.p19 === 'p228')
                        ?.p253?.x3?.x2((v173: any) => ({
                        p5: v173.x4,
                        p213: v173.x5,
                        p214: v173.x6,
                        p70: 'p170' as const,
                    })) || [];
                    v166 = await v170.m78(v166, v171);
                    const v174 = await v167.m250(v166, v149);
                    if (v174.p251) {
                        v153.m161('s117');
                    }
                    else {
                        throw new Error('s118');
                    }
                }
                catch (v175) {
                    v153.m162('s119');
                    const v176 = v168.p252
                        .find((v177) => v177.p19 === 'p228')
                        ?.p253?.x3?.x2((v178: any) => `s120${v178.x4}`)
                        .x7('s33') || 's121';
                    throw new Error(`s122${v176}`);
                }
            }
            else {
                v153.m161('s123');
            }
            const v179 = v168.p252.find((v180) => v180.p19 === 'p230');
            if (v179 && v179.p253) {
                const v181 = v179.p253;
                console.log('s124');
                console.log(`s125${v181.x9?.x8(1) || 's126'}s127`);
                if (v181.x10) {
                    console.log(`s128${v181.x10.x11?.x8(1) || 's126'}s127`);
                    console.log(`s129${v181.x10.x12?.x8(1) || 's126'}s127`);
                    console.log(`s130${v181.x10.x13?.x8(1) || 's126'}s127`);
                    console.log(`s131${v181.x10.x14?.x8(1) || 's126'}s127`);
                }
                if (v181.x15 && v181.x15.x16 > 0) {
                    console.log('s132');
                    for (const v182 of v181.x15.x17(0, 3)) {
                        console.log(`s133${v182.x18 || 's134'}s135${v182.x4}`);
                    }
                    if (v181.x15.x16 > 3) {
                        console.log(`s136${v181.x15.x16 - 3}s137`);
                    }
                }
            }
            return [
                {
                    p19: v150.p101,
                    p106: v166,
                    p107: v150.p102,
                },
            ];
        }
        catch (v183) {
            v153.m162('s138');
            throw v183;
        }
    }
    static async m111(v184: Pz31[], v185: number, v186: Ed56 = new Jg57()): Promise<void> {
        const v187 = (await import('pkg1')).x19;
        try {
            v186.m160(`s139${v184.length}s140${v184.length > 1 ? 's141' : ''}s142`);
            await v187(v184, async (v188) => {
                const v189: any = {};
                v189.x20 = { p19: 's26' };
                v189.x21 = 's143';
                const v190 = new Ym67(v189);
                await v190.m193(v188.p106, v188.p107);
            }, { concurrency: v185 });
            v186.m161(`s144${v184.length}s140${v184.length > 1 ? 's141' : ''}`);
        }
        catch (v191) {
            v186.m162('s145');
            throw v191;
        }
    }
    async m112(v192: Vw210, v193: Af30, v194: Os146, v195?: Fo143): Promise<void> {
        const v196 = this.p108;
        try {
            v196.m160('s103');
            const v197 = await this.m110(v192, v193, v194, v195);
            v196.m161(`s146${v197.length}s147${v197.length > 1 ? 's141' : ''}`);
            v196.m160('s148');
            const v198: any = {};
            if (this.p109.p427) {
                if (this.p109.p427.p123 && typeof this.p109.p427.p123 === 'string') {
                    v198.x20 = { p19: this.p109.p427.p123 };
                }
                else if (this.p109.p427.p123 && typeof this.p109.p427.p123 === 'object') {
                    v198.x20 = this.p109.p427.p123;
                }
                if (this.p109.p427.p166) {
                    v198.x21 = 's143';
                }
            }
            const v199 = (this.p109.p63 || require('s149').x22().x16) * 2;
            await Vr32.m113(v197, v199, v198);
            v196.m161('s150');
            console.log('s151');
            if (v197.length === 1 && v197[0]?.p107 === v193.p102) {
                console.log(`s152${v193.p102.p103}`);
                console.log(`s153${v193.p102.p104}`);
                console.log(`s154${v193.p102.p105}`);
            }
            else {
                for (const v200 of v197) {
                    console.log(`s152${v200.p107.p103}`);
                }
            }
        }
        catch (v201) {
            v196.m162('s138');
            throw v201;
        }
    }
    private static async m113(v202: Pz31[], v203: number, v204: any): Promise<void> {
        const v205 = (await import('pkg1')).x19;
        await v205(v202, async (v206) => {
            const v207 = new Ym67(v204);
            await v207.m193(v206.p106, v206.p107);
        }, { concurrency: v203 });
    }
}
