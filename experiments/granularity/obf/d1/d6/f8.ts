import type { Fo143 } from '../d8/f48';
export class Lw28 {
    m93(v103: Fo143): string {
        const v104 = v103.p51;
        if (!v104)
            return '';
        let v105 = 's47';
        v105 += `s48${v104.p380 || v103.p19}s49`;
        if (v104.p381) {
            v105 += `s48${v104.p381}s49`;
        }
        v105 += 's50';
        if (v104.p382) {
            v105 += `s51${v104.p382}s49`;
        }
        if (v104.p383 && v104.p383.length > 0) {
            v105 += `s52${v104.p383.join('s29')}s49`;
        }
        if (v104.p384 || v104.p387) {
            v105 += 's47';
            if (v104.p384) {
                v105 += `s53`;
                v105 += `s54${v104.p384.p1}s49`;
                if (v104.p384.p385) {
                    v105 += `s55${v104.p384.p385}s49`;
                }
                if (v104.p384.p386) {
                    v105 += `s56${v104.p384.p386}s49`;
                }
            }
            if (v104.p387) {
                v105 += `s57`;
                v105 += `s55${v104.p387.p385}s49`;
                if (v104.p387.p388) {
                    v105 += `s58${v104.p387.p388.join('s29')}s49`;
                }
                if (v104.p387.p386) {
                    v105 += `s56${v104.p387.p386}s49`;
                }
            }
            v105 += 's47';
        }
        return v105;
    }
    m94(v106: Fo143): string {
        const v107 = v106.p423;
        if (!v107?.p390 || v107.p390.length === 0) {
            return '';
        }
        let v108 = 's47';
        v108 += `s59${v107.p390.length}s60`;
        v108 += 's50';
        if (v107.p389) {
            v108 += `s61${v107.p389}s49`;
        }
        v108 += 's33';
        for (const v109 of v107.p390) {
            v108 += `s48${v109.p19}s62${v109.p393}s60`;
            v108 += `s63${v109.p394.join('s29')}s49`;
            v108 += `s55${v109.p385}s49`;
            if (v109.p395) {
                v108 += `s64${v109.p395}s49`;
            }
            v108 += 's33';
        }
        if (v107.p391 && v107.p391.length > 0) {
            v108 += 's65';
            for (const v110 of v107.p391) {
                v108 += `s66${v110}s49`;
            }
        }
        v108 += 's50';
        return v108;
    }
    m95(v111: Fo143): string {
        const v112 = v111.p424;
        if (!v112)
            return '';
        let v113 = 's47';
        v113 += 's67';
        v113 += 's50';
        if (v112.p401) {
            v113 += `s68${v112.p401}s49`;
        }
        if (v112.p400 && v112.p400.length > 0) {
            v113 += 's33';
            for (const v114 of v112.p400) {
                v113 += `s69${v114.p403}s70${v114.p19}s49`;
                v113 += `s48${v114.p385}s49`;
                if (v114.p404) {
                    v113 += `s71${v114.p404}s49`;
                }
                if (v114.p390 && v114.p390.length > 0) {
                    v113 += `s72${v114.p390.join('s29')}s49`;
                }
            }
        }
        if (v112.p402 && v112.p402.length > 0) {
            v113 += 's73';
            for (const v115 of v112.p402) {
                v113 += `s66${v115}s49`;
            }
        }
        v113 += 's47';
        return v113;
    }
    m96(v116: Fo143): string {
        const v117 = v116.p51;
        const v118 = v116.p424;
        if (!v117?.p382 && !v118?.p401) {
            return '';
        }
        let v119 = 's47';
        v119 += 's74';
        v119 += 's50';
        if (v117?.p382) {
            v119 += `s51${v117.p382}s49`;
        }
        if (v117?.p384?.p386) {
            v119 += `s75${v117.p384.p386}s49`;
        }
        if (v118?.p401) {
            v119 += `s76${v118.p401}s49`;
        }
        if (v117?.p387?.p386) {
            v119 += `s77${v117.p387.p386}s49`;
        }
        v119 += 's47';
        return v119;
    }
    m97(v120: Fo143): string {
        const v121: string[] = [];
        v121.push(this.m93(v120));
        v121.push(this.m95(v120));
        v121.push(this.m94(v120));
        v121.push(this.m96(v120));
        return v121.filter((v122) => v122.length > 0).join('s33');
    }
    m98(v123: Fo143): string {
        if (!v123.p425?.p409) {
            return '';
        }
        const v124 = v123.p51;
        if (!v124) {
            return '';
        }
        const v125 = v123.p425.p410 || [
            'p380',
            'p381',
            'p382',
            'p384',
            'p387',
            'p390',
            'p391',
            'p424',
        ];
        const v126: string[] = [];
        if (v125.includes('p380')) {
            if (v124.p380) {
                v126.push(`s78${v124.p380}s78`);
            }
            else {
                v126.push(`s78${v123.p19}s78`);
            }
        }
        if (v125.includes('p381') && v124.p381) {
            v126.push(v124.p381);
        }
        if (v125.includes('p382') && v124.p382) {
            v126.push(`s79${v124.p382}`);
        }
        if (v125.includes('p384') && v124.p384) {
            if (v124.p384.p1) {
                v126.push(`s80${v124.p384.p1}`);
                if (v124.p384.p386) {
                    v126.push(`s81${v124.p384.p386}`);
                }
            }
        }
        if (v125.includes('p387') && v124.p387) {
            if (v124.p387.p385) {
                v126.push(`s82${v124.p387.p385}`);
            }
            if (v124.p387.p388) {
                v126.push(`s83${v124.p387.p388.join('s29')}`);
            }
        }
        if (v125.includes('p390')) {
            const v127 = v123.p423;
            if (v127?.p390 && v127.p390.length > 0) {
                const v128 = v127.p390.map((v129) => v129.p19).join('s29');
                v126.push(`s84${v128}`);
            }
        }
        if (v125.includes('p391')) {
            const v130 = v123.p423;
            if (v130?.p391 && v130.p391.length > 0) {
                v126.push(`s85${v130.p391.join('s29')}`);
            }
        }
        if (v125.includes('p424')) {
            const v131 = v123.p424;
            if (v131?.p401) {
                v126.push(`s86${v131.p401}`);
            }
        }
        if (v126.length === 0) {
            return '';
        }
        const v132 = v126.join('s33');
        return `s87${v132}s88`;
    }
}
