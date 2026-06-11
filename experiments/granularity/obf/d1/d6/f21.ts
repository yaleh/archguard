import { v4, v5 } from 'pkg3';
import v669 from 'pkg6';
import { Bz55 } from './f18';
import type { Gx58, Mr59, Vl60 } from './f20';
const Im64 = v4 as Gx58;
v669.x23({
    startOnLoad: false,
    theme: (Im64.p123 ?? 's26') as 's26' | 's307' | 's308' | 's309' | 's310' | 's311',
    securityLevel: 's312',
    maxTextSize: Im64.p165 ?? 200000,
    themeVariables: Im64.p167,
});
const Nb65 = async (v670: Mr59): Promise<void> => {
    try {
        const { svg: v671 } = await v669.x24(v670.p168, v670.p106);
        const v672 = Bz55(v671, Im64.p166);
        v5.postMessage({ p168: v670.p168, p169: true, p104: v672 } satisfies Vl60);
    }
    catch (Bj66) {
        v5.postMessage({
            p168: v670.p168,
            p169: false,
            p170: Bj66 instanceof Error ? Bj66.message : String(Bj66),
        } satisfies Vl60);
    }
};
v5.on('p5', (v673: Mr59) => {
    Nb65(v673).catch((v674) => {
        const v675 = v674 instanceof Error ? v674.message : String(v674);
        v5.postMessage({
            p168: v673.p168,
            p169: false,
            p170: `s313${v675}`,
        } satisfies Vl60);
    });
});
