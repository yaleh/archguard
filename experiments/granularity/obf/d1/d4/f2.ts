import type { Rg15 } from './d5/f4';
export class Gq7 {
    private readonly p14 = new Map<string, Rg15>();
    m15(v28: Rg15): void {
        this.p14.set(v28.p1, v28);
    }
    m16(v29: string): Rg15 | undefined {
        return this.p14.get(v29);
    }
    m17(): string[] {
        return Array.from(this.p14.keys());
    }
    m18(): void {
        this.p14.clear();
    }
}
export const Bu8 = new Gq7();
