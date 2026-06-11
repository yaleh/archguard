import type { Vw210 } from '../../d8/f54';
type Se22 = 'p170' | 's27';
export interface Ja23 {
    p68: string;
    p5: string;
    p69?: string;
    p70: 'p170';
}
export interface Kp24 {
    p68: string;
    p5: string;
    p69?: string;
    p70: 's27';
    p71?: string;
}
export interface Dk25 {
    p72: boolean;
    p73: Ja23[];
    p74: Kp24[];
    p75: number;
}
export interface Ma26 {
    m76(v43: Vw210): Dk25;
}
