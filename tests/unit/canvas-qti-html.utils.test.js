const {
  convertCanvasHtml,
  convertCanvasPlainText,
} = require('../../src/utils/canvas-qti-html');

// Canvas quiz exports store question text, options and feedback as HTML inside
// <mattext>. GRASP stores plain text + KaTeX delimiters (every field is escaped
// before RichText renders it), so these tests pin how each piece of Canvas
// markup survives. Inputs are synthetic but copy the shapes in real exports
// (Google Docs paste spans, equation_image attributes, codecogs links).

const R = String.raw;
const ZWSP = '\u200B';

const equationImg = (latex, extra = '') => `<img class="equation_image" title="${latex}" `
  + `src="https://canvas.example.test/equation_images/x" alt="LaTeX: ${latex}" `
  + `data-equation-content="${latex}" loading="lazy"${extra}>`;

const FLATTENED = { code: 'table-flattened', message: 'A table with images or too many cells was flattened to text' };
const TOO_COMPLEX = { code: 'too-complex', message: 'Text with too much formatting was left out' };
const TOO_LONG = { code: 'too-long', message: 'Text that was too long to import was left out' };
const RENUMBERED = { code: 'list-renumbered', message: 'A numbered list used labels that were changed to 1., 2., 3.' };

const remoteImg = (file, alt = 'diagram.png') => `<img src="https://canvas.example.test/assessment_questions/11/files/${file}/download?verifier=abc" alt="${alt}" loading="lazy">`;

describe('convertCanvasHtml: text and whitespace', () => {
  // The XML layer has already decoded once, so a literal "&lt;" typed by the
  // author arrives here as "&amp;lt;" and must stay "&lt;".
  test('decodes HTML entities exactly once', () => {
    expect(convertCanvasHtml('<p>a &lt; b &gt; c &amp;lt; d</p>')).toEqual({
      text: 'a < b > c &lt; d',
      images: [],
      warnings: [],
    });
  });

  test('turns NBSP into a space and collapses whitespace inside a line', () => {
    expect(convertCanvasHtml('<p>Add&nbsp;&nbsp;10\u00a0mL \n\t of   water</p>').text)
      .toBe('Add 10 mL of water');
  });

  test('turns paragraphs, divs, headings and br into single newlines with no blank lines', () => {
    const html = '<div>\n<h3>Part A</h3>\n<p>First line.</p>\n<p>&nbsp;</p>\n<p>Second<br>third<br><br></p>'
      + '<div>fourth</div><blockquote>fifth</blockquote></div>';
    expect(convertCanvasHtml(html).text).toBe('Part A\nFirst line.\nSecond\nthird\nfourth\nfifth');
  });

  test('keeps the line structure of pre', () => {
    expect(convertCanvasHtml('<pre>line  one\nline two</pre>').text).toBe('line one\nline two');
  });

  test('bullets unordered list items and numbers ordered ones from their start', () => {
    // The empty last item must not lend its number to the next paragraph.
    const html = '<p>Choose:</p><ul><li><p>one</p></li><li>two</li></ul>'
      + '<ol start="3"><li>three</li><li>four</li><li></li></ol><p>After</p>';
    expect(convertCanvasHtml(html).text).toBe('Choose:\n• one\n• two\n3. three\n4. four\nAfter');
  });

  test('unwraps inline formatting to its content', () => {
    const html = '<span id="docs-internal-guid-1" style="font-size: 12pt;"><span style="font-family: Arial;">'
      + '<strong>Bold</strong> <em>italic</em> <u>under</u> <font color="#000000">font</font></span></span>';
    expect(convertCanvasHtml(html).text).toBe('Bold italic under font');
  });

  test('silently drops scripts, styles, comments, screen-reader text and stray MathML', () => {
    const html = '<p>Keep<script>alert(1)</script><style>p{}</style><!-- note -->'
      + '<template>t</template><noscript>n</noscript><span class="screenreader-only">sr</span>'
      + '<math><mi>x</mi></math> this</p>';
    expect(convertCanvasHtml(html)).toEqual({ text: 'Keep this', images: [], warnings: [] });
  });

  test('returns an empty result for empty or non-string input', () => {
    const empty = { text: '', images: [], warnings: [] };
    expect(convertCanvasHtml('')).toEqual(empty);
    expect(convertCanvasHtml('  \n ')).toEqual(empty);
    expect(convertCanvasHtml(null)).toEqual(empty);
    expect(convertCanvasHtml('<p>&nbsp;</p>')).toEqual(empty);
  });
});

describe('convertCanvasHtml: ordered list labels', () => {
  // Canvas's editor offers letter and Roman list styles; options such as
  // "I and III only" must still match the stem.
  test('labels ordered list items in the style the author picked', () => {
    const html = '<p>Which statements are true?</p><ol style="list-style-type: upper-roman;">'
      + '<li>Statement one</li><li>Statement two</li><li>Statement three</li></ol>';
    expect(convertCanvasHtml(html)).toEqual({
      text: 'Which statements are true?\nI. Statement one\nII. Statement two\nIII. Statement three',
      images: [],
      warnings: [],
    });
  });

  test.each([
    ['<ol type="a" start="3"><li>x</li><li>y</li></ol>', 'c. x\nd. y'],
    ['<ol type="A"><li>x</li></ol>', 'A. x'],
    ['<ol type="i" start="4"><li>x</li><li>y</li></ol>', 'iv. x\nv. y'],
    ['<ol type="I" start="1994"><li>x</li></ol>', 'MCMXCIV. x'],
    ['<ol style="list-style-type: lower-alpha;" start="3"><li>x</li></ol>', 'c. x'],
    ['<ol style="list-style-type: upper-latin"><li>x</li></ol>', 'A. x'],
    ['<ol style="LIST-STYLE-TYPE: Lower-Roman !important"><li>x</li></ol>', 'i. x'],
    ['<ol style="list-style: inside upper-alpha;"><li>x</li></ol>', 'A. x'],
    // The style attribute wins over type, as in a browser.
    ['<ol type="a" style="color: red; list-style-type: decimal"><li>x</li></ol>', '1. x'],
    ['<ol type="1"><li>x</li></ol>', '1. x'],
    // Not a value <ol type> takes, so a browser ignores it.
    ['<ol type="disc"><li>x</li></ol>', '1. x'],
    ['<ol type="I"><li>Part<ol type="a"><li>sub</li></ol></li><li>Next</li></ol>', 'I. Part\na. sub\nII. Next'],
  ])('labels %s', (html, text) => {
    expect(convertCanvasHtml(html)).toEqual({ text, images: [], warnings: [] });
  });

  test('continues letters past z and writes decimal where a style has no label', () => {
    expect(convertCanvasHtml('<ol type="a" start="26"><li>x</li><li>y</li></ol>').text).toBe('z. x\naa. y');
    expect(convertCanvasHtml('<ol type="A" start="0"><li>x</li><li>y</li></ol>').text).toBe('0. x\nA. y');
    expect(convertCanvasHtml('<ol type="I" start="3999"><li>x</li><li>y</li></ol>').text).toBe('MMMCMXCIX. x\n4000. y');
  });

  test('numbers a list whose labels GRASP cannot write 1., 2., 3. and warns', () => {
    expect(convertCanvasHtml('<ol style="list-style-type: lower-greek;"><li>alpha</li><li>beta</li></ol>')).toEqual({
      text: '1. alpha\n2. beta',
      images: [],
      warnings: [RENUMBERED],
    });
    expect(convertCanvasHtml('<ol style="list-style: none"><li>x</li></ol>')).toEqual({
      text: '1. x',
      images: [],
      warnings: [RENUMBERED],
    });
  });

  test('bullets an unordered list whatever its style', () => {
    expect(convertCanvasHtml('<ul style="list-style-type: upper-roman" type="a"><li>x</li></ul>'))
      .toEqual({ text: '• x', images: [], warnings: [] });
  });
});

