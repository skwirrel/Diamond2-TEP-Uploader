// CDN internal document theme — derived from the CDN style guide
// (slide template sampling, Aug 2026), adapted from 16:9 slides to A4 print.
//
// Usage:
//   #import "cdn-style.typ": cdn-doc, screenshot, colors
//   #show: cdn-doc.with(title: [...], standfirst: [...], date: [...])

// ---------------------------------------------------------------------------
// Brand palette (never pure white or pure black)
// ---------------------------------------------------------------------------
#let colors = (
  navy:       rgb("#121C51"), // brand navy — cover background, body text on light
  offwhite:   rgb("#EAE9E5"), // warm off-white — page background, text on navy
  card:       rgb("#F2F2F2"), // card white — screenshot frames
  pink:       rgb("#D476C4"), // accent orchid — only on navy backgrounds
  pink-deep:  rgb("#C05FAF"), // muted pink — headings on light backgrounds
  card-navy:  rgb("#1B2660"), // lifted navy — panels on navy
  rule:       rgb("#33407F"), // hairlines on navy
  muted-navy: rgb("#B9BDD6"), // secondary text on navy
  green:      rgb("#4CC38A"),
  amber:      rgb("#E8A33D"),
  red:        rgb("#E0605C"),
  grey:       rgb("#8A90B5"),
)

// Secondary text on the off-white background
#let muted-on-light = colors.navy.transparentize(35%)

// ---------------------------------------------------------------------------
// Screenshot card: rounded white card, hairline rule, internal padding,
// caption in muted navy below.
// ---------------------------------------------------------------------------
#let screenshot(path, caption: none, width: 100%) = figure(
  block(
    fill: colors.card,
    stroke: 0.6pt + colors.navy.transparentize(75%),
    radius: 4.3pt,   // 0.06 in corner radius per the style guide
    inset: 9pt,      // card padding
    width: width,
    image(path, width: 100%),
  ),
  caption: caption,
)

// Inline UI label, e.g. a button name: #ui[Continue]
#let ui(body) = text(weight: "semibold", body)

// ---------------------------------------------------------------------------
// Document wrapper
// ---------------------------------------------------------------------------
#let cdn-doc(
  title: [],
  standfirst: none,
  date: none,
  footer-brand: "Creative Diversity Network",
  cover-logo: none,   // path to the white (on-navy) logo lockup
  body,
) = {
  // Base typography — Open Sans throughout, body 10.5 pt, ~1.15 line spacing
  set text(font: "Open Sans", size: 10.5pt, fill: colors.navy)
  set par(leading: 0.66em, spacing: 1em, justify: false)

  // Light content pages: warm off-white ground, footer bottom right
  set page(
    paper: "a4",
    fill: colors.offwhite,
    margin: (left: 2.1cm, right: 2.1cm, top: 2.3cm, bottom: 2.4cm),
    footer: context align(right,
      text(size: 8pt, fill: muted-on-light)[
        #footer-brand #h(1.2cm) #counter(page).display("1")
      ]
    ),
  )

  // Headings: sentence case throughout (match the template)
  // H1 — section band: navy card, off-white text; sticks to what follows
  show heading.where(level: 1): it => block(
    width: 100%,
    fill: colors.navy,
    radius: 4.3pt,
    inset: (x: 14pt, y: 11pt),
    above: 2.4em,
    below: 1.3em,
    sticky: true,
    text(font: "Open Sans", weight: "regular", size: 19pt, fill: colors.offwhite, it.body),
  )
  // H2 — card/item heading: bold accent pink (deep variant on light ground)
  show heading.where(level: 2): it => block(
    above: 1.7em, below: 0.9em, sticky: true,
    text(weight: "bold", size: 13pt, fill: colors.pink-deep, it.body),
  )
  // H3 — minor heading: bold navy
  show heading.where(level: 3): it => block(
    above: 1.4em, below: 0.7em, sticky: true,
    text(weight: "bold", size: 11pt, fill: colors.navy, it.body),
  )

  // Lists: pink markers, a little air
  set list(marker: (
    text(fill: colors.pink-deep)[•],
    text(fill: colors.pink-deep)[‣],
  ), spacing: 0.78em)

  // Inline code: card-white chip with a faint rule
  show raw.where(block: false): it => box(
    fill: colors.card,
    stroke: 0.5pt + colors.navy.transparentize(85%),
    radius: 2pt,
    inset: (x: 3pt, y: 0pt),
    outset: (y: 2pt),
    text(size: 8.5pt, it),
  )

  // Figures: no numbering; captions small, muted, roman
  set figure(numbering: none, gap: 0.7em)
  show figure.caption: it => text(size: 8.5pt, fill: muted-on-light, style: "italic", it.body)

  // Links: deep pink, headings-weight only where authored
  show link: set text(fill: colors.pink-deep)

  // Emphasis stays navy; strong slightly heavier via semibold
  show strong: set text(weight: "semibold")

  // Tables (if any): pink bold header row text per the guide
  set table(stroke: 0.5pt + colors.navy.transparentize(80%))
  show table.cell.where(y: 0): set text(weight: "bold", size: 10pt, fill: colors.pink-deep)

  // -------------------------------------------------------------------------
  // Cover — navy mode, stacked lockup, no footer
  // -------------------------------------------------------------------------
  page(fill: colors.navy, footer: none, margin: 2.4cm)[
    #if cover-logo != none {
      align(left, image(cover-logo, width: 4.6cm))
    }
    #v(1fr)
    #text(font: "Open Sans", weight: "regular", size: 34pt, fill: colors.offwhite, title)
    #v(0.6em)
    #if standfirst != none {
      text(size: 13pt, fill: colors.pink, standfirst)
    }
    #v(2.4em)
    #line(length: 100%, stroke: 0.7pt + colors.rule)
    #v(0.8em)
    #grid(
      columns: (1fr, auto),
      text(size: 9pt, fill: colors.muted-navy)[#footer-brand],
      if date != none { text(size: 9pt, fill: colors.muted-navy, date) },
    )
    #v(0.2fr)
  ]

  // -------------------------------------------------------------------------
  // Contents
  // -------------------------------------------------------------------------
  block(above: 0.5em, below: 0.4em,
    text(weight: "bold", size: 13pt, fill: colors.pink-deep)[Contents])
  show outline.entry: set text(size: 10pt)
  outline(title: none, depth: 2, indent: 1em)

  body
}
