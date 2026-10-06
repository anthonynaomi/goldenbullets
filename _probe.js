(() => {
  const info = (el) => { if(!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { color: cs.color, bg: cs.backgroundColor, border: cs.borderColor, w: Math.round(r.width), h: Math.round(r.height) }; };
  return {
    headerCountry: info(document.querySelector(".gb-header [data-country-select]")),
    headerCurrency: info(document.querySelector(".gb-header [data-currency-select]")),
    heroOutline: info(document.querySelector(".gb-hero__actions .gb-btn--outline")),
    promoOutline: info(document.querySelector(".gb-promo .gb-btn--outline")),
    footerCountry: info(document.querySelector(".gb-footer [data-country-select]"))
  };
})()
