export type Nu1 = 's1' | 's2' | 's3' | 's4' | 's5' | 's6';
export interface Ir2 {
    p1?: 'p2';
    p2: string;
    p3: Nu1;
    p4: number;
    p5: string;
}
export interface Yn3 {
    p1: 's7';
    p6: string;
    p7: string;
    p5: string;
}
export type Al4 = Ir2 | Yn3;
export interface En5 {
    p8: Al4[];
    p9: boolean;
}
export interface Yg6 {
    p10: Al4;
    p11: boolean;
    p12?: number | string;
    p13?: string;
}