describe('convertCanvasHtml: equations', () => {
  test('uses data-equation-content for an inline equation_image', () => {
    const html = `<p>What is ${equationImg(R`\Delta H^\circ`, ' data-mathml="&lt;math&gt;&lt;/math&gt;"')} here?</p>`;
    expect(convertCanvasHtml(html)).toEqual({
      text: R`What is \(\Delta H^\circ\) here?`,
      images: [],
      warnings: [],
    });
  });

  test('falls back to the alt text without its "LaTeX: " prefix', () => {
    const html = R`<p>Given <img class="equation_image" src="https://canvas.example.test/equation_images/x" alt="LaTeX: K_a = 10^{-5}"></p>`;
    expect(convertCanvasHtml(html).text).toBe(R`Given \(K_a = 10^{-5}\)`);
  });

  test('falls back to the double-encoded src path', () => {
    // encodeURIComponent applied twice to "K_{a} = 1", as Canvas writes it.
    const html = '<p><img class="equation_image" src="https://canvas.example.test/equation_images/K_%257Ba%257D%2520%253D%25201?scale=1"></p>';
    expect(convertCanvasHtml(html).text).toBe(R`\(K_{a} = 1\)`);
  });

  test('puts a display-style equation on its own line in \\[ \\]', () => {
    const html = `<p>The reaction ${equationImg(R`2H_2 + O_2 \rightarrow 2H_2O`, ' style="display: block; margin-left: auto;"')} is balanced. `
      + `Also ${equationImg('x', ' style="display:block"')}</p>`;
    expect(convertCanvasHtml(html).text)
      .toBe(R`The reaction` + '\n' + R`\[2H_2 + O_2 \rightarrow 2H_2O\]` + '\nis balanced. Also\n' + R`\[x\]`);
  });

  test('removes the hidden-readable MathML that follows an equation', () => {
    const html = `${equationImg(R`X_3 \rightarrow 3Y`)}<span class="hidden-readable"><math xmlns="http://www.w3.org/1998/Math/MathML">\n`
      + '  <msub><mi>X</mi><mn>3</mn></msub><mo>→</mo><mn>3</mn><mi>Y</mi>\n</math></span>'
      + '<span class="hidden-readable">X 3 yields 3 Y</span>';
    expect(convertCanvasHtml(html, { imageMarkers: 'never' })).toEqual({
      text: R`\(X_3 \rightarrow 3Y\)`,
      images: [],
      warnings: [],
    });
  });

  test('turns a codecogs image into LaTeX from its title and drops the editor link', () => {
    const html = '<a href="http://www.codecogs.com/eqnedit.php?latex=-%5Cfrac%7B%5BX%5D%7D%7B2y%7D" target="_blank">'
      + R`<img src="http://latex.codecogs.com/gif.latex?-%5Cfrac%7B%5BX%5D%7D%7B2y%7D" title="-\frac{[X]}{2y}" loading="lazy"></a>`;
    expect(convertCanvasHtml(html, { imageMarkers: 'never' })).toEqual({
      text: R`\(-\frac{[X]}{2y}\)`,
      images: [],
      warnings: [],
    });
  });

  test('reads codecogs LaTeX from the query string when there is no title', () => {
    const html = '<img src="https://latex.codecogs.com/png.latex?%5Cfrac%7B1%7D%7B2%7D">';
    expect(convertCanvasHtml(html).text).toBe(R`\(\frac{1}{2}\)`);
  });

  test('keeps an equation that would close its delimiters early, with a warning', () => {
    const html = equationImg(R`a \) b`);
    expect(convertCanvasHtml(html)).toEqual({
      text: R`\(a \) b\)`,
      images: [],
      warnings: [{ code: 'equation-unsafe', message: R`An equation contains \) or \] and may not display correctly` }],
    });
  });

  test('warns when an equation image has no LaTeX anywhere', () => {
    expect(convertCanvasHtml('<p>Value: <img class="equation_image" src="https://canvas.example.test/other"></p>')).toEqual({
      text: 'Value:',
      images: [],
      warnings: [{ code: 'equation-missing', message: 'An equation image had no readable LaTeX and was removed' }],
    });
  });
});

