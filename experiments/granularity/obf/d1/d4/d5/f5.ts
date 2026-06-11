import type { Vw210 } from '../../d8/f54';
export interface Ef20 {
    p48: string;
    p60: string[];
    p61?: string[];
    p62?: string;
    p63?: number;
    p64?: Record<string, unknown>;
}
export interface Rv21 {
    m65(v38: string, v39: Ef20): Promise<Vw210>;
    m66?(v40: string, v41?: string): Vw210;
    m67?(v42: string[]): Promise<Vw210>;
}
