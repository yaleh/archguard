import type { Vw210 } from '../d8/f54';
import type { Jw85, Zf86 } from './f25';
export function Ln47(v253: Vw210, v254: Jw85): Zf86[] {
    if (v254.p208.length === 0) {
        return [
            {
                p19: 's226',
                p210: v253.p210.map((v255) => v255.p205),
                p211: 's227',
            },
        ];
    }
    return v254.p208.map((v256) => ({
        p19: v256.p19,
        p210: v256.p210.filter((v257) => v253.p210.some((v258) => v258.p205 === v257)),
        p211: v256.p211,
    }));
}
