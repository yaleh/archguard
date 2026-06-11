import v1490 from 'pkg16';
import v1491 from 'pkg17';
import v1492 from 'pkg18';
export interface Ix226 {
    p593: string;
    p102: Record<string, string[]>;
}
export function Kx227(v1493: string): string | undefined {
    let v1494 = v1490.resolve(v1493);
    const { root: v1495 } = v1490.parse(v1494);
    while (true) {
        const v1496 = v1490.join(v1494, 's563');
        if (v1491.existsSync(v1496))
            return v1496;
        if (v1494 === v1495)
            return undefined;
        v1494 = v1490.dirname(v1494);
    }
}
export function Zv228(v1497: string): Ix226 | undefined {
    try {
        const v1498 = v1490.dirname(v1497);
        const v1499 = v1491.readFileSync(v1497, 's564');
        const v1500 = v1492.parseConfigFileTextToJson(v1497, v1499);
        if (v1500.error)
            return undefined;
        const v1501 = v1500.config as {
            p594?: {
                p593?: string;
                p102?: Record<string, string[]>;
            };
        };
        const v1502 = v1501.p594 ?? {};
        if (!v1502.p102 && !v1502.p593)
            return undefined;
        return {
            p593: v1502.p593 ? v1490.resolve(v1498, v1502.p593) : v1498,
            p102: v1502.p102 ?? {},
        };
    }
    catch {
        return undefined;
    }
}