describe('convertCanvasHtml: superscripts and subscripts', () => {
  test('uses Unicode for digits, signs and parentheses, including U+2212 minus', () => {
    const html = '<p>CH<sub>3</sub>COO<sup>-</sup>, 10<sup>−5</sup>, x<sup>n</sup>, A<sub>(2+1)</sub>, y<sup>i=0</sup></p>';
    expect(convertCanvasHtml(html).text).toBe('CH₃COO⁻, 10⁻⁵, xⁿ, A₍₂₊₁₎, yⁱ⁼⁰');
  });

  test('merges adjacent superscripts split by Canvas', () => {
    expect(convertCanvasHtml('<p>[y] x 10<sup>-</sup><sup>3</sup> M</p>').text).toBe('[y] x 10⁻³ M');
    // Merged before choosing Unicode or LaTeX, so the pair renders as one.
    expect(convertCanvasHtml('<p>x<sup>-</sup><!-- c --><sup>a</sup></p>').text).toBe(R`x\({}^{\text{-a}}\)`);
  });

  test('does not merge superscripts separated by a space', () => {
    expect(convertCanvasHtml('<p>a<sup>2</sup> <sup>3</sup></p>').text).toBe('a² ³');
  });

  test('falls back to LaTeX \\text when a character has no Unicode form', () => {
    const html = '<p>K<sub>a</sub> at 25 <sup>o</sup>C, ΔS<sub>univ</sub> &gt; 0, x<sup>2a</sup></p>';
    expect(convertCanvasHtml(html).text)
      .toBe(R`K\({}_{\text{a}}\) at 25 \({}^{\text{o}}\)C, ΔS\({}_{\text{univ}}\) > 0, x\({}^{\text{2a}}\)`);
  });

  test('escapes LaTeX specials inside \\text', () => {
    const html = R`<p>x<sub>a_b{c}$%#&amp;~^\</sub></p>`;
    expect(convertCanvasHtml(html).text)
      .toBe(R`x\({}_{\text{a\_b\{c\}\$\%\#\&\textasciitilde{}\textasciicircum{}\textbackslash{}}}\)`);
  });

  test('puts an equation inside a superscript as raw LaTeX', () => {
    const html = `<p>e<sup>${equationImg(R`\pi i`)}</sup> and 10<sup>2${equationImg('k')}</sup></p>`;
    expect(convertCanvasHtml(html).text).toBe(R`e\({}^{\pi i}\) and 10\({}^{\text{2}k}\)`);
  });

  test('treats vertical-align spans from Google Docs as super/subscripts', () => {
    const base = 'font-family: Arial; white-space: pre-wrap; background-color: transparent;';
    const html = `<span id="docs-internal-guid-2"><span style="${base} vertical-align: baseline;">v = k[ X</span>`
      + `<span style="font-size: 9px; ${base} vertical-align: sub;">2</span>`
      + `<span style="${base} vertical-align: baseline;"> ]</span>`
      + `<span style="font-size: 9px; ${base} vertical-align: super;">3 </span>`
      + `<span style="${base} vertical-align: baseline;">[ Y</span>`
      + `<span style="font-size: 9px; ${base} vertical-align: sub;">2</span>`
      + `<span style="${base} vertical-align: baseline;"> ]</span>`
      + `<span style="font-size: 9px; ${base} vertical-align: super;">2</span></span>`;
    expect(convertCanvasHtml(html).text).toBe('v = k[ X₂ ]³ [ Y₂ ]²');
  });

  test('merges adjacent vertical-align spans', () => {
    const html = '<p>1.8 x 10<span style="vertical-align: super;">-</span><span style="vertical-align: super;">5</span></p>';
    expect(convertCanvasHtml(html).text).toBe('1.8 x 10⁻⁵');
  });

  test('keeps spaces just inside the tags as word separators', () => {
    expect(convertCanvasHtml('<p>O<sub>2 </sub>is a gas</p>').text).toBe('O₂ is a gas');
  });
});

