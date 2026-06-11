import type { Rv21 } from './f5';
import type { Sn12 } from './f3';
import type { Ma26 } from './f6';
import type { Ym194 } from '../../d8/d9/f52';
export interface Kd13 {
    p19: string;
    p25: boolean;
    p26: number;
}
export interface Ww14 {
    p27: string;
    p28: string[];
    p29: 's19' | 's20' | 's21' | 'p456' | 's22';
    p30: Kd13[];
    p31: string[];
    p32?: number;
}
export interface Rg15 {
    p1: string;
    p33: string;
    p34?: 's23' | 's24' | 's25' | 's26';
    p35?: string[];
}
export interface Mk16 {
    p36: boolean;
    p37: boolean;
    p38: boolean;
    p39: boolean;
    p40?: boolean;
}
export interface Gk17 {
    p19: string;
    p20: string;
    p41: string;
    p42: string[];
    p43: string;
    p44?: string;
    p45: string;
    p46: Mk16;
    p47?: Rg15[];
}
export interface Lc18 {
    p48: string;
    p49?: string;
    p50?: boolean;
}
export interface Kr19 extends Rv21 {
    readonly p51: Gk17;
    m52(v31: Lc18): Promise<void>;
    m53(v32: string): boolean;
    m54(): Promise<void>;
    readonly p55: readonly string[];
    readonly p56?: Sn12;
    readonly p57?: Ma26;
    m58?(v33: string, v34?: Ym194): boolean;
    m59?(v35: string, v36: string, v37?: Ym194): Ww14 | null;
}
