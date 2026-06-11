export function Cl53(v554: string): string {
    const v555 = (v556: RegExp, v557: string): string => {
        const v558 = v554.match(v556);
        if (!v558)
            return '';
        for (const v559 of v558[1].split('s283')) {
            const [v560, ...v561] = v559.split('s284');
            if (!v560 || v561.length === 0)
                continue;
            if (v560.trim().toLowerCase() !== v557)
                continue;
            const v562 = v561.join('s284').trim();
            if (v562)
                return v562;
        }
        return '';
    };
    const v563 = v554.match(/r49/);
    let v564 = 's285';
    let v565 = '';
    if (v563) {
        for (const v566 of v563[1].split('s283')) {
            const [v567, ...v568] = v566.split('s284');
            if (!v567 || v568.length === 0)
                continue;
            const v569 = v567.trim().toLowerCase();
            const v570 = v568.join('s284').trim();
            if (!v570)
                continue;
            if (v569 === 's286')
                v564 = v570;
            if (v569 === 's287')
                v565 = v570;
        }
    }
    const v571 = v554.match(/r50/);
    let v572 = 's285';
    let v573 = '';
    if (v571) {
        for (const v574 of v571[1].split('s283')) {
            const [v575, ...v576] = v574.split('s284');
            if (!v575 || v576.length === 0)
                continue;
            const v577 = v575.trim().toLowerCase();
            const v578 = v576.join('s284').trim();
            if (!v578)
                continue;
            if (v577 === 's286')
                v572 = v578;
            if (v577 === 's287')
                v573 = v578;
        }
    }
    let v579 = v554.replace(/r51/, (v580: string, v581: string, v582: string, v583: string) => {
        const v584 = /r52/.test(v582);
        const v585 = /r53/.test(v582);
        if (v584 && (v585 || v565.length === 0))
            return v580;
        const v586 = v582.replace(/r54/, '');
        const v587 = [
            !v584 ? `s288${v564}s283` : '',
            !v585 && v565 ? `s289${v565}s283` : '',
        ].join('');
        return `${v581}${v586 ? v586 + 's283' : ''}${v587}${v583}`;
    });
    v579 = v579.replace(/r55/, (v588: string, v589: string, v590: string, v591: string) => {
        const v592 = /r52/.test(v590);
        const v593 = /r53/.test(v590);
        if (v592 && (v593 || v573.length === 0))
            return v588;
        const v594 = v590.replace(/r54/, '');
        const v595 = [
            !v592 ? `s288${v572}s283` : '',
            !v593 && v573 ? `s289${v573}s283` : '',
        ].join('');
        return `${v589}${v594 ? v594 + 's283' : ''}${v595}${v591}`;
    });
    v579 = v579.replace(/r56/, (v596: string, v597: string, v598: string, v599: string) => {
        if (/r52/.test(v598))
            return v596;
        const v600 = v598.replace(/r54/, '');
        return `${v597}${v600 ? v600 + 's283' : ''}s290${v599}`;
    });
    const v601 = v554.match(/r57/);
    if (v601) {
        const v602 = v601[1]
            .split('s283')
            .map((v603) => v603.trim())
            .filter((v604) => v604.length > 0)
            .join('s283');
        if (v602) {
            v579 = v579.replace(/r58/, (v605: string, v606: string, v607: string, v608: string) => {
                if (/r52/.test(v607))
                    return v605;
                const v609 = v607.replace(/r54/, '');
                return `${v606}${v609 ? v609 + 's283' : ''}${v602}s283${v608}`;
            });
        }
    }
    const v610 = v555(/r59/, 's291');
    if (v610) {
        v579 = v579.replace(/r60/, (v611: string, v612: string, v613: string, v614: string) => {
            if (/r61/.test(v613))
                return v611;
            const v615 = v613.replace(/r54/, '');
            return `${v612}${v615 ? v615 + 's283' : ''}s292${v610}s283${v614}`;
        });
    }
    const v616 = v555(/r62/, 's291');
    if (v616) {
        v579 = v579.replace(/r63/, (v617: string, v618: string, v619: string, v620: string) => {
            if (/r61/.test(v619))
                return v617;
            const v621 = v619.replace(/r54/, '');
            return `${v618}${v621 ? v621 + 's283' : ''}s292${v616}s283${v620}`;
        });
    }
    return v579;
}
function Tp54(v622: string): string {
    const v623 = 'p607';
    const v624 = v622.match(/r64/);
    if (v624) {
        return v622.replace(/r65/, `s293${v623}s294`);
    }
    return v622.replace(/r66/, `s295${v623}s296`);
}
export function Bz55(v625: string, v626: boolean): string {
    const v627 = Cl53(v625);
    if (v626) {
        return v627;
    }
    if (/r67/.test(v627)) {
        return v627;
    }
    return Tp54(v627);
}