describe('convertCanvasHtml: tables', () => {
  test('turns a table into a KaTeX array on its own line', () => {
    const html = '<div><p>Measured times:</p><table style="width: 100%;" border="1"><tbody>'
      + '<tr><td style="text-align: center;">Trial</td><td>[X] (mM)</td><td>time (s)</td></tr>'
      + '<tr><td>A</td><td>0.25</td><td>7.3 x&nbsp;10<sup>-4</sup></td></tr>'
      + '<tr><td>B</td><td>NH<sub>4</sub>Cl &lt; 2</td><td>\n 8.75 \n</td></tr>'
      + '</tbody></table><p>Which trial is faster?</p></div>';
    expect(convertCanvasHtml(html)).toEqual({
      text: 'Measured times:\n'
        + R`\[\begin{array}{|c|c|c|}\hline \text{Trial} & \text{[X] (mM)} & \text{time (s)} \\ \hline `
        + R`\text{A} & \text{0.25} & \text{7.3 x 10}^{\text{-4}} \\ \hline `
        + R`\text{B} & \text{NH}_{\text{4}}\text{Cl < 2} & \text{8.75} \\ \hline \end{array}\]`
        + '\nWhich trial is faster?',
      images: [],
      warnings: [],
    });
  });

  test('pads short rows and colspans, keeps equation cells as LaTeX and joins cell paragraphs', () => {
    const html = '<table><thead><tr><th colspan="2">Head</th><th>K</th></tr></thead><tbody>'
      + `<tr><td><p>a</p><p>b</p></td><td>${equationImg(R`K_a`)}</td></tr>`
      + '<tr><td><sup>2</sup>H &amp; $5</td></tr></tbody></table>';
    expect(convertCanvasHtml(html).text).toBe(
      R`\[\begin{array}{|c|c|c|}\hline \text{Head} &  & \text{K} \\ \hline `
      + R`\text{a b} & K_a &  \\ \hline `
      + R`{}^{\text{2}}\text{H \& \$5} &  &  \\ \hline \end{array}\]`,
    );
  });

  test('flattens a table that contains an image and warns', () => {
    const html = '<table><tr><td>Compound</td><td>Structure</td></tr>'
      + `<tr><td>A<sub>1</sub></td><td>${remoteImg(101, 'a.png')}</td></tr>`
      + `<tr><td>&nbsp;</td><td></td></tr><tr><td>B</td><td>${remoteImg(102, 'b.png')}</td></tr></table>`;
    expect(convertCanvasHtml(html)).toEqual({
      text: 'Compound | Structure\nA₁ | (Image 1)\nB | (Image 2)',
      images: [
        { src: 'https://canvas.example.test/assessment_questions/11/files/101/download?verifier=abc', alt: 'a.png', kind: 'remote', marker: 'Image 1' },
        { src: 'https://canvas.example.test/assessment_questions/11/files/102/download?verifier=abc', alt: 'b.png', kind: 'remote', marker: 'Image 2' },
      ],
      warnings: [FLATTENED],
    });
  });

  test('nests a table inside a table cell as an inner array', () => {
    const html = '<table><tr><td>Outer</td><td><table><tr><td>x</td><td>y</td></tr></table></td></tr></table>';
    expect(convertCanvasHtml(html)).toEqual({
      text: R`\[\begin{array}{|c|c|}\hline \text{Outer} & \begin{array}{|c|c|}\hline \text{x} & \text{y} \\ \hline \end{array} \\ \hline \end{array}\]`,
      images: [],
      warnings: [],
    });
  });

  test('drops a table with no content', () => {
    expect(convertCanvasHtml('<p>Before</p><table><tr><td>&nbsp;</td><td></td></tr></table>').text).toBe('Before');
  });

  // Without a grid the second data row would slide left under the wrong headers.
  test('leaves the cells under a rowspan blank so later cells keep their columns', () => {
    const html = '<table><tr><th>Trial</th><th>[A] (M)</th><th>rate (M/s)</th></tr>'
      + '<tr><td rowspan="2">Set 1</td><td>0.10</td><td>2.0</td></tr>'
      + '<tr><td>0.20</td><td>8.0</td></tr>'
      + '<tr><td>Set 2</td><td rowspan="2">0.30</td><td>18</td></tr>'
      + '<tr><td>Set 3</td><td>32</td></tr></table>';
    expect(convertCanvasHtml(html)).toEqual({
      text: R`\[\begin{array}{|c|c|c|}\hline \text{Trial} & \text{[A] (M)} & \text{rate (M/s)} \\ \hline `
        + R`\text{Set 1} & \text{0.10} & \text{2.0} \\ \hline `
        + R` & \text{0.20} & \text{8.0} \\ \hline `
        + R`\text{Set 2} & \text{0.30} & \text{18} \\ \hline `
        + R`\text{Set 3} &  & \text{32} \\ \hline \end{array}\]`,
      images: [],
      warnings: [],
    });
  });

  test('lays out a two-row header that merges cells both ways', () => {
    const html = '<table><thead><tr><th rowspan="2">Species</th><th colspan="2">Conc (M)</th></tr>'
      + '<tr><th>initial</th><th>final</th></tr></thead>'
      + '<tbody><tr><td>A</td><td>1.0</td><td>0.5</td></tr></tbody></table>';
    expect(convertCanvasHtml(html).text).toBe(
      R`\[\begin{array}{|c|c|c|}\hline \text{Species} & \text{Conc (M)} &  \\ \hline `
      + R` & \text{initial} & \text{final} \\ \hline `
      + R`\text{A} & \text{1.0} & \text{0.5} \\ \hline \end{array}\]`,
    );
  });

  // As in a browser: a rowspan ends with its thead/tbody/tfoot, a row with no
  // cells of its own still uses up a row of the span, and no rows are invented.
  test('ends a rowspan at its row group, counts empty rows and adds no rows', () => {
    const html = '<table><thead><tr><th rowspan="3">H</th><th>x</th></tr></thead>'
      + '<tbody><tr><td rowspan="2">a</td><td>b</td></tr><tr></tr><tr><td>c</td><td>d</td></tr>'
      + '<tr><td>e</td><td rowspan="9">f</td></tr></tbody></table>';
    expect(convertCanvasHtml(html).text).toBe(
      R`\[\begin{array}{|c|c|}\hline \text{H} & \text{x} \\ \hline `
      + R`\text{a} & \text{b} \\ \hline `
      + R`\text{c} & \text{d} \\ \hline `
      + R`\text{e} & \text{f} \\ \hline \end{array}\]`,
    );
  });

  // A browser clamps colspan to 1000; past 100 columns the table is text.
  test('flattens a table whose colspan makes it wider than 100 columns', () => {
    expect(convertCanvasHtml('<table><tr><td colspan="999">a</td><td>b</td></tr></table>')).toEqual({
      text: 'a | b',
      images: [],
      warnings: [FLATTENED],
    });
  });

  test('keeps the cell after a colspan of 55 in column 56', () => {
    const wide = Array.from({ length: 56 }, (_, i) => `<td>c${i + 1}</td>`).join('');
    const html = `<table><tr><td colspan="55">a</td><td>X</td></tr><tr>${wide}</tr></table>`;
    const first = [R`\text{a}`, ...Array(54).fill(''), R`\text{X}`].join(' & ');
    const second = Array.from({ length: 56 }, (_, i) => R`\text{c${i + 1}}`).join(' & ');
    expect(convertCanvasHtml(html)).toEqual({
      text: R`\[\begin{array}{|${'c|'.repeat(56)}}\hline ${first} \\ \hline ${second} \\ \hline \end{array}\]`,
      images: [],
      warnings: [],
    });
  });

  // 52 is what the table editor writes when 52 rows are merged.
  test.each(['52', '999'])('runs a rowspan of %s to the end of its row group', (rowspan) => {
    const rows = Array.from({ length: 51 }, (_, i) => `<tr><td>r${i + 2}</td></tr>`).join('');
    const html = `<table><tr><td rowspan="${rowspan}">a</td><td>b</td></tr>${rows}</table>`;
    const result = convertCanvasHtml(html);
    expect(result.warnings).toEqual([]);
    expect(result.text.startsWith(R`\[\begin{array}{|c|c|}\hline \text{a} & \text{b} \\ \hline `)).toBe(true);
    const arrayRows = result.text.split(R` \\ \hline `);
    expect(arrayRows.slice(1, -1)).toEqual(Array.from({ length: 51 }, (_, i) => R` & \text{r${i + 2}}`));
    expect(arrayRows[52]).toBe(R`\end{array}\]`);
  });

  test('runs rowspan="0" to the end of its row group', () => {
    expect(convertCanvasHtml('<table><tr><td rowspan="0">Set</td><td>a</td></tr><tr><td>b</td></tr></table>').text).toBe(
      R`\[\begin{array}{|c|c|}\hline \text{Set} & \text{a} \\ \hline  & \text{b} \\ \hline \end{array}\]`,
    );
    const html = '<table><tbody><tr><td rowspan="0">Set</td><td>a</td></tr><tr><td>b</td></tr></tbody>'
      + '<tbody><tr><td>c</td><td>d</td></tr></tbody></table>';
    expect(convertCanvasHtml(html).text).toBe(
      R`\[\begin{array}{|c|c|}\hline \text{Set} & \text{a} \\ \hline  & \text{b} \\ \hline `
      + R`\text{c} & \text{d} \\ \hline \end{array}\]`,
    );
  });

  test('keeps flattened image-table cells in their columns under spans', () => {
    const html = '<table><tr><td>Set</td><td colspan="2">Structure and name</td><td>Notes</td></tr>'
      + `<tr><td rowspan="2">1</td><td>${remoteImg(103, 'c.png')}</td><td>x</td><td>n</td></tr>`
      + `<tr><td>${remoteImg(104, 'd.png')}</td><td>y</td><td rowspan="2">m</td></tr>`
      + '<tr><td>2</td><td>z</td></tr></table>';
    const result = convertCanvasHtml(html);
    expect(result.text).toBe('Set | Structure and name | | Notes\n1 | (Image 1) | x | n\n| (Image 2) | y | m\n2 | z');
    expect(result.images.map((image) => image.marker)).toEqual(['Image 1', 'Image 2']);
    expect(result.warnings).toEqual([FLATTENED]);
  });
});

