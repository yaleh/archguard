"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var mermaid_1 = require("mermaid");
console.log('Mermaid imported successfully');
console.log('Mermaid version:', mermaid_1.default.version || 'unknown');
try {
    mermaid_1.default.initialize({
        startOnLoad: false,
    });
    console.log('Mermaid initialized');
    console.log('Calling render...');
    var svg = (await mermaid_1.default.render('graph-div', 'graph TD; A-->B;')).svg;
    console.log('SUCCESS! SVG length:', svg.length);
    console.log('SVG preview:', svg.substring(0, 200));
}
catch (error) {
    console.error('ERROR:', error);
    console.error('Message:', error instanceof Error ? error.message : String(error));
}
