import page from './website.html?raw'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)
const dataUrl = (blob: Blob) => new Promise<string>((done) => {
  const r = new FileReader()
  r.onload = () => done(r.result as string)
  r.readAsDataURL(blob)
})

/** One self-contained page showing every rendered slide, grouped by language and platform, with device and language
 *  filters and a click-to-enlarge view (arrow keys step through). */
export async function websiteOf(title: string, groups: { lang: string; platform: string; shots: { alt: string; blob: Blob }[] }[]) {
  const langs = [...new Set(groups.map((g) => g.lang))]
  const platforms = [...new Set(groups.map((g) => g.platform))]
  const chips = (k: string, vs: string[]) => vs.length < 2 ? '' : `<div class="chips">${vs.map((v) => `<button data-k="${k}${esc(v)}" aria-pressed="true">${esc(v)}</button>`).join('')}</div>`
  let body = ''
  for (const g of groups) {
    const imgs = await Promise.all(g.shots.map(async (s) => `<button><img src="${await dataUrl(s.blob)}" alt="${esc(s.alt)}" loading="lazy"></button>`))
    body += `<section data-p="p${esc(g.platform)}" data-l="l${esc(g.lang)}"><h2>${esc(langs.length > 1 ? `${g.platform} · ${g.lang}` : g.platform)}</h2><div class="row">${imgs.join('')}</div></section>`
  }
  const filters = chips('p', platforms) + chips('l', langs)
  const fill = { title: esc(title), nav: filters && `<nav>${filters}</nav>`, sections: body }
  return new Blob([page.replace(/{{(\w+)}}/g, (_, k: keyof typeof fill) => fill[k])], { type: 'text/html' })
}