// KaTeX pads every array row to the widest one, so an array grows as rows x
// columns: past 100 columns or 2,500 laid-out cells a table is flattened to
// text lines instead, one per row, which grow only with the HTML.
describe('convertCanvasHtml: table size caps', () => {
  const cellsOf = (count, prefix) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
  const rowHtml = (cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  // The array for `rows` of cell texts (null: covered by a span), each row
  // padded to `columns`.
  const arrayOf = (rows, columns) => R`\[\begin{array}{|${'c|'.repeat(columns)}}\hline `
    + rows
      .map((cells) => [...cells.map((cell) => (cell === null ? '' : R`\text{${cell}}`)), ...Array(columns - cells.length).fill('')].join(' & '))
      .map((row) => R`${row} \\ \hline`)
      .join(' ')
    + R` \end{array}\]`;
  // `rows` x `columns` cell texts named r<row>c<column>.
  const fullGrid = (rows, columns) => Array.from({ length: rows }, (_, r) => cellsOf(columns, `r${r + 1}c`));

  test('keeps a 100-column table as an array', () => {
    const cells = cellsOf(100, 'c');
    expect(convertCanvasHtml(`<table>${rowHtml(cells)}</table>`)).toEqual({
      text: arrayOf([cells], 100),
      images: [],
      warnings: [],
    });
  });

  test('flattens a 101-column table to one line per row, with a warning', () => {
    const cells = cellsOf(101, 'c');
    const html = `<p>Before</p><table>${rowHtml(cells)}${rowHtml(['last'])}</table><p>After</p>`;
    expect(convertCanvasHtml(html)).toEqual({
      text: `Before\n${cells.join(' | ')}\nlast\nAfter`,
      images: [],
      warnings: [FLATTENED],
    });
  });

  test('counts the columns a colspan covers', () => {
    const cells = cellsOf(50, 'b');
    const row = (extra) => `<table><tr><td colspan="50">a</td>${cells.map((cell) => `<td>${cell}</td>`).join('')}${extra}</tr></table>`;
    expect(convertCanvasHtml(row(''))).toEqual({
      text: arrayOf([['a', ...Array(49).fill(null), ...cells]], 100),
      images: [],
      warnings: [],
    });
    expect(convertCanvasHtml(row('<td>c</td>'))).toEqual({
      text: ['a', ...cells, 'c'].join(' | '),
      images: [],
      warnings: [FLATTENED],
    });
  });

  test('keeps a 50 x 50 table (2,500 cells) as an array', () => {
    const rows = fullGrid(50, 50);
    expect(convertCanvasHtml(`<table>${rows.map(rowHtml).join('')}</table>`)).toEqual({
      text: arrayOf(rows, 50),
      images: [],
      warnings: [],
    });
  });

  test('flattens a 41 x 61 table (2,501 cells)', () => {
    const rows = fullGrid(41, 61);
    expect(convertCanvasHtml(`<table>${rows.map(rowHtml).join('')}</table>`)).toEqual({
      text: rows.map((cells) => cells.join(' | ')).join('\n'),
      images: [],
      warnings: [FLATTENED],
    });
  });

  // Every array row is as wide as the widest one, so short rows count in full.
  test('counts short rows at the width of the widest: 40 rows of 61 fit, 41 do not', () => {
    const header = cellsOf(61, 'h');
    // Text long enough that the field's length pays for the padding (see the
    // array budget below), so only the cell count decides here.
    const notes = (count) => cellsOf(count, 'r').map((cell) => `${cell}: ${'measured '.repeat(9).trim()}`);
    const tableOf = (shortRows) => `<table>${rowHtml(header)}`
      + `${notes(shortRows).map((cell) => rowHtml([cell])).join('')}</table>`;

    expect(convertCanvasHtml(tableOf(39))).toEqual({
      text: arrayOf([header, ...notes(39).map((cell) => [cell])], 61),
      images: [],
      warnings: [],
    });
    expect(convertCanvasHtml(tableOf(40))).toEqual({
      text: [header.join(' | '), ...notes(40)].join('\n'),
      images: [],
      warnings: [FLATTENED],
    });
  });

  test('ignores spans when it flattens a table that is too big, so nothing is padded', () => {
    const html = '<table><tr><td colspan="50">wide</td><td colspan="50">wider</td><td>last</td></tr>'
      + '<tr><td rowspan="2">a</td><td colspan="9">b</td></tr><tr><td>c</td></tr>'
      + `<tr><td>${remoteImg(301, 'e.png')}</td><td>${equationImg(R`\frac{1}{3}`, ' style="display:block"')}</td></tr></table>`;
    expect(convertCanvasHtml(html, { imageMarkers: 'never' })).toEqual({
      text: 'wide | wider | last\na | b\nc\n| ' + R`\(\frac{1}{3}\)`,
      images: [{
        src: 'https://canvas.example.test/assessment_questions/11/files/301/download?verifier=abc',
        alt: 'e.png',
        kind: 'remote',
        marker: null,
      }],
      warnings: [FLATTENED],
    });
  });

  test('drops a table that is too big but empty, without a warning', () => {
    const html = `<p>Before</p><table>${rowHtml(Array(101).fill('&nbsp;'))}</table>`;
    expect(convertCanvasHtml(html)).toEqual({ text: 'Before', images: [], warnings: [] });
  });

  // Laid out in full, the first shape would be a grid of 9 million cells.
  test.each([
    ['plain cells', '<td>x'],
    ['cells spanning 50 x 50', '<td colspan="50" rowspan="50">x'],
  ])('flattens a 3,000-cell row over 3,000 one-cell rows (%s) quickly', (_label, wideCell) => {
    const html = `<table><tr>${wideCell.repeat(3000)}${'<tr><td>y'.repeat(3000)}</table>`;

    const started = performance.now();
    const result = convertCanvasHtml(html);
    const elapsed = performance.now() - started;

    expect(result).toEqual({
      text: [Array(3000).fill('x').join(' | '), ...Array(3000).fill('y')].join('\n'),
      images: [],
      warnings: [FLATTENED],
    });
    expect(elapsed).toBeLessThan(2000);
  });

  // Every array is padded to its widest row, so a 246-character table can be a
  // 2,500-cell array of 8,000 characters. All the arrays of a field together
  // may be at most 3 times as long as its HTML; later tables are flattened.
  describe('array budget', () => {
    const padded = `<table><tr><td colspan="50">x<td colspan="50">${'<tr><td>'.repeat(24)}</table>`;

    test('flattens a small table that would pad out to a large array', () => {
      expect(convertCanvasHtml(padded)).toEqual({ text: 'x |', images: [], warnings: [FLATTENED] });
    });

    test('keeps a field of such tables within 3 times its length', () => {
      const html = padded.repeat(40);
      const result = convertCanvasHtml(html);
      const arrays = result.text.match(/\\begin\{array\}/g) || [];
      // Three 7,946-character arrays fit in 3 x 9,840; the other 37 tables
      // are one line each.
      expect(arrays).toHaveLength(3);
      expect(result.text.split('\n').slice(3)).toEqual(Array(37).fill('x |'));
      expect(result.text.length).toBeLessThanOrEqual(3 * html.length);
      expect(result.warnings).toEqual([FLATTENED]);
    });

    test('counts a nested array once, inside the array that holds it', () => {
      // The inner array is 1.7 times this field's length and the outer one,
      // which contains it, 1.9 times: the outer one, and the small table
      // after it, fit only if the inner one is not counted twice.
      const inner = `<table><tr>${'<td>i</td>'.repeat(20)}</tr>${'<tr><td>j</td></tr>'.repeat(5)}</table>`;
      const html = `<table><tr><td>${inner}</td><td>o</td></tr></table><table><tr><td>t</td></tr></table>`;
      const innerRows = [
        Array(20).fill(R`\text{i}`).join(' & '),
        ...Array(5).fill([R`\text{j}`, ...Array(19).fill('')].join(' & ')),
      ];
      const innerArray = R`\begin{array}{|${'c|'.repeat(20)}}\hline `
        + innerRows.map((row) => R`${row} \\ \hline`).join(' ') + R` \end{array}`;
      expect(convertCanvasHtml(html)).toEqual({
        text: R`\[\begin{array}{|c|c|}\hline ${innerArray} & \text{o} \\ \hline \end{array}\]` + '\n'
          + R`\[\begin{array}{|c|}\hline \text{t} \\ \hline \end{array}\]`,
        images: [],
        warnings: [],
      });
    });

    test('does not pad a flattened image table past the budget', () => {
      // 98 covered columns would be 294 characters of " | " from 73 of HTML.
      const html = '<table><tr><td colspan="99">x</td><td><img src="f.png"></td></tr></table>';
      expect(convertCanvasHtml(html)).toEqual({
        text: 'x |',
        images: [{ src: 'f.png', alt: '', kind: 'bundled', marker: null }],
        warnings: [FLATTENED],
      });
    });
  });
});

// A staff upload is converted synchronously on the server, so no field may
// cost much more than its size.
describe('convertCanvasHtml: size and nesting limits', () => {
  // One <sub> of carets escapes to about 18 times its length.
  test('does not convert a field longer than 500,000 characters', () => {
    const atCap = `<sub>${'^'.repeat(500000 - 11)}</sub>`;
    expect(atCap).toHaveLength(500000);
    expect(convertCanvasHtml(atCap).warnings).toEqual([]);
    expect(convertCanvasHtml(`${atCap} `)).toEqual({ text: '', images: [], warnings: [TOO_LONG] });
  });

  test('does not convert plain text longer than 500,000 characters', () => {
    expect(convertCanvasPlainText('$'.repeat(500000)).warnings).toEqual([]);
    expect(convertCanvasPlainText('$'.repeat(500001))).toEqual({ text: '', images: [], warnings: [TOO_LONG] });
  });

  test('does not convert a field with more than 10,000 tags', () => {
    const html = '<p>a</p>'.repeat(5000);
    expect(convertCanvasHtml(html)).toEqual({ text: Array(5000).fill('a').join('\n'), images: [], warnings: [] });
    expect(convertCanvasHtml(`${html}<br>`)).toEqual({ text: '', images: [], warnings: [TOO_COMPLEX] });
  });

  // parse5 (cheerio's default parser) moves each top-level node of a fragment
  // one by one, and its adoption agency does the same for misnested tags:
  // about 140 ms per field of this size, where htmlparser2 takes under 10 ms.
  test('converts twenty fields at the tag cap in well under a second', () => {
    const fields = [
      'x<br>'.repeat(10000),
      `<b><div>${'x<br>'.repeat(9997)}</b>`,
    ];
    const started = performance.now();
    for (let i = 0; i < 10; i += 1) {
      fields.forEach((html) => {
        expect(convertCanvasHtml(html).text).toBe(Array(html.startsWith('<b>') ? 9997 : 10000).fill('x').join('\n'));
      });
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('leaves out elements nested deeper than 200, with a warning, instead of overflowing the stack', () => {
    const html = `<p>Before</p>${'<span>'.repeat(4000)}deep${'</span>'.repeat(4000)}<p>After</p>`;
    expect(convertCanvasHtml(html)).toEqual({ text: 'Before\nAfter', images: [], warnings: [TOO_COMPLEX] });
    expect(convertCanvasHtml(`${'<b>'.repeat(199)}kept`)).toEqual({ text: 'kept', images: [], warnings: [] });
    expect(convertCanvasHtml(`${'<b>'.repeat(200)}lost`)).toEqual({ text: '', images: [], warnings: [TOO_COMPLEX] });
  });

  test('reads the text of a deeply nested link without overflowing the stack', () => {
    const html = `<a href="https://example.test/x">${'<span>'.repeat(4900)}deep${'</span>'.repeat(4900)}</a>`;
    expect(convertCanvasHtml(html)).toEqual({ text: '(https://example.test/x)', images: [], warnings: [TOO_COMPLEX] });
  });
});

// htmlparser2 keeps what it reads where it is written; an HTML5 parser such as
// parse5 (used before) or a browser rearranges sloppy tables. These keep what
// a browser shows.
describe('convertCanvasHtml: HTML a browser rearranges', () => {
  test('shows text written in a table outside its cells before the table', () => {
    const html = '<table>Note <tr><td>a</td><b>bold</b></tr><p>Para</p></table>';
    expect(convertCanvasHtml(html).text).toBe(
      'Note bold\nPara\n' + R`\[\begin{array}{|c|}\hline \text{a} \\ \hline \end{array}\]`,
    );
  });

  test('makes a row of cells written outside a <tr>', () => {
    expect(convertCanvasHtml('<table><td>a</td><td>b</td><tr><td>c</td><td>d</td></tr></table>').text).toBe(
      R`\[\begin{array}{|c|c|}\hline \text{a} & \text{b} \\ \hline \text{c} & \text{d} \\ \hline \end{array}\]`,
    );
  });

  test('starts a new cell at a <th> after an unclosed <td>', () => {
    expect(convertCanvasHtml('<table><tr><td>a<th>b</th><th>c</table>').text).toBe(
      R`\[\begin{array}{|c|c|c|}\hline \text{a} & \text{b} & \text{c} \\ \hline \end{array}\]`,
    );
  });

  test('ends an unclosed tbody at a thead', () => {
    const html = '<table><tbody><tr><td rowspan="3">a</td></tr><thead><tr><th>h</th></tr></thead></table>';
    expect(convertCanvasHtml(html).text).toBe(
      R`\[\begin{array}{|c|}\hline \text{a} \\ \hline \text{h} \\ \hline \end{array}\]`,
    );
  });

  test('reads a caption or a row group written inside a row', () => {
    const twoRows = R`\[\begin{array}{|c|}\hline \text{a} \\ \hline \text{b} \\ \hline \end{array}\]`;
    expect(convertCanvasHtml('<table><tbody><tr><td>a</td><caption>Cap</caption><tr><td>b</td></tr></tbody></table>').text)
      .toBe(`Cap\n${twoRows}`);
    expect(convertCanvasHtml('<table><tr><td>a</td><tbody><tr><td>b</td></tr></tbody></tr></table>').text).toBe(twoRows);
  });

  test('normalises line endings and drops NUL characters', () => {
    expect(convertCanvasHtml(`<p>x ${equationImg('a\r\nb\rc')}</p><pre>1\r\n2</pre><p>a\u0000b</p>`).text)
      .toBe('x \\(a\nb\nc\\)\n1\n2\nab');
  });
});

describe('convertCanvasHtml: images and markers', () => {
  test("'auto' removes a single trailing image without a marker", () => {
    const html = `<div>Name the structure.\n<br>\n${remoteImg(201, '1a.png')}\n</div>`;
    expect(convertCanvasHtml(html)).toEqual({
      text: 'Name the structure.',
      images: [{
        src: 'https://canvas.example.test/assessment_questions/11/files/201/download?verifier=abc',
        alt: '1a.png',
        kind: 'remote',
        marker: null,
      }],
      warnings: [],
    });
  });

  test("'auto' marks the image when text follows it", () => {
    const html = `<div><p>The structure is shown below.</p><p>${remoteImg(202)}</p><p>How many carbons?</p></div>`;
    const result = convertCanvasHtml(html);
    expect(result.text).toBe('The structure is shown below.\n(Image 1)\nHow many carbons?');
    expect(result.images.map((image) => image.marker)).toEqual(['Image 1']);
  });

  test("'auto' treats an equation after the image as text after it", () => {
    const result = convertCanvasHtml(`<p>Look ${remoteImg(203)} ${equationImg('x')}</p>`);
    expect(result.text).toBe(R`Look (Image 1) \(x\)`);
  });

  test("'auto' marks every image when there are two, even with nothing after them", () => {
    const html = `<p>Compare</p><p>${remoteImg(204)}${remoteImg(205)}</p>`;
    const result = convertCanvasHtml(html);
    expect(result.text).toBe('Compare\n(Image 1) (Image 2)');
    expect(result.images.map((image) => image.marker)).toEqual(['Image 1', 'Image 2']);
  });

  test("'never' removes images without markers", () => {
    const html = `<p>${remoteImg(206)} then text ${remoteImg(207)}</p>`;
    const result = convertCanvasHtml(html, { imageMarkers: 'never' });
    expect(result.text).toBe('then text');
    expect(result.images.map((image) => image.marker)).toEqual([null, null]);
  });

  test('classifies image sources and warns once for unsupported ones', () => {
    const html = '<p>'
      + '<img src="$IMS-CC-FILEBASE$/assessment_questions/a%20b.png?canvas_download=1" alt=" a b.png ">'
      + '<img src="%24IMS-CC-FILEBASE%24/Uploaded Media/c">'
      + '<img src="web_resources/d.png">'
      + '<img src="http://canvas.example.test/courses/1/files/2/download?a=1&amp;b=2">'
      + '<img src="data:image/png;base64,iVBORw0KGgo=">'
      + '<img src="//canvas.example.test/e.png">'
      + '<img src="/courses/1/files/3/preview">'
      + '<img src="data:image/svg+xml;utf8,&lt;svg&gt;">'
      + '<img>'
      + '</p>';
    expect(convertCanvasHtml(html, { imageMarkers: 'never' })).toEqual({
      text: '',
      images: [
        { src: '$IMS-CC-FILEBASE$/assessment_questions/a%20b.png?canvas_download=1', alt: 'a b.png', kind: 'bundled', marker: null },
        { src: '$IMS-CC-FILEBASE$/Uploaded Media/c', alt: '', kind: 'bundled', marker: null },
        { src: 'web_resources/d.png', alt: '', kind: 'bundled', marker: null },
        { src: 'http://canvas.example.test/courses/1/files/2/download?a=1&b=2', alt: '', kind: 'remote', marker: null },
        { src: 'data:image/png;base64,iVBORw0KGgo=', alt: '', kind: 'data', marker: null },
        { src: '//canvas.example.test/e.png', alt: '', kind: 'other', marker: null },
        { src: '/courses/1/files/3/preview', alt: '', kind: 'other', marker: null },
        { src: 'data:image/svg+xml;utf8,<svg>', alt: '', kind: 'other', marker: null },
        { src: '', alt: '', kind: 'other', marker: null },
      ],
      warnings: [{ code: 'image-unsupported', message: 'An image used a source that cannot be imported' }],
    });
  });

  test('places an image found inside a superscript after it', () => {
    const result = convertCanvasHtml(`<p>x<sup>2${remoteImg(208)}</sup> end</p>`);
    expect(result.text).toBe('x² (Image 1) end');
    expect(result.images).toHaveLength(1);
  });
});

describe('convertCanvasHtml: links and media', () => {
  test('appends an external link target that differs from the link text', () => {
    const html = '<p>See <a href="https://example.test/sheet" target="_blank">the data sheet</a> and '
      + '<a href="https://example.test/same">https://example.test/same</a>.</p>';
    expect(convertCanvasHtml(html)).toEqual({
      text: 'See the data sheet (https://example.test/sheet) and https://example.test/same.',
      images: [],
      warnings: [],
    });
  });

  test('keeps the text of a linked course file without its address and warns', () => {
    const html = '<p>Use <a class="instructure_file_link" href="$IMS-CC-FILEBASE$/Canvas_Quizzes/Table%20A.pdf?canvas_=1&amp;canvas_qs_wrap=1">this pdf</a>, '
      + '<a href="https://canvas.example.test/courses/1/files/9?wrap=1">notes</a> and '
      + '<a href="https://canvas.example.test/x?verifier=secret">slides</a>.</p>';
    expect(convertCanvasHtml(html)).toEqual({
      text: 'Use this pdf, notes and slides.',
      images: [],
      warnings: [{ code: 'linked-file', message: 'A linked file was not imported' }],
    });
  });

  test('keeps only the content of mailto, relative and anchor-less links', () => {
    const html = '<p><a href="mailto:ta@example.test">Email</a> <a href="/courses/1/pages/x">page</a> <a name="top">top</a></p>';
    expect(convertCanvasHtml(html)).toEqual({ text: 'Email page top', images: [], warnings: [] });
  });

  test('removes embedded media with one warning', () => {
    const html = '<p>Watch<iframe src="https://video.example.test/1"></iframe><video src="v.mp4">fallback</video>'
      + '<audio src="a.mp3"></audio><object data="x"></object><embed src="y"> this.</p>';
    expect(convertCanvasHtml(html)).toEqual({
      text: 'Watch this.',
      images: [],
      warnings: [{ code: 'media-removed', message: 'Embedded media was removed' }],
    });
  });
});

describe('convertCanvasHtml: dollar signs and SMILES tags', () => {
  test('leaves a single dollar sign alone', () => {
    expect(convertCanvasHtml('<p>It costs $5.</p>').text).toBe('It costs $5.');
  });

  // Two plain "$" would make RichText render the text between them as math.
  test('escapes every dollar sign when there are two or more', () => {
    expect(convertCanvasHtml('<p>Between $5</p><p>and $10</p>').text)
      .toBe(R`Between \(\$\)5` + '\n' + R`and \(\$\)10`);
  });

  // KaTeX auto-render stops at a "$" it cannot close, so one plain "$" before
  // our math would leave every \( \) and \[ \] after it as raw source.
  test('escapes a single dollar sign when the field has math, without touching the LaTeX', () => {
    const html = '<p>It costs $5</p><table><tr><td>$1</td></tr></table>';
    expect(convertCanvasHtml(html).text).toBe(R`It costs \(\$\)5` + '\n' + R`\[\begin{array}{|c|}\hline \text{\$1} \\ \hline \end{array}\]`);
  });

  test('escapes a single dollar sign before a LaTeX subscript', () => {
    expect(convertCanvasHtml('<p>Price is $5 and K<sub>a</sub></p>').text)
      .toBe(R`Price is \(\$\)5 and K\({}_{\text{a}}\)`);
  });

  test('escapes a single dollar sign before an equation image', () => {
    expect(convertCanvasHtml(`<p>It costs $4. Find ${equationImg('x^2')}</p>`).text)
      .toBe(R`It costs \(\$\)4. Find \(x^2\)`);
  });

  test('escapes a single dollar sign before math the author typed', () => {
    expect(convertCanvasHtml(R`<p>It costs $4. Find \(x^2\) or \[y\].</p>`).text)
      .toBe(R`It costs \(\$\)4. Find \(x^2\) or \[y\].`);
  });

  test('breaks [SMILES] tags in text and inside LaTeX text', () => {
    const html = '<p>[SMILES]C"O[/SMILES] and [smiles]x[/Smiles]</p><table><tr><td>[SMILES]CC[/SMILES]</td></tr></table>';
    expect(convertCanvasHtml(html).text).toBe(
      `[${ZWSP}SMILES]C"O[${ZWSP}/SMILES] and [${ZWSP}smiles]x[${ZWSP}/Smiles]\n`
      + R`\[\begin{array}{|c|}\hline \text{[{}SMILES]CC[{}/SMILES]} \\ \hline \end{array}\]`,
    );
  });

  // RichText replaces [SMILES]...[/SMILES] before KaTeX runs, so a tag inside
  // equation LaTeX would turn into a <canvas> in the middle of the math.
  test('breaks [SMILES] tags in equation LaTeX from every source', () => {
    const doubleEncoded = encodeURIComponent(encodeURIComponent('[SMILES]N[/SMILES]'));
    const html = `<p>${equationImg('[SMILES]C[/SMILES]')}</p>`
      + '<p><img class="equation_image" src="https://canvas.example.test/equation_images/x" alt="LaTeX: [smiles]O[/Smiles]"></p>'
      + `<p><img class="equation_image" src="https://canvas.example.test/equation_images/${doubleEncoded}"></p>`
      + '<p><img src="https://latex.codecogs.com/gif.latex?x" title="\\text{[SMILES]S[/SMILES]}"></p>';
    expect(convertCanvasHtml(html)).toEqual({
      text: R`\([{}SMILES]C[{}/SMILES]\)` + '\n'
        + R`\([{}smiles]O[{}/Smiles]\)` + '\n'
        + R`\([{}SMILES]N[{}/SMILES]\)` + '\n'
        + R`\(\text{[{}SMILES]S[{}/SMILES]}\)`,
      images: [],
      warnings: [],
    });
  });

  test('breaks [SMILES] tags in table equations, superscripts and display equations', () => {
    const html = `<table><tr><td>${equationImg('[SMILES]O[/SMILES]')}</td></tr></table>`
      + '<p>x<sup>[SMILES]a[/SMILES]</sup></p>'
      // Display math opens with "\[", so LaTeX starting "SMILES]" would make a tag.
      + `<p>${equationImg('SMILES] y', ' style="display: block;"')}</p>`;
    expect(convertCanvasHtml(html).text).toBe(
      R`\[\begin{array}{|c|}\hline [{}SMILES]O[{}/SMILES] \\ \hline \end{array}\]` + '\n'
      + R`x\({}^{\text{[{}SMILES]a[{}/SMILES]}}\)` + '\n'
      + R`\[{}SMILES] y\]`,
    );
  });
});

describe('convertCanvasPlainText', () => {
  // Real text/plain options contain a literal "<" or ">"; an HTML parser would
  // swallow "<b>" as a tag and decode "&lt;".
  test('keeps raw < and > and does no HTML parsing', () => {
    expect(convertCanvasPlainText('pH < 7 and <b>not bold</b> &lt; &amp;')).toEqual({
      text: 'pH < 7 and <b>not bold</b> &lt; &amp;',
      images: [],
      warnings: [],
    });
  });

  test('turns NBSP into a space, collapses whitespace per line and drops blank lines', () => {
    expect(convertCanvasPlainText('  a\u00a0\u00a0b \t \r\n\r\n   \n c  ').text).toBe('a b\nc');
  });

  test('applies the same dollar and SMILES neutralisation', () => {
    expect(convertCanvasPlainText('$5').text).toBe('$5');
    expect(convertCanvasPlainText('$5 or $6 [SMILES]C[/SMILES]').text)
      .toBe(R`\(\$\)5 or \(\$\)6 ` + `[${ZWSP}SMILES]C[${ZWSP}/SMILES]`);
    expect(convertCanvasPlainText(R`$5 for \(x\)`).text).toBe(R`\(\$\)5 for \(x\)`);
  });

  test('returns an empty result for non-string input', () => {
    expect(convertCanvasPlainText(undefined)).toEqual({ text: '', images: [], warnings: [] });
  });
});
