/**
 * SVG post-processing utilities for Mermaid-generated SVGs.
 *
 * Extracted from renderer.ts so that both the main-thread renderer and
 * the worker-pool path can apply the same post-processing uniformly.
 */

/**
 * Inlines fill:none on flowchart edge paths to work around librsvg's
 * limited CSS class-selector support (sharp uses librsvg for SVG→PNG).
 * Without this, <path class="... flowchart-link ..."> gets SVG default
 * fill (black) instead of the CSS-specified fill:none.
 */
export function inlineEdgeStyles(svg: string): string {
  const extractCssProperty = (rulePattern: RegExp, property: string): string => {
    const match = svg.match(rulePattern);
    if (!match) return '';

    for (const decl of match[1].split(';')) {
      const [rawProp, ...rawValueParts] = decl.split(':');
      if (!rawProp || rawValueParts.length === 0) continue;
      if (rawProp.trim().toLowerCase() !== property) continue;
      const value = rawValueParts.join(':').trim();
      if (value) return value;
    }

    return '';
  };

  const flowchartLinkRuleMatch = svg.match(/\.flowchart-link[^{]*\{([^}]+)\}/);
  let flowchartLinkFill = 'none';
  let flowchartLinkStroke = '';
  if (flowchartLinkRuleMatch) {
    for (const decl of flowchartLinkRuleMatch[1].split(';')) {
      const [rawProp, ...rawValueParts] = decl.split(':');
      if (!rawProp || rawValueParts.length === 0) continue;
      const prop = rawProp.trim().toLowerCase();
      const value = rawValueParts.join(':').trim();
      if (!value) continue;
      if (prop === 'fill') flowchartLinkFill = value;
      if (prop === 'stroke') flowchartLinkStroke = value;
    }
  }

  const relationRuleMatch = svg.match(/\.relation[^{]*\{([^}]+)\}/);
  let relationFill = 'none';
  let relationStroke = '';
  if (relationRuleMatch) {
    for (const decl of relationRuleMatch[1].split(';')) {
      const [rawProp, ...rawValueParts] = decl.split(':');
      if (!rawProp || rawValueParts.length === 0) continue;
      const prop = rawProp.trim().toLowerCase();
      const value = rawValueParts.join(':').trim();
      if (!value) continue;
      if (prop === 'fill') relationFill = value;
      if (prop === 'stroke') relationStroke = value;
    }
  }

  // 1. Fix edge bezier path fills: flowchart-link paths have no inline fill:none,
  //    relying on CSS which librsvg (used by sharp) doesn't apply for ID-scoped selectors.
  let result = svg.replace(
    /(<path\b[^>]*class="[^"]*\bflowchart-link\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
    (_: string, pre: string, style: string, post: string) => {
      const hasFill = /\bfill\s*:/.test(style);
      const hasStroke = /\bstroke\s*:/.test(style);
      if (hasFill && (hasStroke || flowchartLinkStroke.length === 0)) return _;
      const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
      const injected = [
        !hasFill ? `fill:${flowchartLinkFill};` : '',
        !hasStroke && flowchartLinkStroke ? `stroke:${flowchartLinkStroke};` : '',
      ].join('');
      return `${pre}${trimmed ? trimmed + ';' : ''}${injected}${post}`;
    }
  );

  // 1b. Fix classDiagram relation paths: Mermaid emits <path class="... relation"
  //     style=";;;"), relying on the CSS rule ".relation { stroke:X; fill:none; }".
  //     When librsvg ignores the ID-scoped selector, the SVG default fill=black
  //     turns the bezier into a thick black polygon in PNG output.
  result = result.replace(
    /(<path\b[^>]*class="[^"]*\brelation\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
    (_: string, pre: string, style: string, post: string) => {
      const hasFill = /\bfill\s*:/.test(style);
      const hasStroke = /\bstroke\s*:/.test(style);
      if (hasFill && (hasStroke || relationStroke.length === 0)) return _;
      const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
      const injected = [
        !hasFill ? `fill:${relationFill};` : '',
        !hasStroke && relationStroke ? `stroke:${relationStroke};` : '',
      ].join('');
      return `${pre}${trimmed ? trimmed + ';' : ''}${injected}${post}`;
    }
  );

  // 2. Fix edge-label background rects: <rect class="background" style=""> have no
  //    inline fill, so librsvg renders them black instead of the CSS-intended transparent.
  //    Only patch rects that have an explicit (possibly empty) style attribute — rects
  //    without a style attribute are dimensionless placeholders and need no change.
  result = result.replace(
    /(<rect\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
    (_: string, pre: string, style: string, post: string) => {
      if (/\bfill\s*:/.test(style)) return _;
      const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
      return `${pre}${trimmed ? trimmed + ';' : ''}fill:none;${post}`;
    }
  );

  // 3. Fix flowchart node container rects: <rect class="basic label-container" style="">
  //    in flowchart LR diagrams rely on the CSS rule ".node rect { fill:X; stroke:Y; }"
  //    which librsvg does not apply for ID-scoped selectors, causing black node boxes.
  //    Extract those properties from the embedded <style> block and inject them inline.
  const nodeRectRuleMatch = svg.match(/\.node\s+rect[^{]*\{([^}]+)\}/);
  if (nodeRectRuleMatch) {
    const nodeProps = nodeRectRuleMatch[1]
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(';');
    if (nodeProps) {
      result = result.replace(
        /(<rect\b[^>]*class="[^"]*\bbasic\b[^"]*\blabel-container\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
        (_: string, pre: string, style: string, post: string) => {
          if (/\bfill\s*:/.test(style)) return _;
          const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
          return `${pre}${trimmed ? trimmed + ';' : ''}${nodeProps};${post}`;
        }
      );
    }
  }

  // 4. Fix node and cluster title alignment: flowchart text labels rely on CSS
  //    rules like ".node .label text { text-anchor: middle; }". Some SVG viewers
  //    ignore these scoped selectors, so labels render from x=0 and appear shifted right.
  const nodeTextAnchor = extractCssProperty(
    /\.node\s+\.label\s+text[^{]*\{([^}]+)\}/,
    'text-anchor'
  );
  if (nodeTextAnchor) {
    result = result.replace(
      /(<g\b[^>]*class="[^"]*\bnode\b[^"]*"[^>]*>[\s\S]*?<g\b[^>]*class="[^"]*\blabel\b[^"]*"[^>]*>[\s\S]*?<text\b[^>]*\bstyle=")([^"]*?)(")/g,
      (_: string, pre: string, style: string, post: string) => {
        if (/\btext-anchor\s*:/.test(style)) return _;
        const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
        return `${pre}${trimmed ? trimmed + ';' : ''}text-anchor:${nodeTextAnchor};${post}`;
      }
    );
  }

  const clusterTextAnchor = extractCssProperty(
    /\.cluster-label\s+text[^{]*\{([^}]+)\}/,
    'text-anchor'
  );
  if (clusterTextAnchor) {
    result = result.replace(
      /(<g\b[^>]*class="[^"]*\bcluster-label\b[^"]*"[^>]*>[\s\S]*?<text\b[^>]*\bstyle=")([^"]*?)(")/g,
      (_: string, pre: string, style: string, post: string) => {
        if (/\btext-anchor\s*:/.test(style)) return _;
        const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
        return `${pre}${trimmed ? trimmed + ';' : ''}text-anchor:${clusterTextAnchor};${post}`;
      }
    );
  }

  return result;
}

/**
 * Inject a white background-color into the SVG root element's style attribute.
 */
function injectBackground(svg: string): string {
  const bg = 'white';
  const styleMatch = svg.match(/<svg[^>]*style="([^"]*)"/);
  if (styleMatch) {
    return svg.replace(/(<svg[^>]*style=")([^"]*)(")/g, `$1$2; background-color: ${bg};$3`);
  }
  return svg.replace(/<svg/, `<svg style="background-color: ${bg};"`);
}

/**
 * Apply all post-processing to a raw Mermaid-rendered SVG:
 * 1. Inline edge styles (librsvg CSS workaround)
 * 2. Optionally inject a white background into the SVG root element
 *
 * @param rawSvg - The raw SVG string from Mermaid
 * @param transparentBackground - When true, skip background injection
 */
export function postProcessSVG(rawSvg: string, transparentBackground: boolean): string {
  const withEdgeStyles = inlineEdgeStyles(rawSvg);
  if (transparentBackground) {
    return withEdgeStyles;
  }
  // Guard: don't double-inject — check only the SVG root element's style attribute,
  // not any occurrence in the document (Mermaid CSS contains background-color:transparent).
  if (/<svg[^>]*style="[^"]*background-color/.test(withEdgeStyles)) {
    return withEdgeStyles;
  }
  return injectBackground(withEdgeStyles);
}
