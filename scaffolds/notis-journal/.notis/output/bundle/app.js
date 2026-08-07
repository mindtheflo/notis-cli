import { jsxs as I, jsx as b, Fragment as Dn } from "react/jsx-runtime";
import * as h from "react";
import { createContext as wi, useContext as sa, useState as Ke, useCallback as yt, useEffect as wt, useMemo as ue } from "react";
function kf({ children: e }) {
  return e;
}
const Jt = Symbol.for("notis.sdk.runtime_context");
function ua() {
  const e = globalThis;
  return e[Jt] || (e[Jt] = wi(null)), e[Jt];
}
const ca = ua();
function Rn() {
  return sa(ca);
}
function fa(e) {
  return typeof e == "string" && e.trim().length > 0;
}
function Le(e) {
  return e && typeof e == "object" && !Array.isArray(e) ? e : null;
}
function Q(e) {
  return fa(e) ? e.trim() : null;
}
function gr(e) {
  return typeof e == "string" ? e : Array.isArray(e) ? e.map((t) => {
    const n = Le(t), r = Le(n == null ? void 0 : n.text);
    return Q(r == null ? void 0 : r.content) ?? Q(n == null ? void 0 : n.plain_text) ?? "";
  }).join("") : "";
}
function ha(e) {
  var r, i;
  const t = Le(e);
  if (!t) return e;
  const n = Q(t.type);
  return n ? n === "title" ? gr(t.title) : n === "rich_text" ? gr(t.rich_text) : n === "select" || n === "status" ? Q((r = Le(t[n])) == null ? void 0 : r.name) ?? t[n] ?? null : n === "multi_select" ? (Array.isArray(t.multi_select) ? t.multi_select : []).map((l) => {
    var o;
    return Q((o = Le(l)) == null ? void 0 : o.name) ?? l;
  }).filter(Boolean) : n === "relation" ? (Array.isArray(t.relation) ? t.relation : []).map((l) => {
    var o;
    return Q((o = Le(l)) == null ? void 0 : o.id) ?? l;
  }).filter(Boolean) : n === "date" ? Q((i = Le(t.date)) == null ? void 0 : i.start) ?? t.date ?? null : n in t ? t[n] : e : e;
}
function da(e) {
  return e === "markdown" || e === "file" ? e : null;
}
function pa(e) {
  const t = Le(e) ?? {}, n = Le(t.properties) ?? {}, r = {};
  for (const [i, a] of Object.entries(n))
    r[i] = ha(a);
  return {
    id: Q(t.id) ?? "",
    title: Q(t.title) ?? "Untitled",
    url: Q(t.url),
    properties: r,
    icon: Q(t.icon),
    cover: Q(t.cover),
    databaseSlug: Q(t.databaseSlug) ?? Q(t.database_slug) ?? void 0,
    contentType: da(t.contentType ?? t.content_type),
    fileType: Q(t.fileType) ?? Q(t.file_type),
    contentBlocknote: Array.isArray(t.contentBlocknote) ? t.contentBlocknote : Array.isArray(t.content_blocknote) ? t.content_blocknote : null,
    contentMarkdown: Q(t.contentMarkdown) ?? Q(t.content_markdown),
    plainText: Q(t.plainText) ?? Q(t.plain_text),
    createdAt: Q(t.createdAt) ?? Q(t.created_at) ?? Q(t.created_time),
    lastEditedTime: Q(t.lastEditedTime) ?? Q(t.last_edited_time) ?? Q(t.updated_at)
  };
}
function ma(e, t = {}) {
  const n = Rn(), [r, i] = Ke([]), [a, l] = Ke(!0), [o, s] = Ke(null), [u, f] = Ke(0), c = t.enabled !== !1, p = JSON.stringify(t.filter ?? null), d = yt(() => {
    f((m) => m + 1);
  }, []);
  return wt(() => {
    if (!n || !c) {
      l(!1);
      return;
    }
    let m = !1;
    l(!0), s(null);
    const w = p === "null" ? null : JSON.parse(p);
    return (async () => {
      const x = [];
      let S = t.offset ?? 0;
      for (; ; ) {
        const C = await n.callTool("LOCAL_NOTIS_DATABASE_QUERY", {
          database_slug: e,
          query: {
            ...w ?? {},
            ...t.pageSize !== void 0 ? { page_size: t.pageSize } : {}
          },
          ...S > 0 ? { offset: S } : {}
        }), H = C.error ?? C.message;
        if (!C.documents && H)
          throw new Error(H);
        if (x.push(...C.documents ?? []), !t.fetchAll || !C.has_more) return x;
        const Z = C.next_offset;
        if (typeof Z != "number" || Z <= S)
          throw new Error("Database query returned an invalid pagination offset");
        S = Z;
      }
    })().then((x) => {
      m || (i(
        x.map(pa).filter((S) => S.id)
      ), l(!1));
    }).catch((x) => {
      m || (s(x instanceof Error ? x : new Error(String(x))), l(!1));
    }), () => {
      m = !0;
    };
  }, [n, e, c, u, p, t.fetchAll, t.offset, t.pageSize]), { documents: r, loading: a, error: o, refetch: d };
}
function ga() {
  const e = Rn(), t = yt((i) => {
    e != null && e.navigate ? e.navigate({ kind: "route", path: i }) : typeof window < "u" && (window.location.href = i);
  }, [e]), n = yt((i, a) => {
    e != null && e.navigate && e.navigate({ kind: "document", documentId: i, title: a ?? void 0 });
  }, [e]), r = yt(() => {
    e != null && e.navigate && e.navigate({ kind: "app" });
  }, [e]);
  return { toRoute: t, toDocument: n, toApp: r };
}
function ya(e) {
  const t = Rn(), { value: n, onChange: r, placeholder: i, onSubmit: a } = e;
  return wt(() => {
    const o = t == null ? void 0 : t.registerTopBarSearch;
    if (o)
      return o({ onChange: r, placeholder: i, onSubmit: a }), () => {
        o(null);
      };
  }, [t, r, i, a]), wt(() => {
    var o;
    (o = t == null ? void 0 : t.setTopBarSearchValue) == null || o.call(t, n);
  }, [t, n]), { setLoading: yt(
    (o) => {
      var s;
      (s = t == null ? void 0 : t.setTopBarSearchLoading) == null || s.call(t, o);
    },
    [t]
  ) };
}
function xa(e, t) {
  const n = {};
  return (e[e.length - 1] === "" ? [...e, ""] : e).join(
    (n.padRight ? " " : "") + "," + (n.padLeft === !1 ? "" : " ")
  ).trim();
}
const ba = /^[$_\p{ID_Start}][$_\u{200C}\u{200D}\p{ID_Continue}]*$/u, ka = /^[$_\p{ID_Start}][-$_\u{200C}\u{200D}\p{ID_Continue}]*$/u, wa = {};
function yr(e, t) {
  return (wa.jsx ? ka : ba).test(e);
}
const Aa = /[ \t\n\f\r]/g;
function va(e) {
  return typeof e == "object" ? e.type === "text" ? xr(e.value) : !1 : xr(e);
}
function xr(e) {
  return e.replace(Aa, "") === "";
}
class St {
  /**
   * @param {SchemaType['property']} property
   *   Property.
   * @param {SchemaType['normal']} normal
   *   Normal.
   * @param {Space | undefined} [space]
   *   Space.
   * @returns
   *   Schema.
   */
  constructor(t, n, r) {
    this.normal = n, this.property = t, r && (this.space = r);
  }
}
St.prototype.normal = {};
St.prototype.property = {};
St.prototype.space = void 0;
function Ai(e, t) {
  const n = {}, r = {};
  for (const i of e)
    Object.assign(n, i.property), Object.assign(r, i.normal);
  return new St(n, r, t);
}
function xn(e) {
  return e.toLowerCase();
}
class he {
  /**
   * @param {string} property
   *   Property.
   * @param {string} attribute
   *   Attribute.
   * @returns
   *   Info.
   */
  constructor(t, n) {
    this.attribute = n, this.property = t;
  }
}
he.prototype.attribute = "";
he.prototype.booleanish = !1;
he.prototype.boolean = !1;
he.prototype.commaOrSpaceSeparated = !1;
he.prototype.commaSeparated = !1;
he.prototype.defined = !1;
he.prototype.mustUseProperty = !1;
he.prototype.number = !1;
he.prototype.overloadedBoolean = !1;
he.prototype.property = "";
he.prototype.spaceSeparated = !1;
he.prototype.space = void 0;
let Ea = 0;
const D = We(), te = We(), bn = We(), M = We(), Y = We(), je = We(), me = We();
function We() {
  return 2 ** ++Ea;
}
const kn = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  boolean: D,
  booleanish: te,
  commaOrSpaceSeparated: me,
  commaSeparated: je,
  number: M,
  overloadedBoolean: bn,
  spaceSeparated: Y
}, Symbol.toStringTag, { value: "Module" })), Kt = (
  /** @type {ReadonlyArray<keyof typeof types>} */
  Object.keys(kn)
);
class _n extends he {
  /**
   * @constructor
   * @param {string} property
   *   Property.
   * @param {string} attribute
   *   Attribute.
   * @param {number | null | undefined} [mask]
   *   Mask.
   * @param {Space | undefined} [space]
   *   Space.
   * @returns
   *   Info.
   */
  constructor(t, n, r, i) {
    let a = -1;
    if (super(t, n), br(this, "space", i), typeof r == "number")
      for (; ++a < Kt.length; ) {
        const l = Kt[a];
        br(this, Kt[a], (r & kn[l]) === kn[l]);
      }
  }
}
_n.prototype.defined = !0;
function br(e, t, n) {
  n && (e[t] = n);
}
function it(e) {
  const t = {}, n = {};
  for (const [r, i] of Object.entries(e.properties)) {
    const a = new _n(
      r,
      e.transform(e.attributes || {}, r),
      i,
      e.space
    );
    e.mustUseProperty && e.mustUseProperty.includes(r) && (a.mustUseProperty = !0), t[r] = a, n[xn(r)] = r, n[xn(a.attribute)] = r;
  }
  return new St(t, n, e.space);
}
const vi = it({
  properties: {
    ariaActiveDescendant: null,
    ariaAtomic: te,
    ariaAutoComplete: null,
    ariaBusy: te,
    ariaChecked: te,
    ariaColCount: M,
    ariaColIndex: M,
    ariaColSpan: M,
    ariaControls: Y,
    ariaCurrent: null,
    ariaDescribedBy: Y,
    ariaDetails: null,
    ariaDisabled: te,
    ariaDropEffect: Y,
    ariaErrorMessage: null,
    ariaExpanded: te,
    ariaFlowTo: Y,
    ariaGrabbed: te,
    ariaHasPopup: null,
    ariaHidden: te,
    ariaInvalid: null,
    ariaKeyShortcuts: null,
    ariaLabel: null,
    ariaLabelledBy: Y,
    ariaLevel: M,
    ariaLive: null,
    ariaModal: te,
    ariaMultiLine: te,
    ariaMultiSelectable: te,
    ariaOrientation: null,
    ariaOwns: Y,
    ariaPlaceholder: null,
    ariaPosInSet: M,
    ariaPressed: te,
    ariaReadOnly: te,
    ariaRelevant: null,
    ariaRequired: te,
    ariaRoleDescription: Y,
    ariaRowCount: M,
    ariaRowIndex: M,
    ariaRowSpan: M,
    ariaSelected: te,
    ariaSetSize: M,
    ariaSort: null,
    ariaValueMax: M,
    ariaValueMin: M,
    ariaValueNow: M,
    ariaValueText: null,
    role: null
  },
  transform(e, t) {
    return t === "role" ? t : "aria-" + t.slice(4).toLowerCase();
  }
});
function Ei(e, t) {
  return t in e ? e[t] : t;
}
function Ci(e, t) {
  return Ei(e, t.toLowerCase());
}
const Ca = it({
  attributes: {
    acceptcharset: "accept-charset",
    classname: "class",
    htmlfor: "for",
    httpequiv: "http-equiv"
  },
  mustUseProperty: ["checked", "multiple", "muted", "selected"],
  properties: {
    // Standard Properties.
    abbr: null,
    accept: je,
    acceptCharset: Y,
    accessKey: Y,
    action: null,
    allow: null,
    allowFullScreen: D,
    allowPaymentRequest: D,
    allowUserMedia: D,
    alpha: D,
    alt: null,
    as: null,
    async: D,
    autoCapitalize: null,
    autoComplete: Y,
    autoFocus: D,
    autoPlay: D,
    blocking: Y,
    capture: null,
    charSet: null,
    checked: D,
    cite: null,
    className: Y,
    closedBy: null,
    colorSpace: null,
    cols: M,
    colSpan: M,
    command: null,
    commandFor: null,
    content: null,
    contentEditable: te,
    controls: D,
    controlsList: Y,
    coords: M | je,
    crossOrigin: null,
    data: null,
    dateTime: null,
    decoding: null,
    default: D,
    defer: D,
    dir: null,
    dirName: null,
    disabled: D,
    download: bn,
    draggable: te,
    encType: null,
    enterKeyHint: null,
    fetchPriority: null,
    form: null,
    formAction: null,
    formEncType: null,
    formMethod: null,
    formNoValidate: D,
    formTarget: null,
    headers: Y,
    height: M,
    hidden: bn,
    high: M,
    href: null,
    hrefLang: null,
    htmlFor: Y,
    httpEquiv: Y,
    id: null,
    imageSizes: null,
    imageSrcSet: null,
    inert: D,
    inputMode: null,
    integrity: null,
    is: null,
    isMap: D,
    itemId: null,
    itemProp: Y,
    itemRef: Y,
    itemScope: D,
    itemType: Y,
    kind: null,
    label: null,
    lang: null,
    language: null,
    list: null,
    loading: null,
    loop: D,
    low: M,
    manifest: null,
    max: null,
    maxLength: M,
    media: null,
    method: null,
    min: null,
    minLength: M,
    multiple: D,
    muted: D,
    name: null,
    nonce: null,
    noModule: D,
    noValidate: D,
    onAbort: null,
    onAfterPrint: null,
    onAuxClick: null,
    onBeforeMatch: null,
    onBeforePrint: null,
    onBeforeToggle: null,
    onBeforeUnload: null,
    onBlur: null,
    onCancel: null,
    onCanPlay: null,
    onCanPlayThrough: null,
    onChange: null,
    onClick: null,
    onClose: null,
    onContextLost: null,
    onContextMenu: null,
    onContextRestored: null,
    onCopy: null,
    onCueChange: null,
    onCut: null,
    onDblClick: null,
    onDrag: null,
    onDragEnd: null,
    onDragEnter: null,
    onDragExit: null,
    onDragLeave: null,
    onDragOver: null,
    onDragStart: null,
    onDrop: null,
    onDurationChange: null,
    onEmptied: null,
    onEnded: null,
    onError: null,
    onFocus: null,
    onFormData: null,
    onHashChange: null,
    onInput: null,
    onInvalid: null,
    onKeyDown: null,
    onKeyPress: null,
    onKeyUp: null,
    onLanguageChange: null,
    onLoad: null,
    onLoadedData: null,
    onLoadedMetadata: null,
    onLoadEnd: null,
    onLoadStart: null,
    onMessage: null,
    onMessageError: null,
    onMouseDown: null,
    onMouseEnter: null,
    onMouseLeave: null,
    onMouseMove: null,
    onMouseOut: null,
    onMouseOver: null,
    onMouseUp: null,
    onOffline: null,
    onOnline: null,
    onPageHide: null,
    onPageShow: null,
    onPaste: null,
    onPause: null,
    onPlay: null,
    onPlaying: null,
    onPopState: null,
    onProgress: null,
    onRateChange: null,
    onRejectionHandled: null,
    onReset: null,
    onResize: null,
    onScroll: null,
    onScrollEnd: null,
    onSecurityPolicyViolation: null,
    onSeeked: null,
    onSeeking: null,
    onSelect: null,
    onSlotChange: null,
    onStalled: null,
    onStorage: null,
    onSubmit: null,
    onSuspend: null,
    onTimeUpdate: null,
    onToggle: null,
    onUnhandledRejection: null,
    onUnload: null,
    onVolumeChange: null,
    onWaiting: null,
    onWheel: null,
    open: D,
    optimum: M,
    pattern: null,
    ping: Y,
    placeholder: null,
    playsInline: D,
    popover: null,
    popoverTarget: null,
    popoverTargetAction: null,
    poster: null,
    preload: null,
    readOnly: D,
    referrerPolicy: null,
    rel: Y,
    required: D,
    reversed: D,
    rows: M,
    rowSpan: M,
    sandbox: Y,
    scope: null,
    scoped: D,
    seamless: D,
    selected: D,
    shadowRootClonable: D,
    shadowRootCustomElementRegistry: D,
    shadowRootDelegatesFocus: D,
    shadowRootMode: null,
    shadowRootSerializable: D,
    shape: null,
    size: M,
    sizes: null,
    slot: null,
    span: M,
    spellCheck: te,
    src: null,
    srcDoc: null,
    srcLang: null,
    srcSet: null,
    start: M,
    step: null,
    style: null,
    tabIndex: M,
    target: null,
    title: null,
    translate: null,
    type: null,
    typeMustMatch: D,
    useMap: null,
    value: te,
    width: M,
    wrap: null,
    writingSuggestions: null,
    // Legacy.
    // See: https://html.spec.whatwg.org/#other-elements,-attributes-and-apis
    align: null,
    // Several. Use CSS `text-align` instead,
    aLink: null,
    // `<body>`. Use CSS `a:active {color}` instead
    archive: Y,
    // `<object>`. List of URIs to archives
    axis: null,
    // `<td>` and `<th>`. Use `scope` on `<th>`
    background: null,
    // `<body>`. Use CSS `background-image` instead
    bgColor: null,
    // `<body>` and table elements. Use CSS `background-color` instead
    border: M,
    // `<table>`. Use CSS `border-width` instead,
    borderColor: null,
    // `<table>`. Use CSS `border-color` instead,
    bottomMargin: M,
    // `<body>`
    cellPadding: null,
    // `<table>`
    cellSpacing: null,
    // `<table>`
    char: null,
    // Several table elements. When `align=char`, sets the character to align on
    charOff: null,
    // Several table elements. When `char`, offsets the alignment
    classId: null,
    // `<object>`
    clear: null,
    // `<br>`. Use CSS `clear` instead
    code: null,
    // `<object>`
    codeBase: null,
    // `<object>`
    codeType: null,
    // `<object>`
    color: null,
    // `<font>` and `<hr>`. Use CSS instead
    compact: D,
    // Lists. Use CSS to reduce space between items instead
    declare: D,
    // `<object>`
    event: null,
    // `<script>`
    face: null,
    // `<font>`. Use CSS instead
    frame: null,
    // `<table>`
    frameBorder: null,
    // `<iframe>`. Use CSS `border` instead
    hSpace: M,
    // `<img>` and `<object>`
    leftMargin: M,
    // `<body>`
    link: null,
    // `<body>`. Use CSS `a:link {color: *}` instead
    longDesc: null,
    // `<frame>`, `<iframe>`, and `<img>`. Use an `<a>`
    lowSrc: null,
    // `<img>`. Use a `<picture>`
    marginHeight: M,
    // `<body>`
    marginWidth: M,
    // `<body>`
    noResize: D,
    // `<frame>`
    noHref: D,
    // `<area>`. Use no href instead of an explicit `nohref`
    noShade: D,
    // `<hr>`. Use background-color and height instead of borders
    noWrap: D,
    // `<td>` and `<th>`
    object: null,
    // `<applet>`
    profile: null,
    // `<head>`
    prompt: null,
    // `<isindex>`
    rev: null,
    // `<link>`
    rightMargin: M,
    // `<body>`
    rules: null,
    // `<table>`
    scheme: null,
    // `<meta>`
    scrolling: te,
    // `<frame>`. Use overflow in the child context
    standby: null,
    // `<object>`
    summary: null,
    // `<table>`
    text: null,
    // `<body>`. Use CSS `color` instead
    topMargin: M,
    // `<body>`
    valueType: null,
    // `<param>`
    version: null,
    // `<html>`. Use a doctype.
    vAlign: null,
    // Several. Use CSS `vertical-align` instead
    vLink: null,
    // `<body>`. Use CSS `a:visited {color}` instead
    vSpace: M,
    // `<img>` and `<object>`
    // Non-standard Properties.
    allowTransparency: null,
    autoCorrect: null,
    autoSave: null,
    credentialless: D,
    disablePictureInPicture: D,
    disableRemotePlayback: D,
    exportParts: je,
    part: Y,
    prefix: null,
    property: null,
    results: M,
    security: null,
    unselectable: null
  },
  space: "html",
  transform: Ci
}), Sa = it({
  attributes: {
    accentHeight: "accent-height",
    alignmentBaseline: "alignment-baseline",
    arabicForm: "arabic-form",
    baselineShift: "baseline-shift",
    capHeight: "cap-height",
    className: "class",
    clipPath: "clip-path",
    clipRule: "clip-rule",
    colorInterpolation: "color-interpolation",
    colorInterpolationFilters: "color-interpolation-filters",
    colorProfile: "color-profile",
    colorRendering: "color-rendering",
    crossOrigin: "crossorigin",
    dataType: "datatype",
    dominantBaseline: "dominant-baseline",
    enableBackground: "enable-background",
    fillOpacity: "fill-opacity",
    fillRule: "fill-rule",
    floodColor: "flood-color",
    floodOpacity: "flood-opacity",
    fontFamily: "font-family",
    fontSize: "font-size",
    fontSizeAdjust: "font-size-adjust",
    fontStretch: "font-stretch",
    fontStyle: "font-style",
    fontVariant: "font-variant",
    fontWeight: "font-weight",
    glyphName: "glyph-name",
    glyphOrientationHorizontal: "glyph-orientation-horizontal",
    glyphOrientationVertical: "glyph-orientation-vertical",
    hrefLang: "hreflang",
    horizAdvX: "horiz-adv-x",
    horizOriginX: "horiz-origin-x",
    horizOriginY: "horiz-origin-y",
    imageRendering: "image-rendering",
    letterSpacing: "letter-spacing",
    lightingColor: "lighting-color",
    markerEnd: "marker-end",
    markerMid: "marker-mid",
    markerStart: "marker-start",
    maskType: "mask-type",
    navDown: "nav-down",
    navDownLeft: "nav-down-left",
    navDownRight: "nav-down-right",
    navLeft: "nav-left",
    navNext: "nav-next",
    navPrev: "nav-prev",
    navRight: "nav-right",
    navUp: "nav-up",
    navUpLeft: "nav-up-left",
    navUpRight: "nav-up-right",
    onAbort: "onabort",
    onActivate: "onactivate",
    onAfterPrint: "onafterprint",
    onBeforePrint: "onbeforeprint",
    onBegin: "onbegin",
    onCancel: "oncancel",
    onCanPlay: "oncanplay",
    onCanPlayThrough: "oncanplaythrough",
    onChange: "onchange",
    onClick: "onclick",
    onClose: "onclose",
    onCopy: "oncopy",
    onCueChange: "oncuechange",
    onCut: "oncut",
    onDblClick: "ondblclick",
    onDrag: "ondrag",
    onDragEnd: "ondragend",
    onDragEnter: "ondragenter",
    onDragExit: "ondragexit",
    onDragLeave: "ondragleave",
    onDragOver: "ondragover",
    onDragStart: "ondragstart",
    onDrop: "ondrop",
    onDurationChange: "ondurationchange",
    onEmptied: "onemptied",
    onEnd: "onend",
    onEnded: "onended",
    onError: "onerror",
    onFocus: "onfocus",
    onFocusIn: "onfocusin",
    onFocusOut: "onfocusout",
    onHashChange: "onhashchange",
    onInput: "oninput",
    onInvalid: "oninvalid",
    onKeyDown: "onkeydown",
    onKeyPress: "onkeypress",
    onKeyUp: "onkeyup",
    onLoad: "onload",
    onLoadedData: "onloadeddata",
    onLoadedMetadata: "onloadedmetadata",
    onLoadStart: "onloadstart",
    onMessage: "onmessage",
    onMouseDown: "onmousedown",
    onMouseEnter: "onmouseenter",
    onMouseLeave: "onmouseleave",
    onMouseMove: "onmousemove",
    onMouseOut: "onmouseout",
    onMouseOver: "onmouseover",
    onMouseUp: "onmouseup",
    onMouseWheel: "onmousewheel",
    onOffline: "onoffline",
    onOnline: "ononline",
    onPageHide: "onpagehide",
    onPageShow: "onpageshow",
    onPaste: "onpaste",
    onPause: "onpause",
    onPlay: "onplay",
    onPlaying: "onplaying",
    onPopState: "onpopstate",
    onProgress: "onprogress",
    onRateChange: "onratechange",
    onRepeat: "onrepeat",
    onReset: "onreset",
    onResize: "onresize",
    onScroll: "onscroll",
    onSeeked: "onseeked",
    onSeeking: "onseeking",
    onSelect: "onselect",
    onShow: "onshow",
    onStalled: "onstalled",
    onStorage: "onstorage",
    onSubmit: "onsubmit",
    onSuspend: "onsuspend",
    onTimeUpdate: "ontimeupdate",
    onToggle: "ontoggle",
    onUnload: "onunload",
    onVolumeChange: "onvolumechange",
    onWaiting: "onwaiting",
    onZoom: "onzoom",
    overlinePosition: "overline-position",
    overlineThickness: "overline-thickness",
    paintOrder: "paint-order",
    panose1: "panose-1",
    pointerEvents: "pointer-events",
    referrerPolicy: "referrerpolicy",
    renderingIntent: "rendering-intent",
    shapeRendering: "shape-rendering",
    stopColor: "stop-color",
    stopOpacity: "stop-opacity",
    strikethroughPosition: "strikethrough-position",
    strikethroughThickness: "strikethrough-thickness",
    strokeDashArray: "stroke-dasharray",
    strokeDashOffset: "stroke-dashoffset",
    strokeLineCap: "stroke-linecap",
    strokeLineJoin: "stroke-linejoin",
    strokeMiterLimit: "stroke-miterlimit",
    strokeOpacity: "stroke-opacity",
    strokeWidth: "stroke-width",
    tabIndex: "tabindex",
    textAnchor: "text-anchor",
    textDecoration: "text-decoration",
    textRendering: "text-rendering",
    transformOrigin: "transform-origin",
    typeOf: "typeof",
    underlinePosition: "underline-position",
    underlineThickness: "underline-thickness",
    unicodeBidi: "unicode-bidi",
    unicodeRange: "unicode-range",
    unitsPerEm: "units-per-em",
    vAlphabetic: "v-alphabetic",
    vHanging: "v-hanging",
    vIdeographic: "v-ideographic",
    vMathematical: "v-mathematical",
    vectorEffect: "vector-effect",
    vertAdvY: "vert-adv-y",
    vertOriginX: "vert-origin-x",
    vertOriginY: "vert-origin-y",
    wordSpacing: "word-spacing",
    writingMode: "writing-mode",
    xHeight: "x-height",
    // These were camelcased in Tiny. Now lowercased in SVG 2
    playbackOrder: "playbackorder",
    timelineBegin: "timelinebegin"
  },
  properties: {
    about: me,
    accentHeight: M,
    accumulate: null,
    additive: null,
    alignmentBaseline: null,
    alphabetic: M,
    amplitude: M,
    arabicForm: null,
    ascent: M,
    attributeName: null,
    attributeType: null,
    azimuth: M,
    bandwidth: null,
    baselineShift: null,
    baseFrequency: null,
    baseProfile: null,
    bbox: null,
    begin: null,
    bias: M,
    by: null,
    calcMode: null,
    capHeight: M,
    className: Y,
    clip: null,
    clipPath: null,
    clipPathUnits: null,
    clipRule: null,
    color: null,
    colorInterpolation: null,
    colorInterpolationFilters: null,
    colorProfile: null,
    colorRendering: null,
    content: null,
    contentScriptType: null,
    contentStyleType: null,
    crossOrigin: null,
    cursor: null,
    cx: null,
    cy: null,
    d: null,
    dataType: null,
    defaultAction: null,
    descent: M,
    diffuseConstant: M,
    direction: null,
    display: null,
    dur: null,
    divisor: M,
    dominantBaseline: null,
    download: D,
    dx: null,
    dy: null,
    edgeMode: null,
    editable: null,
    elevation: M,
    enableBackground: null,
    end: null,
    event: null,
    exponent: M,
    externalResourcesRequired: null,
    fill: null,
    fillOpacity: M,
    fillRule: null,
    filter: null,
    filterRes: null,
    filterUnits: null,
    floodColor: null,
    floodOpacity: null,
    focusable: null,
    focusHighlight: null,
    fontFamily: null,
    fontSize: null,
    fontSizeAdjust: null,
    fontStretch: null,
    fontStyle: null,
    fontVariant: null,
    fontWeight: null,
    format: null,
    fr: null,
    from: null,
    fx: null,
    fy: null,
    g1: je,
    g2: je,
    glyphName: je,
    glyphOrientationHorizontal: null,
    glyphOrientationVertical: null,
    glyphRef: null,
    gradientTransform: null,
    gradientUnits: null,
    handler: null,
    hanging: M,
    hatchContentUnits: null,
    hatchUnits: null,
    height: null,
    href: null,
    hrefLang: null,
    horizAdvX: M,
    horizOriginX: M,
    horizOriginY: M,
    id: null,
    ideographic: M,
    imageRendering: null,
    initialVisibility: null,
    in: null,
    in2: null,
    intercept: M,
    k: M,
    k1: M,
    k2: M,
    k3: M,
    k4: M,
    kernelMatrix: me,
    kernelUnitLength: null,
    keyPoints: null,
    // SEMI_COLON_SEPARATED
    keySplines: null,
    // SEMI_COLON_SEPARATED
    keyTimes: null,
    // SEMI_COLON_SEPARATED
    kerning: null,
    lang: null,
    lengthAdjust: null,
    letterSpacing: null,
    lightingColor: null,
    limitingConeAngle: M,
    local: null,
    markerEnd: null,
    markerMid: null,
    markerStart: null,
    markerHeight: null,
    markerUnits: null,
    markerWidth: null,
    mask: null,
    maskContentUnits: null,
    maskType: null,
    maskUnits: null,
    mathematical: null,
    max: null,
    media: null,
    mediaCharacterEncoding: null,
    mediaContentEncodings: null,
    mediaSize: M,
    mediaTime: null,
    method: null,
    min: null,
    mode: null,
    name: null,
    navDown: null,
    navDownLeft: null,
    navDownRight: null,
    navLeft: null,
    navNext: null,
    navPrev: null,
    navRight: null,
    navUp: null,
    navUpLeft: null,
    navUpRight: null,
    numOctaves: null,
    observer: null,
    offset: null,
    onAbort: null,
    onActivate: null,
    onAfterPrint: null,
    onBeforePrint: null,
    onBegin: null,
    onCancel: null,
    onCanPlay: null,
    onCanPlayThrough: null,
    onChange: null,
    onClick: null,
    onClose: null,
    onCopy: null,
    onCueChange: null,
    onCut: null,
    onDblClick: null,
    onDrag: null,
    onDragEnd: null,
    onDragEnter: null,
    onDragExit: null,
    onDragLeave: null,
    onDragOver: null,
    onDragStart: null,
    onDrop: null,
    onDurationChange: null,
    onEmptied: null,
    onEnd: null,
    onEnded: null,
    onError: null,
    onFocus: null,
    onFocusIn: null,
    onFocusOut: null,
    onHashChange: null,
    onInput: null,
    onInvalid: null,
    onKeyDown: null,
    onKeyPress: null,
    onKeyUp: null,
    onLoad: null,
    onLoadedData: null,
    onLoadedMetadata: null,
    onLoadStart: null,
    onMessage: null,
    onMouseDown: null,
    onMouseEnter: null,
    onMouseLeave: null,
    onMouseMove: null,
    onMouseOut: null,
    onMouseOver: null,
    onMouseUp: null,
    onMouseWheel: null,
    onOffline: null,
    onOnline: null,
    onPageHide: null,
    onPageShow: null,
    onPaste: null,
    onPause: null,
    onPlay: null,
    onPlaying: null,
    onPopState: null,
    onProgress: null,
    onRateChange: null,
    onRepeat: null,
    onReset: null,
    onResize: null,
    onScroll: null,
    onSeeked: null,
    onSeeking: null,
    onSelect: null,
    onShow: null,
    onStalled: null,
    onStorage: null,
    onSubmit: null,
    onSuspend: null,
    onTimeUpdate: null,
    onToggle: null,
    onUnload: null,
    onVolumeChange: null,
    onWaiting: null,
    onZoom: null,
    opacity: null,
    operator: null,
    order: null,
    orient: null,
    orientation: null,
    origin: null,
    overflow: null,
    overlay: null,
    overlinePosition: M,
    overlineThickness: M,
    paintOrder: null,
    panose1: null,
    path: null,
    pathLength: M,
    patternContentUnits: null,
    patternTransform: null,
    patternUnits: null,
    phase: null,
    ping: Y,
    pitch: null,
    playbackOrder: null,
    pointerEvents: null,
    points: null,
    pointsAtX: M,
    pointsAtY: M,
    pointsAtZ: M,
    preserveAlpha: null,
    preserveAspectRatio: null,
    primitiveUnits: null,
    propagate: null,
    property: me,
    r: null,
    radius: null,
    referrerPolicy: null,
    refX: null,
    refY: null,
    rel: me,
    rev: me,
    renderingIntent: null,
    repeatCount: null,
    repeatDur: null,
    requiredExtensions: me,
    requiredFeatures: me,
    requiredFonts: me,
    requiredFormats: me,
    resource: null,
    restart: null,
    result: null,
    rotate: null,
    rx: null,
    ry: null,
    scale: null,
    seed: null,
    shapeRendering: null,
    side: null,
    slope: null,
    snapshotTime: null,
    specularConstant: M,
    specularExponent: M,
    spreadMethod: null,
    spacing: null,
    startOffset: null,
    stdDeviation: null,
    stemh: null,
    stemv: null,
    stitchTiles: null,
    stopColor: null,
    stopOpacity: null,
    strikethroughPosition: M,
    strikethroughThickness: M,
    string: null,
    stroke: null,
    strokeDashArray: me,
    strokeDashOffset: null,
    strokeLineCap: null,
    strokeLineJoin: null,
    strokeMiterLimit: M,
    strokeOpacity: M,
    strokeWidth: null,
    style: null,
    surfaceScale: M,
    syncBehavior: null,
    syncBehaviorDefault: null,
    syncMaster: null,
    syncTolerance: null,
    syncToleranceDefault: null,
    systemLanguage: me,
    tabIndex: M,
    tableValues: null,
    target: null,
    targetX: M,
    targetY: M,
    textAnchor: null,
    textDecoration: null,
    textRendering: null,
    textLength: null,
    timelineBegin: null,
    title: null,
    transformBehavior: null,
    type: null,
    typeOf: me,
    to: null,
    transform: null,
    transformOrigin: null,
    u1: null,
    u2: null,
    underlinePosition: M,
    underlineThickness: M,
    unicode: null,
    unicodeBidi: null,
    unicodeRange: null,
    unitsPerEm: M,
    values: null,
    vAlphabetic: M,
    vMathematical: M,
    vectorEffect: null,
    vHanging: M,
    vIdeographic: M,
    version: null,
    vertAdvY: M,
    vertOriginX: M,
    vertOriginY: M,
    viewBox: null,
    viewTarget: null,
    visibility: null,
    width: null,
    widths: null,
    wordSpacing: null,
    writingMode: null,
    x: null,
    x1: null,
    x2: null,
    xChannelSelector: null,
    xHeight: M,
    y: null,
    y1: null,
    y2: null,
    yChannelSelector: null,
    z: null,
    zoomAndPan: null
  },
  space: "svg",
  transform: Ei
}), Si = it({
  properties: {
    xLinkActuate: null,
    xLinkArcRole: null,
    xLinkHref: null,
    xLinkRole: null,
    xLinkShow: null,
    xLinkTitle: null,
    xLinkType: null
  },
  space: "xlink",
  transform(e, t) {
    return "xlink:" + t.slice(5).toLowerCase();
  }
}), Mi = it({
  attributes: { xmlnsxlink: "xmlns:xlink" },
  properties: { xmlnsXLink: null, xmlns: null },
  space: "xmlns",
  transform: Ci
}), Li = it({
  properties: { xmlBase: null, xmlLang: null, xmlSpace: null },
  space: "xml",
  transform(e, t) {
    return "xml:" + t.slice(3).toLowerCase();
  }
}), Ma = {
  classId: "classID",
  dataType: "datatype",
  itemId: "itemID",
  strokeDashArray: "strokeDasharray",
  strokeDashOffset: "strokeDashoffset",
  strokeLineCap: "strokeLinecap",
  strokeLineJoin: "strokeLinejoin",
  strokeMiterLimit: "strokeMiterlimit",
  typeOf: "typeof",
  xLinkActuate: "xlinkActuate",
  xLinkArcRole: "xlinkArcrole",
  xLinkHref: "xlinkHref",
  xLinkRole: "xlinkRole",
  xLinkShow: "xlinkShow",
  xLinkTitle: "xlinkTitle",
  xLinkType: "xlinkType",
  xmlnsXLink: "xmlnsXlink"
}, La = /[A-Z]/g, kr = /-[a-z]/g, Na = /^data[-\w.:]+$/i;
function Ia(e, t) {
  const n = xn(t);
  let r = t, i = he;
  if (n in e.normal)
    return e.property[e.normal[n]];
  if (n.length > 4 && n.slice(0, 4) === "data" && Na.test(t)) {
    if (t.charAt(4) === "-") {
      const a = t.slice(5).replace(kr, Fa);
      r = "data" + a.charAt(0).toUpperCase() + a.slice(1);
    } else {
      const a = t.slice(4);
      if (!kr.test(a)) {
        let l = a.replace(La, Ta);
        l.charAt(0) !== "-" && (l = "-" + l), t = "data" + l;
      }
    }
    i = _n;
  }
  return new i(r, t);
}
function Ta(e) {
  return "-" + e.toLowerCase();
}
function Fa(e) {
  return e.charAt(1).toUpperCase();
}
const za = Ai([vi, Ca, Si, Mi, Li], "html"), Vn = Ai([vi, Sa, Si, Mi, Li], "svg");
function Ha(e) {
  return e.join(" ").trim();
}
function Ni(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var Xe = {}, en, wr;
function Pa() {
  if (wr) return en;
  wr = 1;
  var e = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, t = /\n/g, n = /^\s*/, r = /^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/, i = /^:\s*/, a = /^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/, l = /^[;\s]*/, o = /^\s+|\s+$/g, s = `
`, u = "/", f = "*", c = "", p = "comment", d = "declaration";
  function m(k, x) {
    if (typeof k != "string")
      throw new TypeError("First argument must be a string");
    if (!k) return [];
    x = x || {};
    var S = 1, C = 1;
    function H(z) {
      var T = z.match(t);
      T && (S += T.length);
      var W = z.lastIndexOf(s);
      C = ~W ? z.length - W : C + z.length;
    }
    function Z() {
      var z = { line: S, column: C };
      return function(T) {
        return T.position = new v(z), B(), T;
      };
    }
    function v(z) {
      this.start = z, this.end = { line: S, column: C }, this.source = x.source;
    }
    v.prototype.content = k;
    function V(z) {
      var T = new Error(
        x.source + ":" + S + ":" + C + ": " + z
      );
      if (T.reason = z, T.filename = x.source, T.line = S, T.column = C, T.source = k, !x.silent) throw T;
    }
    function $(z) {
      var T = z.exec(k);
      if (T) {
        var W = T[0];
        return H(W), k = k.slice(W.length), T;
      }
    }
    function B() {
      $(n);
    }
    function A(z) {
      var T;
      for (z = z || []; T = F(); )
        T !== !1 && z.push(T);
      return z;
    }
    function F() {
      var z = Z();
      if (!(u != k.charAt(0) || f != k.charAt(1))) {
        for (var T = 2; c != k.charAt(T) && (f != k.charAt(T) || u != k.charAt(T + 1)); )
          ++T;
        if (T += 2, c === k.charAt(T - 1))
          return V("End of comment missing");
        var W = k.slice(2, T - 2);
        return C += 2, H(W), k = k.slice(T), C += 2, z({
          type: p,
          comment: W
        });
      }
    }
    function L() {
      var z = Z(), T = $(r);
      if (T) {
        if (F(), !$(i)) return V("property missing ':'");
        var W = $(a), K = z({
          type: d,
          property: w(T[0].replace(e, c)),
          value: W ? w(W[0].replace(e, c)) : c
        });
        return $(l), K;
      }
    }
    function q() {
      var z = [];
      A(z);
      for (var T; T = L(); )
        T !== !1 && (z.push(T), A(z));
      return z;
    }
    return B(), q();
  }
  function w(k) {
    return k ? k.replace(o, c) : c;
  }
  return en = m, en;
}
var Ar;
function Za() {
  if (Ar) return Xe;
  Ar = 1;
  var e = Xe && Xe.__importDefault || function(r) {
    return r && r.__esModule ? r : { default: r };
  };
  Object.defineProperty(Xe, "__esModule", { value: !0 }), Xe.default = n;
  const t = e(Pa());
  function n(r, i) {
    let a = null;
    if (!r || typeof r != "string")
      return a;
    const l = (0, t.default)(r), o = typeof i == "function";
    return l.forEach((s) => {
      if (s.type !== "declaration")
        return;
      const { property: u, value: f } = s;
      o ? i(u, f, s) : f && (a = a || {}, a[u] = f);
    }), a;
  }
  return Xe;
}
var ct = {}, vr;
function Da() {
  if (vr) return ct;
  vr = 1, Object.defineProperty(ct, "__esModule", { value: !0 }), ct.camelCase = void 0;
  var e = /^--[a-zA-Z0-9_-]+$/, t = /-([a-z])/g, n = /^[^-]+$/, r = /^-(webkit|moz|ms|o|khtml)-/, i = /^-(ms)-/, a = function(u) {
    return !u || n.test(u) || e.test(u);
  }, l = function(u, f) {
    return f.toUpperCase();
  }, o = function(u, f) {
    return "".concat(f, "-");
  }, s = function(u, f) {
    return f === void 0 && (f = {}), a(u) ? u : (u = u.toLowerCase(), f.reactCompat ? u = u.replace(i, o) : u = u.replace(r, o), u.replace(t, l));
  };
  return ct.camelCase = s, ct;
}
var ft, Er;
function Ra() {
  if (Er) return ft;
  Er = 1;
  var e = ft && ft.__importDefault || function(i) {
    return i && i.__esModule ? i : { default: i };
  }, t = e(Za()), n = Da();
  function r(i, a) {
    var l = {};
    return !i || typeof i != "string" || (0, t.default)(i, function(o, s) {
      o && s && (l[(0, n.camelCase)(o, a)] = s);
    }), l;
  }
  return r.default = r, ft = r, ft;
}
var _a = Ra();
const Va = /* @__PURE__ */ Ni(_a), Ii = Ti("end"), On = Ti("start");
function Ti(e) {
  return t;
  function t(n) {
    const r = n && n.position && n.position[e] || {};
    if (typeof r.line == "number" && r.line > 0 && typeof r.column == "number" && r.column > 0)
      return {
        line: r.line,
        column: r.column,
        offset: typeof r.offset == "number" && r.offset > -1 ? r.offset : void 0
      };
  }
}
function Oa(e) {
  const t = On(e), n = Ii(e);
  if (t && n)
    return { start: t, end: n };
}
function xt(e) {
  return !e || typeof e != "object" ? "" : "position" in e || "type" in e ? Cr(e.position) : "start" in e || "end" in e ? Cr(e) : "line" in e || "column" in e ? wn(e) : "";
}
function wn(e) {
  return Sr(e && e.line) + ":" + Sr(e && e.column);
}
function Cr(e) {
  return wn(e && e.start) + "-" + wn(e && e.end);
}
function Sr(e) {
  return e && typeof e == "number" ? e : 1;
}
class ae extends Error {
  /**
   * Create a message for `reason`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {Options | null | undefined} [options]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | Options | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns
   *   Instance of `VFileMessage`.
   */
  // eslint-disable-next-line complexity
  constructor(t, n, r) {
    super(), typeof n == "string" && (r = n, n = void 0);
    let i = "", a = {}, l = !1;
    if (n && ("line" in n && "column" in n ? a = { place: n } : "start" in n && "end" in n ? a = { place: n } : "type" in n ? a = {
      ancestors: [n],
      place: n.position
    } : a = { ...n }), typeof t == "string" ? i = t : !a.cause && t && (l = !0, i = t.message, a.cause = t), !a.ruleId && !a.source && typeof r == "string") {
      const s = r.indexOf(":");
      s === -1 ? a.ruleId = r : (a.source = r.slice(0, s), a.ruleId = r.slice(s + 1));
    }
    if (!a.place && a.ancestors && a.ancestors) {
      const s = a.ancestors[a.ancestors.length - 1];
      s && (a.place = s.position);
    }
    const o = a.place && "start" in a.place ? a.place.start : a.place;
    this.ancestors = a.ancestors || void 0, this.cause = a.cause || void 0, this.column = o ? o.column : void 0, this.fatal = void 0, this.file = "", this.message = i, this.line = o ? o.line : void 0, this.name = xt(a.place) || "1:1", this.place = a.place || void 0, this.reason = this.message, this.ruleId = a.ruleId || void 0, this.source = a.source || void 0, this.stack = l && a.cause && typeof a.cause.stack == "string" ? a.cause.stack : "", this.actual = void 0, this.expected = void 0, this.note = void 0, this.url = void 0;
  }
}
ae.prototype.file = "";
ae.prototype.name = "";
ae.prototype.reason = "";
ae.prototype.message = "";
ae.prototype.stack = "";
ae.prototype.column = void 0;
ae.prototype.line = void 0;
ae.prototype.ancestors = void 0;
ae.prototype.cause = void 0;
ae.prototype.fatal = void 0;
ae.prototype.place = void 0;
ae.prototype.ruleId = void 0;
ae.prototype.source = void 0;
const Bn = {}.hasOwnProperty, Ba = /* @__PURE__ */ new Map(), ja = /[A-Z]/g, $a = /* @__PURE__ */ new Set(["table", "tbody", "thead", "tfoot", "tr"]), Ua = /* @__PURE__ */ new Set(["td", "th"]), Fi = "https://github.com/syntax-tree/hast-util-to-jsx-runtime";
function Wa(e, t) {
  if (!t || t.Fragment === void 0)
    throw new TypeError("Expected `Fragment` in options");
  const n = t.filePath || void 0;
  let r;
  if (t.development) {
    if (typeof t.jsxDEV != "function")
      throw new TypeError(
        "Expected `jsxDEV` in options when `development: true`"
      );
    r = eo(n, t.jsxDEV);
  } else {
    if (typeof t.jsx != "function")
      throw new TypeError("Expected `jsx` in production options");
    if (typeof t.jsxs != "function")
      throw new TypeError("Expected `jsxs` in production options");
    r = Ka(n, t.jsx, t.jsxs);
  }
  const i = {
    Fragment: t.Fragment,
    ancestors: [],
    components: t.components || {},
    create: r,
    elementAttributeNameCase: t.elementAttributeNameCase || "react",
    evaluater: t.createEvaluater ? t.createEvaluater() : void 0,
    filePath: n,
    ignoreInvalidStyle: t.ignoreInvalidStyle || !1,
    passKeys: t.passKeys !== !1,
    passNode: t.passNode || !1,
    schema: t.space === "svg" ? Vn : za,
    stylePropertyNameCase: t.stylePropertyNameCase || "dom",
    tableCellAlignToStyle: t.tableCellAlignToStyle !== !1
  }, a = zi(i, e, void 0);
  return a && typeof a != "string" ? a : i.create(
    e,
    i.Fragment,
    { children: a || void 0 },
    void 0
  );
}
function zi(e, t, n) {
  if (t.type === "element")
    return qa(e, t, n);
  if (t.type === "mdxFlowExpression" || t.type === "mdxTextExpression")
    return Ga(e, t);
  if (t.type === "mdxJsxFlowElement" || t.type === "mdxJsxTextElement")
    return Xa(e, t, n);
  if (t.type === "mdxjsEsm")
    return Ya(e, t);
  if (t.type === "root")
    return Qa(e, t, n);
  if (t.type === "text")
    return Ja(e, t);
}
function qa(e, t, n) {
  const r = e.schema;
  let i = r;
  t.tagName.toLowerCase() === "svg" && r.space === "html" && (i = Vn, e.schema = i), e.ancestors.push(t);
  const a = Pi(e, t.tagName, !1), l = to(e, t);
  let o = $n(e, t);
  return $a.has(t.tagName) && (o = o.filter(function(s) {
    return typeof s == "string" ? !va(s) : !0;
  })), Hi(e, l, a, t), jn(l, o), e.ancestors.pop(), e.schema = r, e.create(t, a, l, n);
}
function Ga(e, t) {
  if (t.data && t.data.estree && e.evaluater) {
    const r = t.data.estree.body[0];
    return r.type, /** @type {Child | undefined} */
    e.evaluater.evaluateExpression(r.expression);
  }
  At(e, t.position);
}
function Ya(e, t) {
  if (t.data && t.data.estree && e.evaluater)
    return (
      /** @type {Child | undefined} */
      e.evaluater.evaluateProgram(t.data.estree)
    );
  At(e, t.position);
}
function Xa(e, t, n) {
  const r = e.schema;
  let i = r;
  t.name === "svg" && r.space === "html" && (i = Vn, e.schema = i), e.ancestors.push(t);
  const a = t.name === null ? e.Fragment : Pi(e, t.name, !0), l = no(e, t), o = $n(e, t);
  return Hi(e, l, a, t), jn(l, o), e.ancestors.pop(), e.schema = r, e.create(t, a, l, n);
}
function Qa(e, t, n) {
  const r = {};
  return jn(r, $n(e, t)), e.create(t, e.Fragment, r, n);
}
function Ja(e, t) {
  return t.value;
}
function Hi(e, t, n, r) {
  typeof n != "string" && n !== e.Fragment && e.passNode && (t.node = r);
}
function jn(e, t) {
  if (t.length > 0) {
    const n = t.length > 1 ? t : t[0];
    n && (e.children = n);
  }
}
function Ka(e, t, n) {
  return r;
  function r(i, a, l, o) {
    const u = Array.isArray(l.children) ? n : t;
    return o ? u(a, l, o) : u(a, l);
  }
}
function eo(e, t) {
  return n;
  function n(r, i, a, l) {
    const o = Array.isArray(a.children), s = On(r);
    return t(
      i,
      a,
      l,
      o,
      {
        columnNumber: s ? s.column - 1 : void 0,
        fileName: e,
        lineNumber: s ? s.line : void 0
      },
      void 0
    );
  }
}
function to(e, t) {
  const n = {};
  let r, i;
  for (i in t.properties)
    if (i !== "children" && Bn.call(t.properties, i)) {
      const a = ro(e, i, t.properties[i]);
      if (a) {
        const [l, o] = a;
        e.tableCellAlignToStyle && l === "align" && typeof o == "string" && Ua.has(t.tagName) ? r = o : n[l] = o;
      }
    }
  if (r) {
    const a = (
      /** @type {Style} */
      n.style || (n.style = {})
    );
    a[e.stylePropertyNameCase === "css" ? "text-align" : "textAlign"] = r;
  }
  return n;
}
function no(e, t) {
  const n = {};
  for (const r of t.attributes)
    if (r.type === "mdxJsxExpressionAttribute")
      if (r.data && r.data.estree && e.evaluater) {
        const a = r.data.estree.body[0];
        a.type;
        const l = a.expression;
        l.type;
        const o = l.properties[0];
        o.type, Object.assign(
          n,
          e.evaluater.evaluateExpression(o.argument)
        );
      } else
        At(e, t.position);
    else {
      const i = r.name;
      let a;
      if (r.value && typeof r.value == "object")
        if (r.value.data && r.value.data.estree && e.evaluater) {
          const o = r.value.data.estree.body[0];
          o.type, a = e.evaluater.evaluateExpression(o.expression);
        } else
          At(e, t.position);
      else
        a = r.value === null ? !0 : r.value;
      n[i] = /** @type {Props[keyof Props]} */
      a;
    }
  return n;
}
function $n(e, t) {
  const n = [];
  let r = -1;
  const i = e.passKeys ? /* @__PURE__ */ new Map() : Ba;
  for (; ++r < t.children.length; ) {
    const a = t.children[r];
    let l;
    if (e.passKeys) {
      const s = a.type === "element" ? a.tagName : a.type === "mdxJsxFlowElement" || a.type === "mdxJsxTextElement" ? a.name : void 0;
      if (s) {
        const u = i.get(s) || 0;
        l = s + "-" + u, i.set(s, u + 1);
      }
    }
    const o = zi(e, a, l);
    o !== void 0 && n.push(o);
  }
  return n;
}
function ro(e, t, n) {
  const r = Ia(e.schema, t);
  if (!(n == null || typeof n == "number" && Number.isNaN(n))) {
    if (Array.isArray(n) && (n = r.commaSeparated ? xa(n) : Ha(n)), r.property === "style") {
      let i = typeof n == "object" ? n : io(e, String(n));
      return e.stylePropertyNameCase === "css" && (i = lo(i)), ["style", i];
    }
    return [
      e.elementAttributeNameCase === "react" && r.space ? Ma[r.property] || r.property : r.attribute,
      n
    ];
  }
}
function io(e, t) {
  try {
    return Va(t, { reactCompat: !0 });
  } catch (n) {
    if (e.ignoreInvalidStyle)
      return {};
    const r = (
      /** @type {Error} */
      n
    ), i = new ae("Cannot parse `style` attribute", {
      ancestors: e.ancestors,
      cause: r,
      ruleId: "style",
      source: "hast-util-to-jsx-runtime"
    });
    throw i.file = e.filePath || void 0, i.url = Fi + "#cannot-parse-style-attribute", i;
  }
}
function Pi(e, t, n) {
  let r;
  if (!n)
    r = { type: "Literal", value: t };
  else if (t.includes(".")) {
    const i = t.split(".");
    let a = -1, l;
    for (; ++a < i.length; ) {
      const o = yr(i[a]) ? { type: "Identifier", name: i[a] } : { type: "Literal", value: i[a] };
      l = l ? {
        type: "MemberExpression",
        object: l,
        property: o,
        computed: !!(a && o.type === "Literal"),
        optional: !1
      } : o;
    }
    r = l;
  } else
    r = yr(t) && !/^[a-z]/.test(t) ? { type: "Identifier", name: t } : { type: "Literal", value: t };
  if (r.type === "Literal") {
    const i = (
      /** @type {string | number} */
      r.value
    );
    return Bn.call(e.components, i) ? e.components[i] : i;
  }
  if (e.evaluater)
    return e.evaluater.evaluateExpression(r);
  At(e);
}
function At(e, t) {
  const n = new ae(
    "Cannot handle MDX estrees without `createEvaluater`",
    {
      ancestors: e.ancestors,
      place: t,
      ruleId: "mdx-estree",
      source: "hast-util-to-jsx-runtime"
    }
  );
  throw n.file = e.filePath || void 0, n.url = Fi + "#cannot-handle-mdx-estrees-without-createevaluater", n;
}
function lo(e) {
  const t = {};
  let n;
  for (n in e)
    Bn.call(e, n) && (t[ao(n)] = e[n]);
  return t;
}
function ao(e) {
  let t = e.replace(ja, oo);
  return t.slice(0, 3) === "ms-" && (t = "-" + t), t;
}
function oo(e) {
  return "-" + e.toLowerCase();
}
const tn = {
  action: ["form"],
  cite: ["blockquote", "del", "ins", "q"],
  data: ["object"],
  formAction: ["button", "input"],
  href: ["a", "area", "base", "link"],
  icon: ["menuitem"],
  itemId: null,
  manifest: ["html"],
  ping: ["a", "area"],
  poster: ["video"],
  src: [
    "audio",
    "embed",
    "iframe",
    "img",
    "input",
    "script",
    "source",
    "track",
    "video"
  ]
}, so = {};
function Un(e, t) {
  const n = so, r = typeof n.includeImageAlt == "boolean" ? n.includeImageAlt : !0, i = typeof n.includeHtml == "boolean" ? n.includeHtml : !0;
  return Zi(e, r, i);
}
function Zi(e, t, n) {
  if (uo(e)) {
    if ("value" in e)
      return e.type === "html" && !n ? "" : e.value;
    if (t && "alt" in e && e.alt)
      return e.alt;
    if ("children" in e)
      return Mr(e.children, t, n);
  }
  return Array.isArray(e) ? Mr(e, t, n) : "";
}
function Mr(e, t, n) {
  const r = [];
  let i = -1;
  for (; ++i < e.length; )
    r[i] = Zi(e[i], t, n);
  return r.join("");
}
function uo(e) {
  return !!(e && typeof e == "object");
}
const Lr = document.createElement("i");
function Wn(e) {
  const t = "&" + e + ";";
  Lr.innerHTML = t;
  const n = Lr.textContent;
  return n.charCodeAt(n.length - 1) === 59 && e !== "semi" || n === t ? !1 : n;
}
function ge(e, t, n, r) {
  const i = e.length;
  let a = 0, l;
  if (t < 0 ? t = -t > i ? 0 : i + t : t = t > i ? i : t, n = n > 0 ? n : 0, r.length < 1e4)
    l = Array.from(r), l.unshift(t, n), e.splice(...l);
  else
    for (n && e.splice(t, n); a < r.length; )
      l = r.slice(a, a + 1e4), l.unshift(t, 0), e.splice(...l), a += 1e4, t += 1e4;
}
function xe(e, t) {
  return e.length > 0 ? (ge(e, e.length, 0, t), e) : t;
}
const Nr = {}.hasOwnProperty;
function Di(e) {
  const t = {};
  let n = -1;
  for (; ++n < e.length; )
    co(t, e[n]);
  return t;
}
function co(e, t) {
  let n;
  for (n in t) {
    const i = (Nr.call(e, n) ? e[n] : void 0) || (e[n] = {}), a = t[n];
    let l;
    if (a)
      for (l in a) {
        Nr.call(i, l) || (i[l] = []);
        const o = a[l];
        fo(
          // @ts-expect-error Looks like a list.
          i[l],
          Array.isArray(o) ? o : o ? [o] : []
        );
      }
  }
}
function fo(e, t) {
  let n = -1;
  const r = [];
  for (; ++n < t.length; )
    (t[n].add === "after" ? e : r).push(t[n]);
  ge(e, 0, 0, r);
}
function Ri(e, t) {
  const n = Number.parseInt(e, t);
  return (
    // C0 except for HT, LF, FF, CR, space.
    n < 9 || n === 11 || n > 13 && n < 32 || // Control character (DEL) of C0, and C1 controls.
    n > 126 && n < 160 || // Lone high surrogates and low surrogates.
    n > 55295 && n < 57344 || // Noncharacters.
    n > 64975 && n < 65008 || /* eslint-disable no-bitwise */
    (n & 65535) === 65535 || (n & 65535) === 65534 || /* eslint-enable no-bitwise */
    // Out of range
    n > 1114111 ? "�" : String.fromCodePoint(n)
  );
}
function we(e) {
  return e.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
}
const ce = Ze(/[A-Za-z]/), le = Ze(/[\dA-Za-z]/), ho = Ze(/[#-'*+\--9=?A-Z^-~]/);
function _t(e) {
  return (
    // Special whitespace codes (which have negative values), C0 and Control
    // character DEL
    e !== null && (e < 32 || e === 127)
  );
}
const An = Ze(/\d/), po = Ze(/[\dA-Fa-f]/), mo = Ze(/[!-/:-@[-`{-~]/);
function P(e) {
  return e !== null && e < -2;
}
function X(e) {
  return e !== null && (e < 0 || e === 32);
}
function O(e) {
  return e === -2 || e === -1 || e === 32;
}
const Wt = Ze(new RegExp("\\p{P}|\\p{S}", "u")), $e = Ze(/\s/);
function Ze(e) {
  return t;
  function t(n) {
    return n !== null && n > -1 && e.test(String.fromCharCode(n));
  }
}
function lt(e) {
  const t = [];
  let n = -1, r = 0, i = 0;
  for (; ++n < e.length; ) {
    const a = e.charCodeAt(n);
    let l = "";
    if (a === 37 && le(e.charCodeAt(n + 1)) && le(e.charCodeAt(n + 2)))
      i = 2;
    else if (a < 128)
      /[!#$&-;=?-Z_a-z~]/.test(String.fromCharCode(a)) || (l = String.fromCharCode(a));
    else if (a > 55295 && a < 57344) {
      const o = e.charCodeAt(n + 1);
      a < 56320 && o > 56319 && o < 57344 ? (l = String.fromCharCode(a, o), i = 1) : l = "�";
    } else
      l = String.fromCharCode(a);
    l && (t.push(e.slice(r, n), encodeURIComponent(l)), r = n + i + 1, l = ""), i && (n += i, i = 0);
  }
  return t.join("") + e.slice(r);
}
function U(e, t, n, r) {
  const i = r ? r - 1 : Number.POSITIVE_INFINITY;
  let a = 0;
  return l;
  function l(s) {
    return O(s) ? (e.enter(n), o(s)) : t(s);
  }
  function o(s) {
    return O(s) && a++ < i ? (e.consume(s), o) : (e.exit(n), t(s));
  }
}
const go = {
  tokenize: yo
};
function yo(e) {
  const t = e.attempt(this.parser.constructs.contentInitial, r, i);
  let n;
  return t;
  function r(o) {
    if (o === null) {
      e.consume(o);
      return;
    }
    return e.enter("lineEnding"), e.consume(o), e.exit("lineEnding"), U(e, t, "linePrefix");
  }
  function i(o) {
    return e.enter("paragraph"), a(o);
  }
  function a(o) {
    const s = e.enter("chunkText", {
      contentType: "text",
      previous: n
    });
    return n && (n.next = s), n = s, l(o);
  }
  function l(o) {
    if (o === null) {
      e.exit("chunkText"), e.exit("paragraph"), e.consume(o);
      return;
    }
    return P(o) ? (e.consume(o), e.exit("chunkText"), a) : (e.consume(o), l);
  }
}
const xo = {
  tokenize: bo
}, Ir = {
  tokenize: ko
};
function bo(e) {
  const t = this, n = [];
  let r = 0, i, a, l;
  return o;
  function o(C) {
    if (r < n.length) {
      const H = n[r];
      return t.containerState = H[1], e.attempt(H[0].continuation, s, u)(C);
    }
    return u(C);
  }
  function s(C) {
    if (r++, t.containerState._closeFlow) {
      t.containerState._closeFlow = void 0, i && S();
      const H = t.events.length;
      let Z = H, v;
      for (; Z--; )
        if (t.events[Z][0] === "exit" && t.events[Z][1].type === "chunkFlow") {
          v = t.events[Z][1].end;
          break;
        }
      x(r);
      let V = H;
      for (; V < t.events.length; )
        t.events[V][1].end = {
          ...v
        }, V++;
      return ge(t.events, Z + 1, 0, t.events.slice(H)), t.events.length = V, u(C);
    }
    return o(C);
  }
  function u(C) {
    if (r === n.length) {
      if (!i)
        return p(C);
      if (i.currentConstruct && i.currentConstruct.concrete)
        return m(C);
      t.interrupt = !!(i.currentConstruct && !i._gfmTableDynamicInterruptHack);
    }
    return t.containerState = {}, e.check(Ir, f, c)(C);
  }
  function f(C) {
    return i && S(), x(r), p(C);
  }
  function c(C) {
    return t.parser.lazy[t.now().line] = r !== n.length, l = t.now().offset, m(C);
  }
  function p(C) {
    return t.containerState = {}, e.attempt(Ir, d, m)(C);
  }
  function d(C) {
    return r++, n.push([t.currentConstruct, t.containerState]), p(C);
  }
  function m(C) {
    if (C === null) {
      i && S(), x(0), e.consume(C);
      return;
    }
    return i = i || t.parser.flow(t.now()), e.enter("chunkFlow", {
      _tokenizer: i,
      contentType: "flow",
      previous: a
    }), w(C);
  }
  function w(C) {
    if (C === null) {
      k(e.exit("chunkFlow"), !0), x(0), e.consume(C);
      return;
    }
    return P(C) ? (e.consume(C), k(e.exit("chunkFlow")), r = 0, t.interrupt = void 0, o) : (e.consume(C), w);
  }
  function k(C, H) {
    const Z = t.sliceStream(C);
    if (H && Z.push(null), C.previous = a, a && (a.next = C), a = C, i.defineSkip(C.start), i.write(Z), t.parser.lazy[C.start.line]) {
      let v = i.events.length;
      for (; v--; )
        if (
          // The token starts before the line ending…
          i.events[v][1].start.offset < l && // …and either is not ended yet…
          (!i.events[v][1].end || // …or ends after it.
          i.events[v][1].end.offset > l)
        )
          return;
      const V = t.events.length;
      let $ = V, B, A;
      for (; $--; )
        if (t.events[$][0] === "exit" && t.events[$][1].type === "chunkFlow") {
          if (B) {
            A = t.events[$][1].end;
            break;
          }
          B = !0;
        }
      for (x(r), v = V; v < t.events.length; )
        t.events[v][1].end = {
          ...A
        }, v++;
      ge(t.events, $ + 1, 0, t.events.slice(V)), t.events.length = v;
    }
  }
  function x(C) {
    let H = n.length;
    for (; H-- > C; ) {
      const Z = n[H];
      t.containerState = Z[1], Z[0].exit.call(t, e);
    }
    n.length = C;
  }
  function S() {
    i.write([null]), a = void 0, i = void 0, t.containerState._closeFlow = void 0;
  }
}
function ko(e, t, n) {
  return U(e, e.attempt(this.parser.constructs.document, t, n), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
}
function rt(e) {
  if (e === null || X(e) || $e(e))
    return 1;
  if (Wt(e))
    return 2;
}
function qt(e, t, n) {
  const r = [];
  let i = -1;
  for (; ++i < e.length; ) {
    const a = e[i].resolveAll;
    a && !r.includes(a) && (t = a(t, n), r.push(a));
  }
  return t;
}
const vn = {
  name: "attention",
  resolveAll: wo,
  tokenize: Ao
};
function wo(e, t) {
  let n = -1, r, i, a, l, o, s, u, f;
  for (; ++n < e.length; )
    if (e[n][0] === "enter" && e[n][1].type === "attentionSequence" && e[n][1]._close) {
      for (r = n; r--; )
        if (e[r][0] === "exit" && e[r][1].type === "attentionSequence" && e[r][1]._open && // If the markers are the same:
        t.sliceSerialize(e[r][1]).charCodeAt(0) === t.sliceSerialize(e[n][1]).charCodeAt(0)) {
          if ((e[r][1]._close || e[n][1]._open) && (e[n][1].end.offset - e[n][1].start.offset) % 3 && !((e[r][1].end.offset - e[r][1].start.offset + e[n][1].end.offset - e[n][1].start.offset) % 3))
            continue;
          s = e[r][1].end.offset - e[r][1].start.offset > 1 && e[n][1].end.offset - e[n][1].start.offset > 1 ? 2 : 1;
          const c = {
            ...e[r][1].end
          }, p = {
            ...e[n][1].start
          };
          Tr(c, -s), Tr(p, s), l = {
            type: s > 1 ? "strongSequence" : "emphasisSequence",
            start: c,
            end: {
              ...e[r][1].end
            }
          }, o = {
            type: s > 1 ? "strongSequence" : "emphasisSequence",
            start: {
              ...e[n][1].start
            },
            end: p
          }, a = {
            type: s > 1 ? "strongText" : "emphasisText",
            start: {
              ...e[r][1].end
            },
            end: {
              ...e[n][1].start
            }
          }, i = {
            type: s > 1 ? "strong" : "emphasis",
            start: {
              ...l.start
            },
            end: {
              ...o.end
            }
          }, e[r][1].end = {
            ...l.start
          }, e[n][1].start = {
            ...o.end
          }, u = [], e[r][1].end.offset - e[r][1].start.offset && (u = xe(u, [["enter", e[r][1], t], ["exit", e[r][1], t]])), u = xe(u, [["enter", i, t], ["enter", l, t], ["exit", l, t], ["enter", a, t]]), u = xe(u, qt(t.parser.constructs.insideSpan.null, e.slice(r + 1, n), t)), u = xe(u, [["exit", a, t], ["enter", o, t], ["exit", o, t], ["exit", i, t]]), e[n][1].end.offset - e[n][1].start.offset ? (f = 2, u = xe(u, [["enter", e[n][1], t], ["exit", e[n][1], t]])) : f = 0, ge(e, r - 1, n - r + 3, u), n = r + u.length - f - 2;
          break;
        }
    }
  for (n = -1; ++n < e.length; )
    e[n][1].type === "attentionSequence" && (e[n][1].type = "data");
  return e;
}
function Ao(e, t) {
  const n = this.parser.constructs.attentionMarkers.null, r = this.previous, i = rt(r);
  let a;
  return l;
  function l(s) {
    return a = s, e.enter("attentionSequence"), o(s);
  }
  function o(s) {
    if (s === a)
      return e.consume(s), o;
    const u = e.exit("attentionSequence"), f = rt(s), c = !f || f === 2 && i || n.includes(s), p = !i || i === 2 && f || n.includes(r);
    return u._open = !!(a === 42 ? c : c && (i || !p)), u._close = !!(a === 42 ? p : p && (f || !c)), t(s);
  }
}
function Tr(e, t) {
  e.column += t, e.offset += t, e._bufferIndex += t;
}
const vo = {
  name: "autolink",
  tokenize: Eo
};
function Eo(e, t, n) {
  let r = 0;
  return i;
  function i(d) {
    return e.enter("autolink"), e.enter("autolinkMarker"), e.consume(d), e.exit("autolinkMarker"), e.enter("autolinkProtocol"), a;
  }
  function a(d) {
    return ce(d) ? (e.consume(d), l) : d === 64 ? n(d) : u(d);
  }
  function l(d) {
    return d === 43 || d === 45 || d === 46 || le(d) ? (r = 1, o(d)) : u(d);
  }
  function o(d) {
    return d === 58 ? (e.consume(d), r = 0, s) : (d === 43 || d === 45 || d === 46 || le(d)) && r++ < 32 ? (e.consume(d), o) : (r = 0, u(d));
  }
  function s(d) {
    return d === 62 ? (e.exit("autolinkProtocol"), e.enter("autolinkMarker"), e.consume(d), e.exit("autolinkMarker"), e.exit("autolink"), t) : d === null || d === 32 || d === 60 || _t(d) ? n(d) : (e.consume(d), s);
  }
  function u(d) {
    return d === 64 ? (e.consume(d), f) : ho(d) ? (e.consume(d), u) : n(d);
  }
  function f(d) {
    return le(d) ? c(d) : n(d);
  }
  function c(d) {
    return d === 46 ? (e.consume(d), r = 0, f) : d === 62 ? (e.exit("autolinkProtocol").type = "autolinkEmail", e.enter("autolinkMarker"), e.consume(d), e.exit("autolinkMarker"), e.exit("autolink"), t) : p(d);
  }
  function p(d) {
    if ((d === 45 || le(d)) && r++ < 63) {
      const m = d === 45 ? p : c;
      return e.consume(d), m;
    }
    return n(d);
  }
}
const Mt = {
  partial: !0,
  tokenize: Co
};
function Co(e, t, n) {
  return r;
  function r(a) {
    return O(a) ? U(e, i, "linePrefix")(a) : i(a);
  }
  function i(a) {
    return a === null || P(a) ? t(a) : n(a);
  }
}
const _i = {
  continuation: {
    tokenize: Mo
  },
  exit: Lo,
  name: "blockQuote",
  tokenize: So
};
function So(e, t, n) {
  const r = this;
  return i;
  function i(l) {
    if (l === 62) {
      const o = r.containerState;
      return o.open || (e.enter("blockQuote", {
        _container: !0
      }), o.open = !0), e.enter("blockQuotePrefix"), e.enter("blockQuoteMarker"), e.consume(l), e.exit("blockQuoteMarker"), a;
    }
    return n(l);
  }
  function a(l) {
    return O(l) ? (e.enter("blockQuotePrefixWhitespace"), e.consume(l), e.exit("blockQuotePrefixWhitespace"), e.exit("blockQuotePrefix"), t) : (e.exit("blockQuotePrefix"), t(l));
  }
}
function Mo(e, t, n) {
  const r = this;
  return i;
  function i(l) {
    return O(l) ? U(e, a, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(l) : a(l);
  }
  function a(l) {
    return e.attempt(_i, t, n)(l);
  }
}
function Lo(e) {
  e.exit("blockQuote");
}
const Vi = {
  name: "characterEscape",
  tokenize: No
};
function No(e, t, n) {
  return r;
  function r(a) {
    return e.enter("characterEscape"), e.enter("escapeMarker"), e.consume(a), e.exit("escapeMarker"), i;
  }
  function i(a) {
    return mo(a) ? (e.enter("characterEscapeValue"), e.consume(a), e.exit("characterEscapeValue"), e.exit("characterEscape"), t) : n(a);
  }
}
const Oi = {
  name: "characterReference",
  tokenize: Io
};
function Io(e, t, n) {
  const r = this;
  let i = 0, a, l;
  return o;
  function o(c) {
    return e.enter("characterReference"), e.enter("characterReferenceMarker"), e.consume(c), e.exit("characterReferenceMarker"), s;
  }
  function s(c) {
    return c === 35 ? (e.enter("characterReferenceMarkerNumeric"), e.consume(c), e.exit("characterReferenceMarkerNumeric"), u) : (e.enter("characterReferenceValue"), a = 31, l = le, f(c));
  }
  function u(c) {
    return c === 88 || c === 120 ? (e.enter("characterReferenceMarkerHexadecimal"), e.consume(c), e.exit("characterReferenceMarkerHexadecimal"), e.enter("characterReferenceValue"), a = 6, l = po, f) : (e.enter("characterReferenceValue"), a = 7, l = An, f(c));
  }
  function f(c) {
    if (c === 59 && i) {
      const p = e.exit("characterReferenceValue");
      return l === le && !Wn(r.sliceSerialize(p)) ? n(c) : (e.enter("characterReferenceMarker"), e.consume(c), e.exit("characterReferenceMarker"), e.exit("characterReference"), t);
    }
    return l(c) && i++ < a ? (e.consume(c), f) : n(c);
  }
}
const Fr = {
  partial: !0,
  tokenize: Fo
}, zr = {
  concrete: !0,
  name: "codeFenced",
  tokenize: To
};
function To(e, t, n) {
  const r = this, i = {
    partial: !0,
    tokenize: Z
  };
  let a = 0, l = 0, o;
  return s;
  function s(v) {
    return u(v);
  }
  function u(v) {
    const V = r.events[r.events.length - 1];
    return a = V && V[1].type === "linePrefix" ? V[2].sliceSerialize(V[1], !0).length : 0, o = v, e.enter("codeFenced"), e.enter("codeFencedFence"), e.enter("codeFencedFenceSequence"), f(v);
  }
  function f(v) {
    return v === o ? (l++, e.consume(v), f) : l < 3 ? n(v) : (e.exit("codeFencedFenceSequence"), O(v) ? U(e, c, "whitespace")(v) : c(v));
  }
  function c(v) {
    return v === null || P(v) ? (e.exit("codeFencedFence"), r.interrupt ? t(v) : e.check(Fr, w, H)(v)) : (e.enter("codeFencedFenceInfo"), e.enter("chunkString", {
      contentType: "string"
    }), p(v));
  }
  function p(v) {
    return v === null || P(v) ? (e.exit("chunkString"), e.exit("codeFencedFenceInfo"), c(v)) : O(v) ? (e.exit("chunkString"), e.exit("codeFencedFenceInfo"), U(e, d, "whitespace")(v)) : v === 96 && v === o ? n(v) : (e.consume(v), p);
  }
  function d(v) {
    return v === null || P(v) ? c(v) : (e.enter("codeFencedFenceMeta"), e.enter("chunkString", {
      contentType: "string"
    }), m(v));
  }
  function m(v) {
    return v === null || P(v) ? (e.exit("chunkString"), e.exit("codeFencedFenceMeta"), c(v)) : v === 96 && v === o ? n(v) : (e.consume(v), m);
  }
  function w(v) {
    return e.attempt(i, H, k)(v);
  }
  function k(v) {
    return e.enter("lineEnding"), e.consume(v), e.exit("lineEnding"), x;
  }
  function x(v) {
    return a > 0 && O(v) ? U(e, S, "linePrefix", a + 1)(v) : S(v);
  }
  function S(v) {
    return v === null || P(v) ? e.check(Fr, w, H)(v) : (e.enter("codeFlowValue"), C(v));
  }
  function C(v) {
    return v === null || P(v) ? (e.exit("codeFlowValue"), S(v)) : (e.consume(v), C);
  }
  function H(v) {
    return e.exit("codeFenced"), t(v);
  }
  function Z(v, V, $) {
    let B = 0;
    return A;
    function A(T) {
      return v.enter("lineEnding"), v.consume(T), v.exit("lineEnding"), F;
    }
    function F(T) {
      return v.enter("codeFencedFence"), O(T) ? U(v, L, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(T) : L(T);
    }
    function L(T) {
      return T === o ? (v.enter("codeFencedFenceSequence"), q(T)) : $(T);
    }
    function q(T) {
      return T === o ? (B++, v.consume(T), q) : B >= l ? (v.exit("codeFencedFenceSequence"), O(T) ? U(v, z, "whitespace")(T) : z(T)) : $(T);
    }
    function z(T) {
      return T === null || P(T) ? (v.exit("codeFencedFence"), V(T)) : $(T);
    }
  }
}
function Fo(e, t, n) {
  const r = this;
  return i;
  function i(l) {
    return l === null ? n(l) : (e.enter("lineEnding"), e.consume(l), e.exit("lineEnding"), a);
  }
  function a(l) {
    return r.parser.lazy[r.now().line] ? n(l) : t(l);
  }
}
const nn = {
  name: "codeIndented",
  tokenize: Ho
}, zo = {
  partial: !0,
  tokenize: Po
};
function Ho(e, t, n) {
  const r = this;
  return i;
  function i(u) {
    return e.enter("codeIndented"), U(e, a, "linePrefix", 5)(u);
  }
  function a(u) {
    const f = r.events[r.events.length - 1];
    return f && f[1].type === "linePrefix" && f[2].sliceSerialize(f[1], !0).length >= 4 ? l(u) : n(u);
  }
  function l(u) {
    return u === null ? s(u) : P(u) ? e.attempt(zo, l, s)(u) : (e.enter("codeFlowValue"), o(u));
  }
  function o(u) {
    return u === null || P(u) ? (e.exit("codeFlowValue"), l(u)) : (e.consume(u), o);
  }
  function s(u) {
    return e.exit("codeIndented"), t(u);
  }
}
function Po(e, t, n) {
  const r = this;
  return i;
  function i(l) {
    return r.parser.lazy[r.now().line] ? n(l) : P(l) ? (e.enter("lineEnding"), e.consume(l), e.exit("lineEnding"), i) : U(e, a, "linePrefix", 5)(l);
  }
  function a(l) {
    const o = r.events[r.events.length - 1];
    return o && o[1].type === "linePrefix" && o[2].sliceSerialize(o[1], !0).length >= 4 ? t(l) : P(l) ? i(l) : n(l);
  }
}
const Zo = {
  name: "codeText",
  previous: Ro,
  resolve: Do,
  tokenize: _o
};
function Do(e) {
  let t = e.length - 4, n = 3, r, i;
  if ((e[n][1].type === "lineEnding" || e[n][1].type === "space") && (e[t][1].type === "lineEnding" || e[t][1].type === "space")) {
    for (r = n; ++r < t; )
      if (e[r][1].type === "codeTextData") {
        e[n][1].type = "codeTextPadding", e[t][1].type = "codeTextPadding", n += 2, t -= 2;
        break;
      }
  }
  for (r = n - 1, t++; ++r <= t; )
    i === void 0 ? r !== t && e[r][1].type !== "lineEnding" && (i = r) : (r === t || e[r][1].type === "lineEnding") && (e[i][1].type = "codeTextData", r !== i + 2 && (e[i][1].end = e[r - 1][1].end, e.splice(i + 2, r - i - 2), t -= r - i - 2, r = i + 2), i = void 0);
  return e;
}
function Ro(e) {
  return e !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
}
function _o(e, t, n) {
  let r = 0, i, a;
  return l;
  function l(c) {
    return e.enter("codeText"), e.enter("codeTextSequence"), o(c);
  }
  function o(c) {
    return c === 96 ? (e.consume(c), r++, o) : (e.exit("codeTextSequence"), s(c));
  }
  function s(c) {
    return c === null ? n(c) : c === 32 ? (e.enter("space"), e.consume(c), e.exit("space"), s) : c === 96 ? (a = e.enter("codeTextSequence"), i = 0, f(c)) : P(c) ? (e.enter("lineEnding"), e.consume(c), e.exit("lineEnding"), s) : (e.enter("codeTextData"), u(c));
  }
  function u(c) {
    return c === null || c === 32 || c === 96 || P(c) ? (e.exit("codeTextData"), s(c)) : (e.consume(c), u);
  }
  function f(c) {
    return c === 96 ? (e.consume(c), i++, f) : i === r ? (e.exit("codeTextSequence"), e.exit("codeText"), t(c)) : (a.type = "codeTextData", u(c));
  }
}
class Vo {
  /**
   * @param {ReadonlyArray<T> | null | undefined} [initial]
   *   Initial items (optional).
   * @returns
   *   Splice buffer.
   */
  constructor(t) {
    this.left = t ? [...t] : [], this.right = [];
  }
  /**
   * Array access;
   * does not move the cursor.
   *
   * @param {number} index
   *   Index.
   * @return {T}
   *   Item.
   */
  get(t) {
    if (t < 0 || t >= this.left.length + this.right.length)
      throw new RangeError("Cannot access index `" + t + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
    return t < this.left.length ? this.left[t] : this.right[this.right.length - t + this.left.length - 1];
  }
  /**
   * The length of the splice buffer, one greater than the largest index in the
   * array.
   */
  get length() {
    return this.left.length + this.right.length;
  }
  /**
   * Remove and return `list[0]`;
   * moves the cursor to `0`.
   *
   * @returns {T | undefined}
   *   Item, optional.
   */
  shift() {
    return this.setCursor(0), this.right.pop();
  }
  /**
   * Slice the buffer to get an array;
   * does not move the cursor.
   *
   * @param {number} start
   *   Start.
   * @param {number | null | undefined} [end]
   *   End (optional).
   * @returns {Array<T>}
   *   Array of items.
   */
  slice(t, n) {
    const r = n ?? Number.POSITIVE_INFINITY;
    return r < this.left.length ? this.left.slice(t, r) : t > this.left.length ? this.right.slice(this.right.length - r + this.left.length, this.right.length - t + this.left.length).reverse() : this.left.slice(t).concat(this.right.slice(this.right.length - r + this.left.length).reverse());
  }
  /**
   * Mimics the behavior of Array.prototype.splice() except for the change of
   * interface necessary to avoid segfaults when patching in very large arrays.
   *
   * This operation moves cursor is moved to `start` and results in the cursor
   * placed after any inserted items.
   *
   * @param {number} start
   *   Start;
   *   zero-based index at which to start changing the array;
   *   negative numbers count backwards from the end of the array and values
   *   that are out-of bounds are clamped to the appropriate end of the array.
   * @param {number | null | undefined} [deleteCount=0]
   *   Delete count (default: `0`);
   *   maximum number of elements to delete, starting from start.
   * @param {Array<T> | null | undefined} [items=[]]
   *   Items to include in place of the deleted items (default: `[]`).
   * @return {Array<T>}
   *   Any removed items.
   */
  splice(t, n, r) {
    const i = n || 0;
    this.setCursor(Math.trunc(t));
    const a = this.right.splice(this.right.length - i, Number.POSITIVE_INFINITY);
    return r && ht(this.left, r), a.reverse();
  }
  /**
   * Remove and return the highest-numbered item in the array, so
   * `list[list.length - 1]`;
   * Moves the cursor to `length`.
   *
   * @returns {T | undefined}
   *   Item, optional.
   */
  pop() {
    return this.setCursor(Number.POSITIVE_INFINITY), this.left.pop();
  }
  /**
   * Inserts a single item to the high-numbered side of the array;
   * moves the cursor to `length`.
   *
   * @param {T} item
   *   Item.
   * @returns {undefined}
   *   Nothing.
   */
  push(t) {
    this.setCursor(Number.POSITIVE_INFINITY), this.left.push(t);
  }
  /**
   * Inserts many items to the high-numbered side of the array.
   * Moves the cursor to `length`.
   *
   * @param {Array<T>} items
   *   Items.
   * @returns {undefined}
   *   Nothing.
   */
  pushMany(t) {
    this.setCursor(Number.POSITIVE_INFINITY), ht(this.left, t);
  }
  /**
   * Inserts a single item to the low-numbered side of the array;
   * Moves the cursor to `0`.
   *
   * @param {T} item
   *   Item.
   * @returns {undefined}
   *   Nothing.
   */
  unshift(t) {
    this.setCursor(0), this.right.push(t);
  }
  /**
   * Inserts many items to the low-numbered side of the array;
   * moves the cursor to `0`.
   *
   * @param {Array<T>} items
   *   Items.
   * @returns {undefined}
   *   Nothing.
   */
  unshiftMany(t) {
    this.setCursor(0), ht(this.right, t.reverse());
  }
  /**
   * Move the cursor to a specific position in the array. Requires
   * time proportional to the distance moved.
   *
   * If `n < 0`, the cursor will end up at the beginning.
   * If `n > length`, the cursor will end up at the end.
   *
   * @param {number} n
   *   Position.
   * @return {undefined}
   *   Nothing.
   */
  setCursor(t) {
    if (!(t === this.left.length || t > this.left.length && this.right.length === 0 || t < 0 && this.left.length === 0))
      if (t < this.left.length) {
        const n = this.left.splice(t, Number.POSITIVE_INFINITY);
        ht(this.right, n.reverse());
      } else {
        const n = this.right.splice(this.left.length + this.right.length - t, Number.POSITIVE_INFINITY);
        ht(this.left, n.reverse());
      }
  }
}
function ht(e, t) {
  let n = 0;
  if (t.length < 1e4)
    e.push(...t);
  else
    for (; n < t.length; )
      e.push(...t.slice(n, n + 1e4)), n += 1e4;
}
function Bi(e) {
  const t = {};
  let n = -1, r, i, a, l, o, s, u;
  const f = new Vo(e);
  for (; ++n < f.length; ) {
    for (; n in t; )
      n = t[n];
    if (r = f.get(n), n && r[1].type === "chunkFlow" && f.get(n - 1)[1].type === "listItemPrefix" && (s = r[1]._tokenizer.events, a = 0, a < s.length && s[a][1].type === "lineEndingBlank" && (a += 2), a < s.length && s[a][1].type === "content"))
      for (; ++a < s.length && s[a][1].type !== "content"; )
        s[a][1].type === "chunkText" && (s[a][1]._isInFirstContentOfListItem = !0, a++);
    if (r[0] === "enter")
      r[1].contentType && (Object.assign(t, Oo(f, n)), n = t[n], u = !0);
    else if (r[1]._container) {
      for (a = n, i = void 0; a--; )
        if (l = f.get(a), l[1].type === "lineEnding" || l[1].type === "lineEndingBlank")
          l[0] === "enter" && (i && (f.get(i)[1].type = "lineEndingBlank"), l[1].type = "lineEnding", i = a);
        else if (!(l[1].type === "linePrefix" || l[1].type === "listItemIndent")) break;
      i && (r[1].end = {
        ...f.get(i)[1].start
      }, o = f.slice(i, n), o.unshift(r), f.splice(i, n - i + 1, o));
    }
  }
  return ge(e, 0, Number.POSITIVE_INFINITY, f.slice(0)), !u;
}
function Oo(e, t) {
  const n = e.get(t)[1], r = e.get(t)[2];
  let i = t - 1;
  const a = [];
  let l = n._tokenizer;
  l || (l = r.parser[n.contentType](n.start), n._contentTypeTextTrailing && (l._contentTypeTextTrailing = !0));
  const o = l.events, s = [], u = {};
  let f, c, p = -1, d = n, m = 0, w = 0;
  const k = [w];
  for (; d; ) {
    for (; e.get(++i)[1] !== d; )
      ;
    a.push(i), d._tokenizer || (f = r.sliceStream(d), d.next || f.push(null), c && l.defineSkip(d.start), d._isInFirstContentOfListItem && (l._gfmTasklistFirstContentOfListItem = !0), l.write(f), d._isInFirstContentOfListItem && (l._gfmTasklistFirstContentOfListItem = void 0)), c = d, d = d.next;
  }
  for (d = n; ++p < o.length; )
    // Find a void token that includes a break.
    o[p][0] === "exit" && o[p - 1][0] === "enter" && o[p][1].type === o[p - 1][1].type && o[p][1].start.line !== o[p][1].end.line && (w = p + 1, k.push(w), d._tokenizer = void 0, d.previous = void 0, d = d.next);
  for (l.events = [], d ? (d._tokenizer = void 0, d.previous = void 0) : k.pop(), p = k.length; p--; ) {
    const x = o.slice(k[p], k[p + 1]), S = a.pop();
    s.push([S, S + x.length - 1]), e.splice(S, 2, x);
  }
  for (s.reverse(), p = -1; ++p < s.length; )
    u[m + s[p][0]] = m + s[p][1], m += s[p][1] - s[p][0] - 1;
  return u;
}
const Bo = {
  resolve: $o,
  tokenize: Uo
}, jo = {
  partial: !0,
  tokenize: Wo
};
function $o(e) {
  return Bi(e), e;
}
function Uo(e, t) {
  let n;
  return r;
  function r(o) {
    return e.enter("content"), n = e.enter("chunkContent", {
      contentType: "content"
    }), i(o);
  }
  function i(o) {
    return o === null ? a(o) : P(o) ? e.check(jo, l, a)(o) : (e.consume(o), i);
  }
  function a(o) {
    return e.exit("chunkContent"), e.exit("content"), t(o);
  }
  function l(o) {
    return e.consume(o), e.exit("chunkContent"), n.next = e.enter("chunkContent", {
      contentType: "content",
      previous: n
    }), n = n.next, i;
  }
}
function Wo(e, t, n) {
  const r = this;
  return i;
  function i(l) {
    return e.exit("chunkContent"), e.enter("lineEnding"), e.consume(l), e.exit("lineEnding"), U(e, a, "linePrefix");
  }
  function a(l) {
    if (l === null || P(l))
      return n(l);
    const o = r.events[r.events.length - 1];
    return !r.parser.constructs.disable.null.includes("codeIndented") && o && o[1].type === "linePrefix" && o[2].sliceSerialize(o[1], !0).length >= 4 ? t(l) : e.interrupt(r.parser.constructs.flow, n, t)(l);
  }
}
function ji(e, t, n, r, i, a, l, o, s) {
  const u = s || Number.POSITIVE_INFINITY;
  let f = 0;
  return c;
  function c(x) {
    return x === 60 ? (e.enter(r), e.enter(i), e.enter(a), e.consume(x), e.exit(a), p) : x === null || x === 32 || x === 41 || _t(x) ? n(x) : (e.enter(r), e.enter(l), e.enter(o), e.enter("chunkString", {
      contentType: "string"
    }), w(x));
  }
  function p(x) {
    return x === 62 ? (e.enter(a), e.consume(x), e.exit(a), e.exit(i), e.exit(r), t) : (e.enter(o), e.enter("chunkString", {
      contentType: "string"
    }), d(x));
  }
  function d(x) {
    return x === 62 ? (e.exit("chunkString"), e.exit(o), p(x)) : x === null || x === 60 || P(x) ? n(x) : (e.consume(x), x === 92 ? m : d);
  }
  function m(x) {
    return x === 60 || x === 62 || x === 92 ? (e.consume(x), d) : d(x);
  }
  function w(x) {
    return !f && (x === null || x === 41 || X(x)) ? (e.exit("chunkString"), e.exit(o), e.exit(l), e.exit(r), t(x)) : f < u && x === 40 ? (e.consume(x), f++, w) : x === 41 ? (e.consume(x), f--, w) : x === null || x === 32 || x === 40 || _t(x) ? n(x) : (e.consume(x), x === 92 ? k : w);
  }
  function k(x) {
    return x === 40 || x === 41 || x === 92 ? (e.consume(x), w) : w(x);
  }
}
function $i(e, t, n, r, i, a) {
  const l = this;
  let o = 0, s;
  return u;
  function u(d) {
    return e.enter(r), e.enter(i), e.consume(d), e.exit(i), e.enter(a), f;
  }
  function f(d) {
    return o > 999 || d === null || d === 91 || d === 93 && !s || // To do: remove in the future once we’ve switched from
    // `micromark-extension-footnote` to `micromark-extension-gfm-footnote`,
    // which doesn’t need this.
    // Hidden footnotes hook.
    /* c8 ignore next 3 */
    d === 94 && !o && "_hiddenFootnoteSupport" in l.parser.constructs ? n(d) : d === 93 ? (e.exit(a), e.enter(i), e.consume(d), e.exit(i), e.exit(r), t) : P(d) ? (e.enter("lineEnding"), e.consume(d), e.exit("lineEnding"), f) : (e.enter("chunkString", {
      contentType: "string"
    }), c(d));
  }
  function c(d) {
    return d === null || d === 91 || d === 93 || P(d) || o++ > 999 ? (e.exit("chunkString"), f(d)) : (e.consume(d), s || (s = !O(d)), d === 92 ? p : c);
  }
  function p(d) {
    return d === 91 || d === 92 || d === 93 ? (e.consume(d), o++, c) : c(d);
  }
}
function Ui(e, t, n, r, i, a) {
  let l;
  return o;
  function o(p) {
    return p === 34 || p === 39 || p === 40 ? (e.enter(r), e.enter(i), e.consume(p), e.exit(i), l = p === 40 ? 41 : p, s) : n(p);
  }
  function s(p) {
    return p === l ? (e.enter(i), e.consume(p), e.exit(i), e.exit(r), t) : (e.enter(a), u(p));
  }
  function u(p) {
    return p === l ? (e.exit(a), s(l)) : p === null ? n(p) : P(p) ? (e.enter("lineEnding"), e.consume(p), e.exit("lineEnding"), U(e, u, "linePrefix")) : (e.enter("chunkString", {
      contentType: "string"
    }), f(p));
  }
  function f(p) {
    return p === l || p === null || P(p) ? (e.exit("chunkString"), u(p)) : (e.consume(p), p === 92 ? c : f);
  }
  function c(p) {
    return p === l || p === 92 ? (e.consume(p), f) : f(p);
  }
}
function bt(e, t) {
  let n;
  return r;
  function r(i) {
    return P(i) ? (e.enter("lineEnding"), e.consume(i), e.exit("lineEnding"), n = !0, r) : O(i) ? U(e, r, n ? "linePrefix" : "lineSuffix")(i) : t(i);
  }
}
const qo = {
  name: "definition",
  tokenize: Yo
}, Go = {
  partial: !0,
  tokenize: Xo
};
function Yo(e, t, n) {
  const r = this;
  let i;
  return a;
  function a(d) {
    return e.enter("definition"), l(d);
  }
  function l(d) {
    return $i.call(
      r,
      e,
      o,
      // Note: we don’t need to reset the way `markdown-rs` does.
      n,
      "definitionLabel",
      "definitionLabelMarker",
      "definitionLabelString"
    )(d);
  }
  function o(d) {
    return i = we(r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1)), d === 58 ? (e.enter("definitionMarker"), e.consume(d), e.exit("definitionMarker"), s) : n(d);
  }
  function s(d) {
    return X(d) ? bt(e, u)(d) : u(d);
  }
  function u(d) {
    return ji(
      e,
      f,
      // Note: we don’t need to reset the way `markdown-rs` does.
      n,
      "definitionDestination",
      "definitionDestinationLiteral",
      "definitionDestinationLiteralMarker",
      "definitionDestinationRaw",
      "definitionDestinationString"
    )(d);
  }
  function f(d) {
    return e.attempt(Go, c, c)(d);
  }
  function c(d) {
    return O(d) ? U(e, p, "whitespace")(d) : p(d);
  }
  function p(d) {
    return d === null || P(d) ? (e.exit("definition"), r.parser.defined.push(i), t(d)) : n(d);
  }
}
function Xo(e, t, n) {
  return r;
  function r(o) {
    return X(o) ? bt(e, i)(o) : n(o);
  }
  function i(o) {
    return Ui(e, a, n, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(o);
  }
  function a(o) {
    return O(o) ? U(e, l, "whitespace")(o) : l(o);
  }
  function l(o) {
    return o === null || P(o) ? t(o) : n(o);
  }
}
const Qo = {
  name: "hardBreakEscape",
  tokenize: Jo
};
function Jo(e, t, n) {
  return r;
  function r(a) {
    return e.enter("hardBreakEscape"), e.consume(a), i;
  }
  function i(a) {
    return P(a) ? (e.exit("hardBreakEscape"), t(a)) : n(a);
  }
}
const Ko = {
  name: "headingAtx",
  resolve: es,
  tokenize: ts
};
function es(e, t) {
  let n = e.length - 2, r = 3, i, a;
  return e[r][1].type === "whitespace" && (r += 2), n - 2 > r && e[n][1].type === "whitespace" && (n -= 2), e[n][1].type === "atxHeadingSequence" && (r === n - 1 || n - 4 > r && e[n - 2][1].type === "whitespace") && (n -= r + 1 === n ? 2 : 4), n > r && (i = {
    type: "atxHeadingText",
    start: e[r][1].start,
    end: e[n][1].end
  }, a = {
    type: "chunkText",
    start: e[r][1].start,
    end: e[n][1].end,
    contentType: "text"
  }, ge(e, r, n - r + 1, [["enter", i, t], ["enter", a, t], ["exit", a, t], ["exit", i, t]])), e;
}
function ts(e, t, n) {
  let r = 0;
  return i;
  function i(f) {
    return e.enter("atxHeading"), a(f);
  }
  function a(f) {
    return e.enter("atxHeadingSequence"), l(f);
  }
  function l(f) {
    return f === 35 && r++ < 6 ? (e.consume(f), l) : f === null || X(f) ? (e.exit("atxHeadingSequence"), o(f)) : n(f);
  }
  function o(f) {
    return f === 35 ? (e.enter("atxHeadingSequence"), s(f)) : f === null || P(f) ? (e.exit("atxHeading"), t(f)) : O(f) ? U(e, o, "whitespace")(f) : (e.enter("atxHeadingText"), u(f));
  }
  function s(f) {
    return f === 35 ? (e.consume(f), s) : (e.exit("atxHeadingSequence"), o(f));
  }
  function u(f) {
    return f === null || f === 35 || X(f) ? (e.exit("atxHeadingText"), o(f)) : (e.consume(f), u);
  }
}
const ns = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul"
], Hr = ["pre", "script", "style", "textarea"], rs = {
  concrete: !0,
  name: "htmlFlow",
  resolveTo: as,
  tokenize: os
}, is = {
  partial: !0,
  tokenize: us
}, ls = {
  partial: !0,
  tokenize: ss
};
function as(e) {
  let t = e.length;
  for (; t-- && !(e[t][0] === "enter" && e[t][1].type === "htmlFlow"); )
    ;
  return t > 1 && e[t - 2][1].type === "linePrefix" && (e[t][1].start = e[t - 2][1].start, e[t + 1][1].start = e[t - 2][1].start, e.splice(t - 2, 2)), e;
}
function os(e, t, n) {
  const r = this;
  let i, a, l, o, s;
  return u;
  function u(y) {
    return f(y);
  }
  function f(y) {
    return e.enter("htmlFlow"), e.enter("htmlFlowData"), e.consume(y), c;
  }
  function c(y) {
    return y === 33 ? (e.consume(y), p) : y === 47 ? (e.consume(y), a = !0, w) : y === 63 ? (e.consume(y), i = 3, r.interrupt ? t : g) : ce(y) ? (e.consume(y), l = String.fromCharCode(y), k) : n(y);
  }
  function p(y) {
    return y === 45 ? (e.consume(y), i = 2, d) : y === 91 ? (e.consume(y), i = 5, o = 0, m) : ce(y) ? (e.consume(y), i = 4, r.interrupt ? t : g) : n(y);
  }
  function d(y) {
    return y === 45 ? (e.consume(y), r.interrupt ? t : g) : n(y);
  }
  function m(y) {
    const be = "CDATA[";
    return y === be.charCodeAt(o++) ? (e.consume(y), o === be.length ? r.interrupt ? t : L : m) : n(y);
  }
  function w(y) {
    return ce(y) ? (e.consume(y), l = String.fromCharCode(y), k) : n(y);
  }
  function k(y) {
    if (y === null || y === 47 || y === 62 || X(y)) {
      const be = y === 47, De = l.toLowerCase();
      return !be && !a && Hr.includes(De) ? (i = 1, r.interrupt ? t(y) : L(y)) : ns.includes(l.toLowerCase()) ? (i = 6, be ? (e.consume(y), x) : r.interrupt ? t(y) : L(y)) : (i = 7, r.interrupt && !r.parser.lazy[r.now().line] ? n(y) : a ? S(y) : C(y));
    }
    return y === 45 || le(y) ? (e.consume(y), l += String.fromCharCode(y), k) : n(y);
  }
  function x(y) {
    return y === 62 ? (e.consume(y), r.interrupt ? t : L) : n(y);
  }
  function S(y) {
    return O(y) ? (e.consume(y), S) : A(y);
  }
  function C(y) {
    return y === 47 ? (e.consume(y), A) : y === 58 || y === 95 || ce(y) ? (e.consume(y), H) : O(y) ? (e.consume(y), C) : A(y);
  }
  function H(y) {
    return y === 45 || y === 46 || y === 58 || y === 95 || le(y) ? (e.consume(y), H) : Z(y);
  }
  function Z(y) {
    return y === 61 ? (e.consume(y), v) : O(y) ? (e.consume(y), Z) : C(y);
  }
  function v(y) {
    return y === null || y === 60 || y === 61 || y === 62 || y === 96 ? n(y) : y === 34 || y === 39 ? (e.consume(y), s = y, V) : O(y) ? (e.consume(y), v) : $(y);
  }
  function V(y) {
    return y === s ? (e.consume(y), s = null, B) : y === null || P(y) ? n(y) : (e.consume(y), V);
  }
  function $(y) {
    return y === null || y === 34 || y === 39 || y === 47 || y === 60 || y === 61 || y === 62 || y === 96 || X(y) ? Z(y) : (e.consume(y), $);
  }
  function B(y) {
    return y === 47 || y === 62 || O(y) ? C(y) : n(y);
  }
  function A(y) {
    return y === 62 ? (e.consume(y), F) : n(y);
  }
  function F(y) {
    return y === null || P(y) ? L(y) : O(y) ? (e.consume(y), F) : n(y);
  }
  function L(y) {
    return y === 45 && i === 2 ? (e.consume(y), W) : y === 60 && i === 1 ? (e.consume(y), K) : y === 62 && i === 4 ? (e.consume(y), ee) : y === 63 && i === 3 ? (e.consume(y), g) : y === 93 && i === 5 ? (e.consume(y), se) : P(y) && (i === 6 || i === 7) ? (e.exit("htmlFlowData"), e.check(is, Ee, q)(y)) : y === null || P(y) ? (e.exit("htmlFlowData"), q(y)) : (e.consume(y), L);
  }
  function q(y) {
    return e.check(ls, z, Ee)(y);
  }
  function z(y) {
    return e.enter("lineEnding"), e.consume(y), e.exit("lineEnding"), T;
  }
  function T(y) {
    return y === null || P(y) ? q(y) : (e.enter("htmlFlowData"), L(y));
  }
  function W(y) {
    return y === 45 ? (e.consume(y), g) : L(y);
  }
  function K(y) {
    return y === 47 ? (e.consume(y), l = "", oe) : L(y);
  }
  function oe(y) {
    if (y === 62) {
      const be = l.toLowerCase();
      return Hr.includes(be) ? (e.consume(y), ee) : L(y);
    }
    return ce(y) && l.length < 8 ? (e.consume(y), l += String.fromCharCode(y), oe) : L(y);
  }
  function se(y) {
    return y === 93 ? (e.consume(y), g) : L(y);
  }
  function g(y) {
    return y === 62 ? (e.consume(y), ee) : y === 45 && i === 2 ? (e.consume(y), g) : L(y);
  }
  function ee(y) {
    return y === null || P(y) ? (e.exit("htmlFlowData"), Ee(y)) : (e.consume(y), ee);
  }
  function Ee(y) {
    return e.exit("htmlFlow"), t(y);
  }
}
function ss(e, t, n) {
  const r = this;
  return i;
  function i(l) {
    return P(l) ? (e.enter("lineEnding"), e.consume(l), e.exit("lineEnding"), a) : n(l);
  }
  function a(l) {
    return r.parser.lazy[r.now().line] ? n(l) : t(l);
  }
}
function us(e, t, n) {
  return r;
  function r(i) {
    return e.enter("lineEnding"), e.consume(i), e.exit("lineEnding"), e.attempt(Mt, t, n);
  }
}
const cs = {
  name: "htmlText",
  tokenize: fs
};
function fs(e, t, n) {
  const r = this;
  let i, a, l;
  return o;
  function o(g) {
    return e.enter("htmlText"), e.enter("htmlTextData"), e.consume(g), s;
  }
  function s(g) {
    return g === 33 ? (e.consume(g), u) : g === 47 ? (e.consume(g), Z) : g === 63 ? (e.consume(g), C) : ce(g) ? (e.consume(g), $) : n(g);
  }
  function u(g) {
    return g === 45 ? (e.consume(g), f) : g === 91 ? (e.consume(g), a = 0, m) : ce(g) ? (e.consume(g), S) : n(g);
  }
  function f(g) {
    return g === 45 ? (e.consume(g), d) : n(g);
  }
  function c(g) {
    return g === null ? n(g) : g === 45 ? (e.consume(g), p) : P(g) ? (l = c, K(g)) : (e.consume(g), c);
  }
  function p(g) {
    return g === 45 ? (e.consume(g), d) : c(g);
  }
  function d(g) {
    return g === 62 ? W(g) : g === 45 ? p(g) : c(g);
  }
  function m(g) {
    const ee = "CDATA[";
    return g === ee.charCodeAt(a++) ? (e.consume(g), a === ee.length ? w : m) : n(g);
  }
  function w(g) {
    return g === null ? n(g) : g === 93 ? (e.consume(g), k) : P(g) ? (l = w, K(g)) : (e.consume(g), w);
  }
  function k(g) {
    return g === 93 ? (e.consume(g), x) : w(g);
  }
  function x(g) {
    return g === 62 ? W(g) : g === 93 ? (e.consume(g), x) : w(g);
  }
  function S(g) {
    return g === null || g === 62 ? W(g) : P(g) ? (l = S, K(g)) : (e.consume(g), S);
  }
  function C(g) {
    return g === null ? n(g) : g === 63 ? (e.consume(g), H) : P(g) ? (l = C, K(g)) : (e.consume(g), C);
  }
  function H(g) {
    return g === 62 ? W(g) : C(g);
  }
  function Z(g) {
    return ce(g) ? (e.consume(g), v) : n(g);
  }
  function v(g) {
    return g === 45 || le(g) ? (e.consume(g), v) : V(g);
  }
  function V(g) {
    return P(g) ? (l = V, K(g)) : O(g) ? (e.consume(g), V) : W(g);
  }
  function $(g) {
    return g === 45 || le(g) ? (e.consume(g), $) : g === 47 || g === 62 || X(g) ? B(g) : n(g);
  }
  function B(g) {
    return g === 47 ? (e.consume(g), W) : g === 58 || g === 95 || ce(g) ? (e.consume(g), A) : P(g) ? (l = B, K(g)) : O(g) ? (e.consume(g), B) : W(g);
  }
  function A(g) {
    return g === 45 || g === 46 || g === 58 || g === 95 || le(g) ? (e.consume(g), A) : F(g);
  }
  function F(g) {
    return g === 61 ? (e.consume(g), L) : P(g) ? (l = F, K(g)) : O(g) ? (e.consume(g), F) : B(g);
  }
  function L(g) {
    return g === null || g === 60 || g === 61 || g === 62 || g === 96 ? n(g) : g === 34 || g === 39 ? (e.consume(g), i = g, q) : P(g) ? (l = L, K(g)) : O(g) ? (e.consume(g), L) : (e.consume(g), z);
  }
  function q(g) {
    return g === i ? (e.consume(g), i = void 0, T) : g === null ? n(g) : P(g) ? (l = q, K(g)) : (e.consume(g), q);
  }
  function z(g) {
    return g === null || g === 34 || g === 39 || g === 60 || g === 61 || g === 96 ? n(g) : g === 47 || g === 62 || X(g) ? B(g) : (e.consume(g), z);
  }
  function T(g) {
    return g === 47 || g === 62 || X(g) ? B(g) : n(g);
  }
  function W(g) {
    return g === 62 ? (e.consume(g), e.exit("htmlTextData"), e.exit("htmlText"), t) : n(g);
  }
  function K(g) {
    return e.exit("htmlTextData"), e.enter("lineEnding"), e.consume(g), e.exit("lineEnding"), oe;
  }
  function oe(g) {
    return O(g) ? U(e, se, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(g) : se(g);
  }
  function se(g) {
    return e.enter("htmlTextData"), l(g);
  }
}
const qn = {
  name: "labelEnd",
  resolveAll: ms,
  resolveTo: gs,
  tokenize: ys
}, hs = {
  tokenize: xs
}, ds = {
  tokenize: bs
}, ps = {
  tokenize: ks
};
function ms(e) {
  let t = -1;
  const n = [];
  for (; ++t < e.length; ) {
    const r = e[t][1];
    if (n.push(e[t]), r.type === "labelImage" || r.type === "labelLink" || r.type === "labelEnd") {
      const i = r.type === "labelImage" ? 4 : 2;
      r.type = "data", t += i;
    }
  }
  return e.length !== n.length && ge(e, 0, e.length, n), e;
}
function gs(e, t) {
  let n = e.length, r = 0, i, a, l, o;
  for (; n--; )
    if (i = e[n][1], a) {
      if (i.type === "link" || i.type === "labelLink" && i._inactive)
        break;
      e[n][0] === "enter" && i.type === "labelLink" && (i._inactive = !0);
    } else if (l) {
      if (e[n][0] === "enter" && (i.type === "labelImage" || i.type === "labelLink") && !i._balanced && (a = n, i.type !== "labelLink")) {
        r = 2;
        break;
      }
    } else i.type === "labelEnd" && (l = n);
  const s = {
    type: e[a][1].type === "labelLink" ? "link" : "image",
    start: {
      ...e[a][1].start
    },
    end: {
      ...e[e.length - 1][1].end
    }
  }, u = {
    type: "label",
    start: {
      ...e[a][1].start
    },
    end: {
      ...e[l][1].end
    }
  }, f = {
    type: "labelText",
    start: {
      ...e[a + r + 2][1].end
    },
    end: {
      ...e[l - 2][1].start
    }
  };
  return o = [["enter", s, t], ["enter", u, t]], o = xe(o, e.slice(a + 1, a + r + 3)), o = xe(o, [["enter", f, t]]), o = xe(o, qt(t.parser.constructs.insideSpan.null, e.slice(a + r + 4, l - 3), t)), o = xe(o, [["exit", f, t], e[l - 2], e[l - 1], ["exit", u, t]]), o = xe(o, e.slice(l + 1)), o = xe(o, [["exit", s, t]]), ge(e, a, e.length, o), e;
}
function ys(e, t, n) {
  const r = this;
  let i = r.events.length, a, l;
  for (; i--; )
    if ((r.events[i][1].type === "labelImage" || r.events[i][1].type === "labelLink") && !r.events[i][1]._balanced) {
      a = r.events[i][1];
      break;
    }
  return o;
  function o(p) {
    return a ? a._inactive ? c(p) : (l = r.parser.defined.includes(we(r.sliceSerialize({
      start: a.end,
      end: r.now()
    }))), e.enter("labelEnd"), e.enter("labelMarker"), e.consume(p), e.exit("labelMarker"), e.exit("labelEnd"), s) : n(p);
  }
  function s(p) {
    return p === 40 ? e.attempt(hs, f, l ? f : c)(p) : p === 91 ? e.attempt(ds, f, l ? u : c)(p) : l ? f(p) : c(p);
  }
  function u(p) {
    return e.attempt(ps, f, c)(p);
  }
  function f(p) {
    return t(p);
  }
  function c(p) {
    return a._balanced = !0, n(p);
  }
}
function xs(e, t, n) {
  return r;
  function r(c) {
    return e.enter("resource"), e.enter("resourceMarker"), e.consume(c), e.exit("resourceMarker"), i;
  }
  function i(c) {
    return X(c) ? bt(e, a)(c) : a(c);
  }
  function a(c) {
    return c === 41 ? f(c) : ji(e, l, o, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(c);
  }
  function l(c) {
    return X(c) ? bt(e, s)(c) : f(c);
  }
  function o(c) {
    return n(c);
  }
  function s(c) {
    return c === 34 || c === 39 || c === 40 ? Ui(e, u, n, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(c) : f(c);
  }
  function u(c) {
    return X(c) ? bt(e, f)(c) : f(c);
  }
  function f(c) {
    return c === 41 ? (e.enter("resourceMarker"), e.consume(c), e.exit("resourceMarker"), e.exit("resource"), t) : n(c);
  }
}
function bs(e, t, n) {
  const r = this;
  return i;
  function i(o) {
    return $i.call(r, e, a, l, "reference", "referenceMarker", "referenceString")(o);
  }
  function a(o) {
    return r.parser.defined.includes(we(r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1))) ? t(o) : n(o);
  }
  function l(o) {
    return n(o);
  }
}
function ks(e, t, n) {
  return r;
  function r(a) {
    return e.enter("reference"), e.enter("referenceMarker"), e.consume(a), e.exit("referenceMarker"), i;
  }
  function i(a) {
    return a === 93 ? (e.enter("referenceMarker"), e.consume(a), e.exit("referenceMarker"), e.exit("reference"), t) : n(a);
  }
}
const ws = {
  name: "labelStartImage",
  resolveAll: qn.resolveAll,
  tokenize: As
};
function As(e, t, n) {
  const r = this;
  return i;
  function i(o) {
    return e.enter("labelImage"), e.enter("labelImageMarker"), e.consume(o), e.exit("labelImageMarker"), a;
  }
  function a(o) {
    return o === 91 ? (e.enter("labelMarker"), e.consume(o), e.exit("labelMarker"), e.exit("labelImage"), l) : n(o);
  }
  function l(o) {
    return o === 94 && "_hiddenFootnoteSupport" in r.parser.constructs ? n(o) : t(o);
  }
}
const vs = {
  name: "labelStartLink",
  resolveAll: qn.resolveAll,
  tokenize: Es
};
function Es(e, t, n) {
  const r = this;
  return i;
  function i(l) {
    return e.enter("labelLink"), e.enter("labelMarker"), e.consume(l), e.exit("labelMarker"), e.exit("labelLink"), a;
  }
  function a(l) {
    return l === 94 && "_hiddenFootnoteSupport" in r.parser.constructs ? n(l) : t(l);
  }
}
const rn = {
  name: "lineEnding",
  tokenize: Cs
};
function Cs(e, t) {
  return n;
  function n(r) {
    return e.enter("lineEnding"), e.consume(r), e.exit("lineEnding"), U(e, t, "linePrefix");
  }
}
const Dt = {
  name: "thematicBreak",
  tokenize: Ss
};
function Ss(e, t, n) {
  let r = 0, i;
  return a;
  function a(u) {
    return e.enter("thematicBreak"), l(u);
  }
  function l(u) {
    return i = u, o(u);
  }
  function o(u) {
    return u === i ? (e.enter("thematicBreakSequence"), s(u)) : r >= 3 && (u === null || P(u)) ? (e.exit("thematicBreak"), t(u)) : n(u);
  }
  function s(u) {
    return u === i ? (e.consume(u), r++, s) : (e.exit("thematicBreakSequence"), O(u) ? U(e, o, "whitespace")(u) : o(u));
  }
}
const fe = {
  continuation: {
    tokenize: Is
  },
  exit: Fs,
  name: "list",
  tokenize: Ns
}, Ms = {
  partial: !0,
  tokenize: zs
}, Ls = {
  partial: !0,
  tokenize: Ts
};
function Ns(e, t, n) {
  const r = this, i = r.events[r.events.length - 1];
  let a = i && i[1].type === "linePrefix" ? i[2].sliceSerialize(i[1], !0).length : 0, l = 0;
  return o;
  function o(d) {
    const m = r.containerState.type || (d === 42 || d === 43 || d === 45 ? "listUnordered" : "listOrdered");
    if (m === "listUnordered" ? !r.containerState.marker || d === r.containerState.marker : An(d)) {
      if (r.containerState.type || (r.containerState.type = m, e.enter(m, {
        _container: !0
      })), m === "listUnordered")
        return e.enter("listItemPrefix"), d === 42 || d === 45 ? e.check(Dt, n, u)(d) : u(d);
      if (!r.interrupt || d === 49)
        return e.enter("listItemPrefix"), e.enter("listItemValue"), s(d);
    }
    return n(d);
  }
  function s(d) {
    return An(d) && ++l < 10 ? (e.consume(d), s) : (!r.interrupt || l < 2) && (r.containerState.marker ? d === r.containerState.marker : d === 41 || d === 46) ? (e.exit("listItemValue"), u(d)) : n(d);
  }
  function u(d) {
    return e.enter("listItemMarker"), e.consume(d), e.exit("listItemMarker"), r.containerState.marker = r.containerState.marker || d, e.check(
      Mt,
      // Can’t be empty when interrupting.
      r.interrupt ? n : f,
      e.attempt(Ms, p, c)
    );
  }
  function f(d) {
    return r.containerState.initialBlankLine = !0, a++, p(d);
  }
  function c(d) {
    return O(d) ? (e.enter("listItemPrefixWhitespace"), e.consume(d), e.exit("listItemPrefixWhitespace"), p) : n(d);
  }
  function p(d) {
    return r.containerState.size = a + r.sliceSerialize(e.exit("listItemPrefix"), !0).length, t(d);
  }
}
function Is(e, t, n) {
  const r = this;
  return r.containerState._closeFlow = void 0, e.check(Mt, i, a);
  function i(o) {
    return r.containerState.furtherBlankLines = r.containerState.furtherBlankLines || r.containerState.initialBlankLine, U(e, t, "listItemIndent", r.containerState.size + 1)(o);
  }
  function a(o) {
    return r.containerState.furtherBlankLines || !O(o) ? (r.containerState.furtherBlankLines = void 0, r.containerState.initialBlankLine = void 0, l(o)) : (r.containerState.furtherBlankLines = void 0, r.containerState.initialBlankLine = void 0, e.attempt(Ls, t, l)(o));
  }
  function l(o) {
    return r.containerState._closeFlow = !0, r.interrupt = void 0, U(e, e.attempt(fe, t, n), "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(o);
  }
}
function Ts(e, t, n) {
  const r = this;
  return U(e, i, "listItemIndent", r.containerState.size + 1);
  function i(a) {
    const l = r.events[r.events.length - 1];
    return l && l[1].type === "listItemIndent" && l[2].sliceSerialize(l[1], !0).length === r.containerState.size ? t(a) : n(a);
  }
}
function Fs(e) {
  e.exit(this.containerState.type);
}
function zs(e, t, n) {
  const r = this;
  return U(e, i, "listItemPrefixWhitespace", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 5);
  function i(a) {
    const l = r.events[r.events.length - 1];
    return !O(a) && l && l[1].type === "listItemPrefixWhitespace" ? t(a) : n(a);
  }
}
const Pr = {
  name: "setextUnderline",
  resolveTo: Hs,
  tokenize: Ps
};
function Hs(e, t) {
  let n = e.length, r, i, a;
  for (; n--; )
    if (e[n][0] === "enter") {
      if (e[n][1].type === "content") {
        r = n;
        break;
      }
      e[n][1].type === "paragraph" && (i = n);
    } else
      e[n][1].type === "content" && e.splice(n, 1), !a && e[n][1].type === "definition" && (a = n);
  const l = {
    type: "setextHeading",
    start: {
      ...e[r][1].start
    },
    end: {
      ...e[e.length - 1][1].end
    }
  };
  return e[i][1].type = "setextHeadingText", a ? (e.splice(i, 0, ["enter", l, t]), e.splice(a + 1, 0, ["exit", e[r][1], t]), e[r][1].end = {
    ...e[a][1].end
  }) : e[r][1] = l, e.push(["exit", l, t]), e;
}
function Ps(e, t, n) {
  const r = this;
  let i;
  return a;
  function a(u) {
    let f = r.events.length, c;
    for (; f--; )
      if (r.events[f][1].type !== "lineEnding" && r.events[f][1].type !== "linePrefix" && r.events[f][1].type !== "content") {
        c = r.events[f][1].type === "paragraph";
        break;
      }
    return !r.parser.lazy[r.now().line] && (r.interrupt || c) ? (e.enter("setextHeadingLine"), i = u, l(u)) : n(u);
  }
  function l(u) {
    return e.enter("setextHeadingLineSequence"), o(u);
  }
  function o(u) {
    return u === i ? (e.consume(u), o) : (e.exit("setextHeadingLineSequence"), O(u) ? U(e, s, "lineSuffix")(u) : s(u));
  }
  function s(u) {
    return u === null || P(u) ? (e.exit("setextHeadingLine"), t(u)) : n(u);
  }
}
const Zs = {
  tokenize: Ds
};
function Ds(e) {
  const t = this, n = e.attempt(
    // Try to parse a blank line.
    Mt,
    r,
    // Try to parse initial flow (essentially, only code).
    e.attempt(this.parser.constructs.flowInitial, i, U(e, e.attempt(this.parser.constructs.flow, i, e.attempt(Bo, i)), "linePrefix"))
  );
  return n;
  function r(a) {
    if (a === null) {
      e.consume(a);
      return;
    }
    return e.enter("lineEndingBlank"), e.consume(a), e.exit("lineEndingBlank"), t.currentConstruct = void 0, n;
  }
  function i(a) {
    if (a === null) {
      e.consume(a);
      return;
    }
    return e.enter("lineEnding"), e.consume(a), e.exit("lineEnding"), t.currentConstruct = void 0, n;
  }
}
const Rs = {
  resolveAll: qi()
}, _s = Wi("string"), Vs = Wi("text");
function Wi(e) {
  return {
    resolveAll: qi(e === "text" ? Os : void 0),
    tokenize: t
  };
  function t(n) {
    const r = this, i = this.parser.constructs[e], a = n.attempt(i, l, o);
    return l;
    function l(f) {
      return u(f) ? a(f) : o(f);
    }
    function o(f) {
      if (f === null) {
        n.consume(f);
        return;
      }
      return n.enter("data"), n.consume(f), s;
    }
    function s(f) {
      return u(f) ? (n.exit("data"), a(f)) : (n.consume(f), s);
    }
    function u(f) {
      if (f === null)
        return !0;
      const c = i[f];
      let p = -1;
      if (c)
        for (; ++p < c.length; ) {
          const d = c[p];
          if (!d.previous || d.previous.call(r, r.previous))
            return !0;
        }
      return !1;
    }
  }
}
function qi(e) {
  return t;
  function t(n, r) {
    let i = -1, a;
    for (; ++i <= n.length; )
      a === void 0 ? n[i] && n[i][1].type === "data" && (a = i, i++) : (!n[i] || n[i][1].type !== "data") && (i !== a + 2 && (n[a][1].end = n[i - 1][1].end, n.splice(a + 2, i - a - 2), i = a + 2), a = void 0);
    return e ? e(n, r) : n;
  }
}
function Os(e, t) {
  let n = 0;
  for (; ++n <= e.length; )
    if ((n === e.length || e[n][1].type === "lineEnding") && e[n - 1][1].type === "data") {
      const r = e[n - 1][1], i = t.sliceStream(r);
      let a = i.length, l = -1, o = 0, s;
      for (; a--; ) {
        const u = i[a];
        if (typeof u == "string") {
          for (l = u.length; u.charCodeAt(l - 1) === 32; )
            o++, l--;
          if (l) break;
          l = -1;
        } else if (u === -2)
          s = !0, o++;
        else if (u !== -1) {
          a++;
          break;
        }
      }
      if (t._contentTypeTextTrailing && n === e.length && (o = 0), o) {
        const u = {
          type: n === e.length || s || o < 2 ? "lineSuffix" : "hardBreakTrailing",
          start: {
            _bufferIndex: a ? l : r.start._bufferIndex + l,
            _index: r.start._index + a,
            line: r.end.line,
            column: r.end.column - o,
            offset: r.end.offset - o
          },
          end: {
            ...r.end
          }
        };
        r.end = {
          ...u.start
        }, r.start.offset === r.end.offset ? Object.assign(r, u) : (e.splice(n, 0, ["enter", u, t], ["exit", u, t]), n += 2);
      }
      n++;
    }
  return e;
}
const Bs = {
  42: fe,
  43: fe,
  45: fe,
  48: fe,
  49: fe,
  50: fe,
  51: fe,
  52: fe,
  53: fe,
  54: fe,
  55: fe,
  56: fe,
  57: fe,
  62: _i
}, js = {
  91: qo
}, $s = {
  [-2]: nn,
  [-1]: nn,
  32: nn
}, Us = {
  35: Ko,
  42: Dt,
  45: [Pr, Dt],
  60: rs,
  61: Pr,
  95: Dt,
  96: zr,
  126: zr
}, Ws = {
  38: Oi,
  92: Vi
}, qs = {
  [-5]: rn,
  [-4]: rn,
  [-3]: rn,
  33: ws,
  38: Oi,
  42: vn,
  60: [vo, cs],
  91: vs,
  92: [Qo, Vi],
  93: qn,
  95: vn,
  96: Zo
}, Gs = {
  null: [vn, Rs]
}, Ys = {
  null: [42, 95]
}, Xs = {
  null: []
}, Qs = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  attentionMarkers: Ys,
  contentInitial: js,
  disable: Xs,
  document: Bs,
  flow: Us,
  flowInitial: $s,
  insideSpan: Gs,
  string: Ws,
  text: qs
}, Symbol.toStringTag, { value: "Module" }));
function Js(e, t, n) {
  let r = {
    _bufferIndex: -1,
    _index: 0,
    line: n && n.line || 1,
    column: n && n.column || 1,
    offset: n && n.offset || 0
  };
  const i = {}, a = [];
  let l = [], o = [];
  const s = {
    attempt: V(Z),
    check: V(v),
    consume: S,
    enter: C,
    exit: H,
    interrupt: V(v, {
      interrupt: !0
    })
  }, u = {
    code: null,
    containerState: {},
    defineSkip: w,
    events: [],
    now: m,
    parser: e,
    previous: null,
    sliceSerialize: p,
    sliceStream: d,
    write: c
  };
  let f = t.tokenize.call(u, s);
  return t.resolveAll && a.push(t), u;
  function c(F) {
    return l = xe(l, F), k(), l[l.length - 1] !== null ? [] : ($(t, 0), u.events = qt(a, u.events, u), u.events);
  }
  function p(F, L) {
    return eu(d(F), L);
  }
  function d(F) {
    return Ks(l, F);
  }
  function m() {
    const {
      _bufferIndex: F,
      _index: L,
      line: q,
      column: z,
      offset: T
    } = r;
    return {
      _bufferIndex: F,
      _index: L,
      line: q,
      column: z,
      offset: T
    };
  }
  function w(F) {
    i[F.line] = F.column, A();
  }
  function k() {
    let F;
    for (; r._index < l.length; ) {
      const L = l[r._index];
      if (typeof L == "string")
        for (F = r._index, r._bufferIndex < 0 && (r._bufferIndex = 0); r._index === F && r._bufferIndex < L.length; )
          x(L.charCodeAt(r._bufferIndex));
      else
        x(L);
    }
  }
  function x(F) {
    f = f(F);
  }
  function S(F) {
    P(F) ? (r.line++, r.column = 1, r.offset += F === -3 ? 2 : 1, A()) : F !== -1 && (r.column++, r.offset++), r._bufferIndex < 0 ? r._index++ : (r._bufferIndex++, r._bufferIndex === // Points w/ non-negative `_bufferIndex` reference
    // strings.
    /** @type {string} */
    l[r._index].length && (r._bufferIndex = -1, r._index++)), u.previous = F;
  }
  function C(F, L) {
    const q = L || {};
    return q.type = F, q.start = m(), u.events.push(["enter", q, u]), o.push(q), q;
  }
  function H(F) {
    const L = o.pop();
    return L.end = m(), u.events.push(["exit", L, u]), L;
  }
  function Z(F, L) {
    $(F, L.from);
  }
  function v(F, L) {
    L.restore();
  }
  function V(F, L) {
    return q;
    function q(z, T, W) {
      let K, oe, se, g;
      return Array.isArray(z) ? (
        /* c8 ignore next 1 */
        Ee(z)
      ) : "tokenize" in z ? (
        // Looks like a construct.
        Ee([
          /** @type {Construct} */
          z
        ])
      ) : ee(z);
      function ee(re) {
        return ot;
        function ot(Te) {
          const qe = Te !== null && re[Te], Ge = Te !== null && re.null, Nt = [
            // To do: add more extension tests.
            /* c8 ignore next 2 */
            ...Array.isArray(qe) ? qe : qe ? [qe] : [],
            ...Array.isArray(Ge) ? Ge : Ge ? [Ge] : []
          ];
          return Ee(Nt)(Te);
        }
      }
      function Ee(re) {
        return K = re, oe = 0, re.length === 0 ? W : y(re[oe]);
      }
      function y(re) {
        return ot;
        function ot(Te) {
          return g = B(), se = re, re.partial || (u.currentConstruct = re), re.name && u.parser.constructs.disable.null.includes(re.name) ? De() : re.tokenize.call(
            // If we do have fields, create an object w/ `context` as its
            // prototype.
            // This allows a “live binding”, which is needed for `interrupt`.
            L ? Object.assign(Object.create(u), L) : u,
            s,
            be,
            De
          )(Te);
        }
      }
      function be(re) {
        return F(se, g), T;
      }
      function De(re) {
        return g.restore(), ++oe < K.length ? y(K[oe]) : W;
      }
    }
  }
  function $(F, L) {
    F.resolveAll && !a.includes(F) && a.push(F), F.resolve && ge(u.events, L, u.events.length - L, F.resolve(u.events.slice(L), u)), F.resolveTo && (u.events = F.resolveTo(u.events, u));
  }
  function B() {
    const F = m(), L = u.previous, q = u.currentConstruct, z = u.events.length, T = Array.from(o);
    return {
      from: z,
      restore: W
    };
    function W() {
      r = F, u.previous = L, u.currentConstruct = q, u.events.length = z, o = T, A();
    }
  }
  function A() {
    r.line in i && r.column < 2 && (r.column = i[r.line], r.offset += i[r.line] - 1);
  }
}
function Ks(e, t) {
  const n = t.start._index, r = t.start._bufferIndex, i = t.end._index, a = t.end._bufferIndex;
  let l;
  if (n === i)
    l = [e[n].slice(r, a)];
  else {
    if (l = e.slice(n, i), r > -1) {
      const o = l[0];
      typeof o == "string" ? l[0] = o.slice(r) : l.shift();
    }
    a > 0 && l.push(e[i].slice(0, a));
  }
  return l;
}
function eu(e, t) {
  let n = -1;
  const r = [];
  let i;
  for (; ++n < e.length; ) {
    const a = e[n];
    let l;
    if (typeof a == "string")
      l = a;
    else switch (a) {
      case -5: {
        l = "\r";
        break;
      }
      case -4: {
        l = `
`;
        break;
      }
      case -3: {
        l = `\r
`;
        break;
      }
      case -2: {
        l = t ? " " : "	";
        break;
      }
      case -1: {
        if (!t && i) continue;
        l = " ";
        break;
      }
      default:
        l = String.fromCharCode(a);
    }
    i = a === -2, r.push(l);
  }
  return r.join("");
}
function tu(e) {
  const r = {
    constructs: (
      /** @type {FullNormalizedExtension} */
      Di([Qs, ...(e || {}).extensions || []])
    ),
    content: i(go),
    defined: [],
    document: i(xo),
    flow: i(Zs),
    lazy: {},
    string: i(_s),
    text: i(Vs)
  };
  return r;
  function i(a) {
    return l;
    function l(o) {
      return Js(r, a, o);
    }
  }
}
function nu(e) {
  for (; !Bi(e); )
    ;
  return e;
}
const Zr = /[\0\t\n\r]/g;
function ru() {
  let e = 1, t = "", n = !0, r;
  return i;
  function i(a, l, o) {
    const s = [];
    let u, f, c, p, d;
    for (a = t + (typeof a == "string" ? a.toString() : new TextDecoder(l || void 0).decode(a)), c = 0, t = "", n && (a.charCodeAt(0) === 65279 && c++, n = void 0); c < a.length; ) {
      if (Zr.lastIndex = c, u = Zr.exec(a), p = u && u.index !== void 0 ? u.index : a.length, d = a.charCodeAt(p), !u) {
        t = a.slice(c);
        break;
      }
      if (d === 10 && c === p && r)
        s.push(-3), r = void 0;
      else
        switch (r && (s.push(-5), r = void 0), c < p && (s.push(a.slice(c, p)), e += p - c), d) {
          case 0: {
            s.push(65533), e++;
            break;
          }
          case 9: {
            for (f = Math.ceil(e / 4) * 4, s.push(-2); e++ < f; ) s.push(-1);
            break;
          }
          case 10: {
            s.push(-4), e = 1;
            break;
          }
          default:
            r = !0, e = 1;
        }
      c = p + 1;
    }
    return o && (r && s.push(-5), t && s.push(t), s.push(null)), s;
  }
}
const iu = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
function lu(e) {
  return e.replace(iu, au);
}
function au(e, t, n) {
  if (t)
    return t;
  if (n.charCodeAt(0) === 35) {
    const i = n.charCodeAt(1), a = i === 120 || i === 88;
    return Ri(n.slice(a ? 2 : 1), a ? 16 : 10);
  }
  return Wn(n) || e;
}
const Gi = {}.hasOwnProperty;
function ou(e, t, n) {
  return t && typeof t == "object" && (n = t, t = void 0), su(n)(nu(tu(n).document().write(ru()(e, t, !0))));
}
function su(e) {
  const t = {
    transforms: [],
    canContainEols: ["emphasis", "fragment", "heading", "paragraph", "strong"],
    enter: {
      autolink: a(pr),
      autolinkProtocol: B,
      autolinkEmail: B,
      atxHeading: a(fr),
      blockQuote: a(Ge),
      characterEscape: B,
      characterReference: B,
      codeFenced: a(Nt),
      codeFencedFenceInfo: l,
      codeFencedFenceMeta: l,
      codeIndented: a(Nt, l),
      codeText: a(Kl, l),
      codeTextData: B,
      data: B,
      codeFlowValue: B,
      definition: a(ea),
      definitionDestinationString: l,
      definitionLabelString: l,
      definitionTitleString: l,
      emphasis: a(ta),
      hardBreakEscape: a(hr),
      hardBreakTrailing: a(hr),
      htmlFlow: a(dr, l),
      htmlFlowData: B,
      htmlText: a(dr, l),
      htmlTextData: B,
      image: a(na),
      label: l,
      link: a(pr),
      listItem: a(ra),
      listItemValue: p,
      listOrdered: a(mr, c),
      listUnordered: a(mr),
      paragraph: a(ia),
      reference: y,
      referenceString: l,
      resourceDestinationString: l,
      resourceTitleString: l,
      setextHeading: a(fr),
      strong: a(la),
      thematicBreak: a(oa)
    },
    exit: {
      atxHeading: s(),
      atxHeadingSequence: Z,
      autolink: s(),
      autolinkEmail: qe,
      autolinkProtocol: Te,
      blockQuote: s(),
      characterEscapeValue: A,
      characterReferenceMarkerHexadecimal: De,
      characterReferenceMarkerNumeric: De,
      characterReferenceValue: re,
      characterReference: ot,
      codeFenced: s(k),
      codeFencedFence: w,
      codeFencedFenceInfo: d,
      codeFencedFenceMeta: m,
      codeFlowValue: A,
      codeIndented: s(x),
      codeText: s(T),
      codeTextData: A,
      data: A,
      definition: s(),
      definitionDestinationString: H,
      definitionLabelString: S,
      definitionTitleString: C,
      emphasis: s(),
      hardBreakEscape: s(L),
      hardBreakTrailing: s(L),
      htmlFlow: s(q),
      htmlFlowData: A,
      htmlText: s(z),
      htmlTextData: A,
      image: s(K),
      label: se,
      labelText: oe,
      lineEnding: F,
      link: s(W),
      listItem: s(),
      listOrdered: s(),
      listUnordered: s(),
      paragraph: s(),
      referenceString: be,
      resourceDestinationString: g,
      resourceTitleString: ee,
      resource: Ee,
      setextHeading: s($),
      setextHeadingLineSequence: V,
      setextHeadingText: v,
      strong: s(),
      thematicBreak: s()
    }
  };
  Yi(t, (e || {}).mdastExtensions || []);
  const n = {};
  return r;
  function r(E) {
    let N = {
      type: "root",
      children: []
    };
    const R = {
      stack: [N],
      tokenStack: [],
      config: t,
      enter: o,
      exit: u,
      buffer: l,
      resume: f,
      data: n
    }, j = [];
    let G = -1;
    for (; ++G < E.length; )
      if (E[G][1].type === "listOrdered" || E[G][1].type === "listUnordered")
        if (E[G][0] === "enter")
          j.push(G);
        else {
          const ke = j.pop();
          G = i(E, ke, G);
        }
    for (G = -1; ++G < E.length; ) {
      const ke = t[E[G][0]];
      Gi.call(ke, E[G][1].type) && ke[E[G][1].type].call(Object.assign({
        sliceSerialize: E[G][2].sliceSerialize
      }, R), E[G][1]);
    }
    if (R.tokenStack.length > 0) {
      const ke = R.tokenStack[R.tokenStack.length - 1];
      (ke[1] || Dr).call(R, void 0, ke[0]);
    }
    for (N.position = {
      start: Fe(E.length > 0 ? E[0][1].start : {
        line: 1,
        column: 1,
        offset: 0
      }),
      end: Fe(E.length > 0 ? E[E.length - 2][1].end : {
        line: 1,
        column: 1,
        offset: 0
      })
    }, G = -1; ++G < t.transforms.length; )
      N = t.transforms[G](N) || N;
    return N;
  }
  function i(E, N, R) {
    let j = N - 1, G = -1, ke = !1, Re, Ce, st, ut;
    for (; ++j <= R; ) {
      const de = E[j];
      switch (de[1].type) {
        case "listUnordered":
        case "listOrdered":
        case "blockQuote": {
          de[0] === "enter" ? G++ : G--, ut = void 0;
          break;
        }
        case "lineEndingBlank": {
          de[0] === "enter" && (Re && !ut && !G && !st && (st = j), ut = void 0);
          break;
        }
        case "linePrefix":
        case "listItemValue":
        case "listItemMarker":
        case "listItemPrefix":
        case "listItemPrefixWhitespace":
          break;
        default:
          ut = void 0;
      }
      if (!G && de[0] === "enter" && de[1].type === "listItemPrefix" || G === -1 && de[0] === "exit" && (de[1].type === "listUnordered" || de[1].type === "listOrdered")) {
        if (Re) {
          let Ye = j;
          for (Ce = void 0; Ye--; ) {
            const Se = E[Ye];
            if (Se[1].type === "lineEnding" || Se[1].type === "lineEndingBlank") {
              if (Se[0] === "exit") continue;
              Ce && (E[Ce][1].type = "lineEndingBlank", ke = !0), Se[1].type = "lineEnding", Ce = Ye;
            } else if (!(Se[1].type === "linePrefix" || Se[1].type === "blockQuotePrefix" || Se[1].type === "blockQuotePrefixWhitespace" || Se[1].type === "blockQuoteMarker" || Se[1].type === "listItemIndent")) break;
          }
          st && (!Ce || st < Ce) && (Re._spread = !0), Re.end = Object.assign({}, Ce ? E[Ce][1].start : de[1].end), E.splice(Ce || j, 0, ["exit", Re, de[2]]), j++, R++;
        }
        if (de[1].type === "listItemPrefix") {
          const Ye = {
            type: "listItem",
            _spread: !1,
            start: Object.assign({}, de[1].start),
            // @ts-expect-error: we’ll add `end` in a second.
            end: void 0
          };
          Re = Ye, E.splice(j, 0, ["enter", Ye, de[2]]), j++, R++, st = void 0, ut = !0;
        }
      }
    }
    return E[N][1]._spread = ke, R;
  }
  function a(E, N) {
    return R;
    function R(j) {
      o.call(this, E(j), j), N && N.call(this, j);
    }
  }
  function l() {
    this.stack.push({
      type: "fragment",
      children: []
    });
  }
  function o(E, N, R) {
    this.stack[this.stack.length - 1].children.push(E), this.stack.push(E), this.tokenStack.push([N, R || void 0]), E.position = {
      start: Fe(N.start),
      // @ts-expect-error: `end` will be patched later.
      end: void 0
    };
  }
  function s(E) {
    return N;
    function N(R) {
      E && E.call(this, R), u.call(this, R);
    }
  }
  function u(E, N) {
    const R = this.stack.pop(), j = this.tokenStack.pop();
    if (j)
      j[0].type !== E.type && (N ? N.call(this, E, j[0]) : (j[1] || Dr).call(this, E, j[0]));
    else throw new Error("Cannot close `" + E.type + "` (" + xt({
      start: E.start,
      end: E.end
    }) + "): it’s not open");
    R.position.end = Fe(E.end);
  }
  function f() {
    return Un(this.stack.pop());
  }
  function c() {
    this.data.expectingFirstListItemValue = !0;
  }
  function p(E) {
    if (this.data.expectingFirstListItemValue) {
      const N = this.stack[this.stack.length - 2];
      N.start = Number.parseInt(this.sliceSerialize(E), 10), this.data.expectingFirstListItemValue = void 0;
    }
  }
  function d() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.lang = E;
  }
  function m() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.meta = E;
  }
  function w() {
    this.data.flowCodeInside || (this.buffer(), this.data.flowCodeInside = !0);
  }
  function k() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.value = E.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, ""), this.data.flowCodeInside = void 0;
  }
  function x() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.value = E.replace(/(\r?\n|\r)$/g, "");
  }
  function S(E) {
    const N = this.resume(), R = this.stack[this.stack.length - 1];
    R.label = N, R.identifier = we(this.sliceSerialize(E)).toLowerCase();
  }
  function C() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.title = E;
  }
  function H() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.url = E;
  }
  function Z(E) {
    const N = this.stack[this.stack.length - 1];
    if (!N.depth) {
      const R = this.sliceSerialize(E).length;
      N.depth = R;
    }
  }
  function v() {
    this.data.setextHeadingSlurpLineEnding = !0;
  }
  function V(E) {
    const N = this.stack[this.stack.length - 1];
    N.depth = this.sliceSerialize(E).codePointAt(0) === 61 ? 1 : 2;
  }
  function $() {
    this.data.setextHeadingSlurpLineEnding = void 0;
  }
  function B(E) {
    const R = this.stack[this.stack.length - 1].children;
    let j = R[R.length - 1];
    (!j || j.type !== "text") && (j = aa(), j.position = {
      start: Fe(E.start),
      // @ts-expect-error: we’ll add `end` later.
      end: void 0
    }, R.push(j)), this.stack.push(j);
  }
  function A(E) {
    const N = this.stack.pop();
    N.value += this.sliceSerialize(E), N.position.end = Fe(E.end);
  }
  function F(E) {
    const N = this.stack[this.stack.length - 1];
    if (this.data.atHardBreak) {
      const R = N.children[N.children.length - 1];
      R.position.end = Fe(E.end), this.data.atHardBreak = void 0;
      return;
    }
    !this.data.setextHeadingSlurpLineEnding && t.canContainEols.includes(N.type) && (B.call(this, E), A.call(this, E));
  }
  function L() {
    this.data.atHardBreak = !0;
  }
  function q() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.value = E;
  }
  function z() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.value = E;
  }
  function T() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.value = E;
  }
  function W() {
    const E = this.stack[this.stack.length - 1];
    if (this.data.inReference) {
      const N = this.data.referenceType || "shortcut";
      E.type += "Reference", E.referenceType = N, delete E.url, delete E.title;
    } else
      delete E.identifier, delete E.label;
    this.data.referenceType = void 0;
  }
  function K() {
    const E = this.stack[this.stack.length - 1];
    if (this.data.inReference) {
      const N = this.data.referenceType || "shortcut";
      E.type += "Reference", E.referenceType = N, delete E.url, delete E.title;
    } else
      delete E.identifier, delete E.label;
    this.data.referenceType = void 0;
  }
  function oe(E) {
    const N = this.sliceSerialize(E), R = this.stack[this.stack.length - 2];
    R.label = lu(N), R.identifier = we(N).toLowerCase();
  }
  function se() {
    const E = this.stack[this.stack.length - 1], N = this.resume(), R = this.stack[this.stack.length - 1];
    if (this.data.inReference = !0, R.type === "link") {
      const j = E.children;
      R.children = j;
    } else
      R.alt = N;
  }
  function g() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.url = E;
  }
  function ee() {
    const E = this.resume(), N = this.stack[this.stack.length - 1];
    N.title = E;
  }
  function Ee() {
    this.data.inReference = void 0;
  }
  function y() {
    this.data.referenceType = "collapsed";
  }
  function be(E) {
    const N = this.resume(), R = this.stack[this.stack.length - 1];
    R.label = N, R.identifier = we(this.sliceSerialize(E)).toLowerCase(), this.data.referenceType = "full";
  }
  function De(E) {
    this.data.characterReferenceType = E.type;
  }
  function re(E) {
    const N = this.sliceSerialize(E), R = this.data.characterReferenceType;
    let j;
    R ? (j = Ri(N, R === "characterReferenceMarkerNumeric" ? 10 : 16), this.data.characterReferenceType = void 0) : j = Wn(N);
    const G = this.stack[this.stack.length - 1];
    G.value += j;
  }
  function ot(E) {
    const N = this.stack.pop();
    N.position.end = Fe(E.end);
  }
  function Te(E) {
    A.call(this, E);
    const N = this.stack[this.stack.length - 1];
    N.url = this.sliceSerialize(E);
  }
  function qe(E) {
    A.call(this, E);
    const N = this.stack[this.stack.length - 1];
    N.url = "mailto:" + this.sliceSerialize(E);
  }
  function Ge() {
    return {
      type: "blockquote",
      children: []
    };
  }
  function Nt() {
    return {
      type: "code",
      lang: null,
      meta: null,
      value: ""
    };
  }
  function Kl() {
    return {
      type: "inlineCode",
      value: ""
    };
  }
  function ea() {
    return {
      type: "definition",
      identifier: "",
      label: null,
      title: null,
      url: ""
    };
  }
  function ta() {
    return {
      type: "emphasis",
      children: []
    };
  }
  function fr() {
    return {
      type: "heading",
      // @ts-expect-error `depth` will be set later.
      depth: 0,
      children: []
    };
  }
  function hr() {
    return {
      type: "break"
    };
  }
  function dr() {
    return {
      type: "html",
      value: ""
    };
  }
  function na() {
    return {
      type: "image",
      title: null,
      url: "",
      alt: null
    };
  }
  function pr() {
    return {
      type: "link",
      title: null,
      url: "",
      children: []
    };
  }
  function mr(E) {
    return {
      type: "list",
      ordered: E.type === "listOrdered",
      start: null,
      spread: E._spread,
      children: []
    };
  }
  function ra(E) {
    return {
      type: "listItem",
      spread: E._spread,
      checked: null,
      children: []
    };
  }
  function ia() {
    return {
      type: "paragraph",
      children: []
    };
  }
  function la() {
    return {
      type: "strong",
      children: []
    };
  }
  function aa() {
    return {
      type: "text",
      value: ""
    };
  }
  function oa() {
    return {
      type: "thematicBreak"
    };
  }
}
function Fe(e) {
  return {
    line: e.line,
    column: e.column,
    offset: e.offset
  };
}
function Yi(e, t) {
  let n = -1;
  for (; ++n < t.length; ) {
    const r = t[n];
    Array.isArray(r) ? Yi(e, r) : uu(e, r);
  }
}
function uu(e, t) {
  let n;
  for (n in t)
    if (Gi.call(t, n))
      switch (n) {
        case "canContainEols": {
          const r = t[n];
          r && e[n].push(...r);
          break;
        }
        case "transforms": {
          const r = t[n];
          r && e[n].push(...r);
          break;
        }
        case "enter":
        case "exit": {
          const r = t[n];
          r && Object.assign(e[n], r);
          break;
        }
      }
}
function Dr(e, t) {
  throw e ? new Error("Cannot close `" + e.type + "` (" + xt({
    start: e.start,
    end: e.end
  }) + "): a different token (`" + t.type + "`, " + xt({
    start: t.start,
    end: t.end
  }) + ") is open") : new Error("Cannot close document, a token (`" + t.type + "`, " + xt({
    start: t.start,
    end: t.end
  }) + ") is still open");
}
function cu(e) {
  const t = this;
  t.parser = n;
  function n(r) {
    return ou(r, {
      ...t.data("settings"),
      ...e,
      // Note: these options are not in the readme.
      // The goal is for them to be set by plugins on `data` instead of being
      // passed by users.
      extensions: t.data("micromarkExtensions") || [],
      mdastExtensions: t.data("fromMarkdownExtensions") || []
    });
  }
}
function fu(e, t) {
  const n = {
    type: "element",
    tagName: "blockquote",
    properties: {},
    children: e.wrap(e.all(t), !0)
  };
  return e.patch(t, n), e.applyData(t, n);
}
function hu(e, t) {
  const n = { type: "element", tagName: "br", properties: {}, children: [] };
  return e.patch(t, n), [e.applyData(t, n), { type: "text", value: `
` }];
}
function du(e, t) {
  const n = t.value ? t.value + `
` : "", r = {}, i = t.lang ? t.lang.split(/\s+/) : [];
  i.length > 0 && (r.className = ["language-" + i[0]]);
  let a = {
    type: "element",
    tagName: "code",
    properties: r,
    children: [{ type: "text", value: n }]
  };
  return t.meta && (a.data = { meta: t.meta }), e.patch(t, a), a = e.applyData(t, a), a = { type: "element", tagName: "pre", properties: {}, children: [a] }, e.patch(t, a), a;
}
function pu(e, t) {
  const n = {
    type: "element",
    tagName: "del",
    properties: {},
    children: e.all(t)
  };
  return e.patch(t, n), e.applyData(t, n);
}
function mu(e, t) {
  const n = {
    type: "element",
    tagName: "em",
    properties: {},
    children: e.all(t)
  };
  return e.patch(t, n), e.applyData(t, n);
}
function gu(e, t) {
  const n = typeof e.options.clobberPrefix == "string" ? e.options.clobberPrefix : "user-content-", r = String(t.identifier).toUpperCase(), i = lt(r.toLowerCase()), a = e.footnoteOrder.indexOf(r);
  let l, o = e.footnoteCounts.get(r);
  o === void 0 ? (o = 0, e.footnoteOrder.push(r), l = e.footnoteOrder.length) : l = a + 1, o += 1, e.footnoteCounts.set(r, o);
  const s = {
    type: "element",
    tagName: "a",
    properties: {
      href: "#" + n + "fn-" + i,
      id: n + "fnref-" + i + (o > 1 ? "-" + o : ""),
      dataFootnoteRef: !0,
      ariaDescribedBy: ["footnote-label"]
    },
    children: [{ type: "text", value: String(l) }]
  };
  e.patch(t, s);
  const u = {
    type: "element",
    tagName: "sup",
    properties: {},
    children: [s]
  };
  return e.patch(t, u), e.applyData(t, u);
}
function yu(e, t) {
  const n = {
    type: "element",
    tagName: "h" + t.depth,
    properties: {},
    children: e.all(t)
  };
  return e.patch(t, n), e.applyData(t, n);
}
function xu(e, t) {
  if (e.options.allowDangerousHtml) {
    const n = { type: "raw", value: t.value };
    return e.patch(t, n), e.applyData(t, n);
  }
}
function Xi(e, t) {
  const n = t.referenceType;
  let r = "]";
  if (n === "collapsed" ? r += "[]" : n === "full" && (r += "[" + (t.label || t.identifier) + "]"), t.type === "imageReference")
    return [{ type: "text", value: "![" + t.alt + r }];
  const i = e.all(t), a = i[0];
  a && a.type === "text" ? a.value = "[" + a.value : i.unshift({ type: "text", value: "[" });
  const l = i[i.length - 1];
  return l && l.type === "text" ? l.value += r : i.push({ type: "text", value: r }), i;
}
function bu(e, t) {
  const n = String(t.identifier).toUpperCase(), r = e.definitionById.get(n);
  if (!r)
    return Xi(e, t);
  const i = { src: lt(r.url || ""), alt: t.alt };
  r.title !== null && r.title !== void 0 && (i.title = r.title);
  const a = { type: "element", tagName: "img", properties: i, children: [] };
  return e.patch(t, a), e.applyData(t, a);
}
function ku(e, t) {
  const n = { src: lt(t.url) };
  t.alt !== null && t.alt !== void 0 && (n.alt = t.alt), t.title !== null && t.title !== void 0 && (n.title = t.title);
  const r = { type: "element", tagName: "img", properties: n, children: [] };
  return e.patch(t, r), e.applyData(t, r);
}
function wu(e, t) {
  const n = { type: "text", value: t.value.replace(/\r?\n|\r/g, " ") };
  e.patch(t, n);
  const r = {
    type: "element",
    tagName: "code",
    properties: {},
    children: [n]
  };
  return e.patch(t, r), e.applyData(t, r);
}
function Au(e, t) {
  const n = String(t.identifier).toUpperCase(), r = e.definitionById.get(n);
  if (!r)
    return Xi(e, t);
  const i = { href: lt(r.url || "") };
  r.title !== null && r.title !== void 0 && (i.title = r.title);
  const a = {
    type: "element",
    tagName: "a",
    properties: i,
    children: e.all(t)
  };
  return e.patch(t, a), e.applyData(t, a);
}
function vu(e, t) {
  const n = { href: lt(t.url) };
  t.title !== null && t.title !== void 0 && (n.title = t.title);
  const r = {
    type: "element",
    tagName: "a",
    properties: n,
    children: e.all(t)
  };
  return e.patch(t, r), e.applyData(t, r);
}
function Eu(e, t, n) {
  const r = e.all(t), i = n ? Cu(n) : Qi(t), a = {}, l = [];
  if (typeof t.checked == "boolean") {
    const f = r[0];
    let c;
    f && f.type === "element" && f.tagName === "p" ? c = f : (c = { type: "element", tagName: "p", properties: {}, children: [] }, r.unshift(c)), c.children.length > 0 && c.children.unshift({ type: "text", value: " " }), c.children.unshift({
      type: "element",
      tagName: "input",
      properties: { type: "checkbox", checked: t.checked, disabled: !0 },
      children: []
    }), a.className = ["task-list-item"];
  }
  let o = -1;
  for (; ++o < r.length; ) {
    const f = r[o];
    (i || o !== 0 || f.type !== "element" || f.tagName !== "p") && l.push({ type: "text", value: `
` }), f.type === "element" && f.tagName === "p" && !i ? l.push(...f.children) : l.push(f);
  }
  const s = r[r.length - 1];
  s && (i || s.type !== "element" || s.tagName !== "p") && l.push({ type: "text", value: `
` });
  const u = { type: "element", tagName: "li", properties: a, children: l };
  return e.patch(t, u), e.applyData(t, u);
}
function Cu(e) {
  let t = !1;
  if (e.type === "list") {
    t = e.spread || !1;
    const n = e.children;
    let r = -1;
    for (; !t && ++r < n.length; )
      t = Qi(n[r]);
  }
  return t;
}
function Qi(e) {
  const t = e.spread;
  return t ?? e.children.length > 1;
}
function Su(e, t) {
  const n = {}, r = e.all(t);
  let i = -1;
  for (typeof t.start == "number" && t.start !== 1 && (n.start = t.start); ++i < r.length; ) {
    const l = r[i];
    if (l.type === "element" && l.tagName === "li" && l.properties && Array.isArray(l.properties.className) && l.properties.className.includes("task-list-item")) {
      n.className = ["contains-task-list"];
      break;
    }
  }
  const a = {
    type: "element",
    tagName: t.ordered ? "ol" : "ul",
    properties: n,
    children: e.wrap(r, !0)
  };
  return e.patch(t, a), e.applyData(t, a);
}
function Mu(e, t) {
  const n = {
    type: "element",
    tagName: "p",
    properties: {},
    children: e.all(t)
  };
  return e.patch(t, n), e.applyData(t, n);
}
function Lu(e, t) {
  const n = { type: "root", children: e.wrap(e.all(t)) };
  return e.patch(t, n), e.applyData(t, n);
}
function Nu(e, t) {
  const n = {
    type: "element",
    tagName: "strong",
    properties: {},
    children: e.all(t)
  };
  return e.patch(t, n), e.applyData(t, n);
}
function Iu(e, t) {
  const n = e.all(t), r = n.shift(), i = [];
  if (r) {
    const l = {
      type: "element",
      tagName: "thead",
      properties: {},
      children: e.wrap([r], !0)
    };
    e.patch(t.children[0], l), i.push(l);
  }
  if (n.length > 0) {
    const l = {
      type: "element",
      tagName: "tbody",
      properties: {},
      children: e.wrap(n, !0)
    }, o = On(t.children[1]), s = Ii(t.children[t.children.length - 1]);
    o && s && (l.position = { start: o, end: s }), i.push(l);
  }
  const a = {
    type: "element",
    tagName: "table",
    properties: {},
    children: e.wrap(i, !0)
  };
  return e.patch(t, a), e.applyData(t, a);
}
function Tu(e, t, n) {
  const r = n ? n.children : void 0, a = (r ? r.indexOf(t) : 1) === 0 ? "th" : "td", l = n && n.type === "table" ? n.align : void 0, o = l ? l.length : t.children.length;
  let s = -1;
  const u = [];
  for (; ++s < o; ) {
    const c = t.children[s], p = {}, d = l ? l[s] : void 0;
    d && (p.align = d);
    let m = { type: "element", tagName: a, properties: p, children: [] };
    c && (m.children = e.all(c), e.patch(c, m), m = e.applyData(c, m)), u.push(m);
  }
  const f = {
    type: "element",
    tagName: "tr",
    properties: {},
    children: e.wrap(u, !0)
  };
  return e.patch(t, f), e.applyData(t, f);
}
function Fu(e, t) {
  const n = {
    type: "element",
    tagName: "td",
    // Assume body cell.
    properties: {},
    children: e.all(t)
  };
  return e.patch(t, n), e.applyData(t, n);
}
const Rr = 9, _r = 32;
function zu(e) {
  const t = String(e), n = /\r?\n|\r/g;
  let r = n.exec(t), i = 0;
  const a = [];
  for (; r; )
    a.push(
      Vr(t.slice(i, r.index), i > 0, !0),
      r[0]
    ), i = r.index + r[0].length, r = n.exec(t);
  return a.push(Vr(t.slice(i), i > 0, !1)), a.join("");
}
function Vr(e, t, n) {
  let r = 0, i = e.length;
  if (t) {
    let a = e.codePointAt(r);
    for (; a === Rr || a === _r; )
      r++, a = e.codePointAt(r);
  }
  if (n) {
    let a = e.codePointAt(i - 1);
    for (; a === Rr || a === _r; )
      i--, a = e.codePointAt(i - 1);
  }
  return i > r ? e.slice(r, i) : "";
}
function Hu(e, t) {
  const n = { type: "text", value: zu(String(t.value)) };
  return e.patch(t, n), e.applyData(t, n);
}
function Pu(e, t) {
  const n = {
    type: "element",
    tagName: "hr",
    properties: {},
    children: []
  };
  return e.patch(t, n), e.applyData(t, n);
}
const Zu = {
  blockquote: fu,
  break: hu,
  code: du,
  delete: pu,
  emphasis: mu,
  footnoteReference: gu,
  heading: yu,
  html: xu,
  imageReference: bu,
  image: ku,
  inlineCode: wu,
  linkReference: Au,
  link: vu,
  listItem: Eu,
  list: Su,
  paragraph: Mu,
  // @ts-expect-error: root is different, but hard to type.
  root: Lu,
  strong: Nu,
  table: Iu,
  tableCell: Fu,
  tableRow: Tu,
  text: Hu,
  thematicBreak: Pu,
  toml: It,
  yaml: It,
  definition: It,
  footnoteDefinition: It
};
function It() {
}
const Ji = -1, Gt = 0, kt = 1, Vt = 2, Gn = 3, Yn = 4, Xn = 5, Qn = 6, Ki = 7, el = 8, tl = typeof self == "object" ? self : globalThis, Or = (e, t) => {
  switch (e) {
    case "Function":
    case "SharedWorker":
    case "Worker":
    case "eval":
    case "setInterval":
    case "setTimeout":
      throw new TypeError("unable to deserialize " + e);
  }
  return new tl[e](t);
}, Du = (e, t) => {
  const n = (i, a) => (e.set(a, i), i), r = (i) => {
    if (e.has(i))
      return e.get(i);
    const [a, l] = t[i];
    switch (a) {
      case Gt:
      case Ji:
        return n(l, i);
      case kt: {
        const o = n([], i);
        for (const s of l)
          o.push(r(s));
        return o;
      }
      case Vt: {
        const o = n({}, i);
        for (const [s, u] of l)
          o[r(s)] = r(u);
        return o;
      }
      case Gn:
        return n(new Date(l), i);
      case Yn: {
        const { source: o, flags: s } = l;
        return n(new RegExp(o, s), i);
      }
      case Xn: {
        const o = n(/* @__PURE__ */ new Map(), i);
        for (const [s, u] of l)
          o.set(r(s), r(u));
        return o;
      }
      case Qn: {
        const o = n(/* @__PURE__ */ new Set(), i);
        for (const s of l)
          o.add(r(s));
        return o;
      }
      case Ki: {
        const { name: o, message: s } = l;
        return n(
          typeof tl[o] == "function" ? Or(o, s) : new Error(s),
          i
        );
      }
      case el:
        return n(BigInt(l), i);
      case "BigInt":
        return n(Object(BigInt(l)), i);
      case "ArrayBuffer":
        return n(new Uint8Array(l).buffer, l);
      case "DataView": {
        const { buffer: o } = new Uint8Array(l);
        return n(new DataView(o), l);
      }
    }
    return n(Or(a, l), i);
  };
  return r;
}, Br = (e) => Du(/* @__PURE__ */ new Map(), e)(0), Oe = "", { toString: Ru } = {}, { keys: _u } = Object, dt = (e) => {
  const t = typeof e;
  if (t !== "object" || !e)
    return [Gt, t];
  const n = Ru.call(e).slice(8, -1);
  switch (n) {
    case "Array":
      return [kt, Oe];
    case "Object":
      return [Vt, Oe];
    case "Date":
      return [Gn, Oe];
    case "RegExp":
      return [Yn, Oe];
    case "Map":
      return [Xn, Oe];
    case "Set":
      return [Qn, Oe];
    case "DataView":
      return [kt, n];
  }
  return n.includes("Array") ? [kt, n] : e instanceof Error ? [Ki, e.name || "Error"] : [Vt, n];
}, Tt = ([e, t]) => e === Gt && (t === "function" || t === "symbol"), Vu = (e, t, n, r) => {
  const i = (l, o) => {
    const s = r.push(l) - 1;
    return n.set(o, s), s;
  }, a = (l) => {
    if (n.has(l))
      return n.get(l);
    let [o, s] = dt(l);
    switch (o) {
      case Gt: {
        let f = l;
        switch (s) {
          case "bigint":
            o = el, f = l.toString();
            break;
          case "function":
          case "symbol":
            if (e)
              throw new TypeError("unable to serialize " + s);
            f = null;
            break;
          case "undefined":
            return i([Ji], l);
        }
        return i([o, f], l);
      }
      case kt: {
        if (s) {
          let p = l;
          return s === "DataView" ? p = new Uint8Array(l.buffer) : s === "ArrayBuffer" && (p = new Uint8Array(l)), i([s, [...p]], l);
        }
        const f = [], c = i([o, f], l);
        for (const p of l)
          f.push(a(p));
        return c;
      }
      case Vt: {
        if (s)
          switch (s) {
            case "BigInt":
              return i([s, l.toString()], l);
            case "Boolean":
            case "Number":
            case "String":
              return i([s, l.valueOf()], l);
          }
        if (t && "toJSON" in l)
          return a(l.toJSON());
        const f = [], c = i([o, f], l);
        for (const p of _u(l))
          (e || !Tt(dt(l[p]))) && f.push([a(p), a(l[p])]);
        return c;
      }
      case Gn:
        return i([o, isNaN(l.getTime()) ? Oe : l.toISOString()], l);
      case Yn: {
        const { source: f, flags: c } = l;
        return i([o, { source: f, flags: c }], l);
      }
      case Xn: {
        const f = [], c = i([o, f], l);
        for (const [p, d] of l)
          (e || !(Tt(dt(p)) || Tt(dt(d)))) && f.push([a(p), a(d)]);
        return c;
      }
      case Qn: {
        const f = [], c = i([o, f], l);
        for (const p of l)
          (e || !Tt(dt(p))) && f.push(a(p));
        return c;
      }
    }
    const { message: u } = l;
    return i([o, { name: s, message: u }], l);
  };
  return a;
}, jr = (e, { json: t, lossy: n } = {}) => {
  const r = [];
  return Vu(!(t || n), !!t, /* @__PURE__ */ new Map(), r)(e), r;
}, Ot = typeof structuredClone == "function" ? (
  /* c8 ignore start */
  (e, t) => t && ("json" in t || "lossy" in t) ? Br(jr(e, t)) : structuredClone(e)
) : (e, t) => Br(jr(e, t));
function Ou(e, t) {
  const n = [{ type: "text", value: "↩" }];
  return t > 1 && n.push({
    type: "element",
    tagName: "sup",
    properties: {},
    children: [{ type: "text", value: String(t) }]
  }), n;
}
function Bu(e, t) {
  return "Back to reference " + (e + 1) + (t > 1 ? "-" + t : "");
}
function ju(e) {
  const t = typeof e.options.clobberPrefix == "string" ? e.options.clobberPrefix : "user-content-", n = e.options.footnoteBackContent || Ou, r = e.options.footnoteBackLabel || Bu, i = e.options.footnoteLabel || "Footnotes", a = e.options.footnoteLabelTagName || "h2", l = e.options.footnoteLabelProperties || {
    className: ["sr-only"]
  }, o = [];
  let s = -1;
  for (; ++s < e.footnoteOrder.length; ) {
    const u = e.footnoteById.get(
      e.footnoteOrder[s]
    );
    if (!u)
      continue;
    const f = e.all(u), c = String(u.identifier).toUpperCase(), p = lt(c.toLowerCase());
    let d = 0;
    const m = [], w = e.footnoteCounts.get(c);
    for (; w !== void 0 && ++d <= w; ) {
      m.length > 0 && m.push({ type: "text", value: " " });
      let S = typeof n == "string" ? n : n(s, d);
      typeof S == "string" && (S = { type: "text", value: S }), m.push({
        type: "element",
        tagName: "a",
        properties: {
          href: "#" + t + "fnref-" + p + (d > 1 ? "-" + d : ""),
          dataFootnoteBackref: "",
          ariaLabel: typeof r == "string" ? r : r(s, d),
          className: ["data-footnote-backref"]
        },
        children: Array.isArray(S) ? S : [S]
      });
    }
    const k = f[f.length - 1];
    if (k && k.type === "element" && k.tagName === "p") {
      const S = k.children[k.children.length - 1];
      S && S.type === "text" ? S.value += " " : k.children.push({ type: "text", value: " " }), k.children.push(...m);
    } else
      f.push(...m);
    const x = {
      type: "element",
      tagName: "li",
      properties: { id: t + "fn-" + p },
      children: e.wrap(f, !0)
    };
    e.patch(u, x), o.push(x);
  }
  if (o.length !== 0)
    return {
      type: "element",
      tagName: "section",
      properties: { dataFootnotes: !0, className: ["footnotes"] },
      children: [
        {
          type: "element",
          tagName: a,
          properties: {
            ...Ot(l),
            id: "footnote-label"
          },
          children: [{ type: "text", value: i }]
        },
        { type: "text", value: `
` },
        {
          type: "element",
          tagName: "ol",
          properties: {},
          children: e.wrap(o, !0)
        },
        { type: "text", value: `
` }
      ]
    };
}
const Yt = (
  // Note: overloads in JSDoc can’t yet use different `@template`s.
  /**
   * @type {(
   *   (<Condition extends string>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & {type: Condition}) &
   *   (<Condition extends Props>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Condition) &
   *   (<Condition extends TestFunction>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Predicate<Condition, Node>) &
   *   ((test?: null | undefined) => (node?: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node) &
   *   ((test?: Test) => Check)
   * )}
   */
  /**
   * @param {Test} [test]
   * @returns {Check}
   */
  (function(e) {
    if (e == null)
      return qu;
    if (typeof e == "function")
      return Xt(e);
    if (typeof e == "object")
      return Array.isArray(e) ? $u(e) : (
        // Cast because `ReadonlyArray` goes into the above but `isArray`
        // narrows to `Array`.
        Uu(
          /** @type {Props} */
          e
        )
      );
    if (typeof e == "string")
      return Wu(e);
    throw new Error("Expected function, string, or object as test");
  })
);
function $u(e) {
  const t = [];
  let n = -1;
  for (; ++n < e.length; )
    t[n] = Yt(e[n]);
  return Xt(r);
  function r(...i) {
    let a = -1;
    for (; ++a < t.length; )
      if (t[a].apply(this, i)) return !0;
    return !1;
  }
}
function Uu(e) {
  const t = (
    /** @type {Record<string, unknown>} */
    e
  );
  return Xt(n);
  function n(r) {
    const i = (
      /** @type {Record<string, unknown>} */
      /** @type {unknown} */
      r
    );
    let a;
    for (a in e)
      if (i[a] !== t[a]) return !1;
    return !0;
  }
}
function Wu(e) {
  return Xt(t);
  function t(n) {
    return n && n.type === e;
  }
}
function Xt(e) {
  return t;
  function t(n, r, i) {
    return !!(Gu(n) && e.call(
      this,
      n,
      typeof r == "number" ? r : void 0,
      i || void 0
    ));
  }
}
function qu() {
  return !0;
}
function Gu(e) {
  return e !== null && typeof e == "object" && "type" in e;
}
const nl = [], Yu = !0, En = !1, Xu = "skip";
function rl(e, t, n, r) {
  let i;
  typeof t == "function" && typeof n != "function" ? (r = n, n = t) : i = t;
  const a = Yt(i), l = r ? -1 : 1;
  o(e, void 0, [])();
  function o(s, u, f) {
    const c = (
      /** @type {Record<string, unknown>} */
      s && typeof s == "object" ? s : {}
    );
    if (typeof c.type == "string") {
      const d = (
        // `hast`
        typeof c.tagName == "string" ? c.tagName : (
          // `xast`
          typeof c.name == "string" ? c.name : void 0
        )
      );
      Object.defineProperty(p, "name", {
        value: "node (" + (s.type + (d ? "<" + d + ">" : "")) + ")"
      });
    }
    return p;
    function p() {
      let d = nl, m, w, k;
      if ((!t || a(s, u, f[f.length - 1] || void 0)) && (d = Qu(n(s, f)), d[0] === En))
        return d;
      if ("children" in s && s.children) {
        const x = (
          /** @type {UnistParent} */
          s
        );
        if (x.children && d[0] !== Xu)
          for (w = (r ? x.children.length : -1) + l, k = f.concat(x); w > -1 && w < x.children.length; ) {
            const S = x.children[w];
            if (m = o(S, w, k)(), m[0] === En)
              return m;
            w = typeof m[1] == "number" ? m[1] : w + l;
          }
      }
      return d;
    }
  }
}
function Qu(e) {
  return Array.isArray(e) ? e : typeof e == "number" ? [Yu, e] : e == null ? nl : [e];
}
function Jn(e, t, n, r) {
  let i, a, l;
  typeof t == "function" && typeof n != "function" ? (a = void 0, l = t, i = n) : (a = t, l = n, i = r), rl(e, a, o, i);
  function o(s, u) {
    const f = u[u.length - 1], c = f ? f.children.indexOf(s) : void 0;
    return l(s, c, f);
  }
}
const Cn = {}.hasOwnProperty, Ju = {};
function Ku(e, t) {
  const n = t || Ju, r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map(), l = { ...Zu, ...n.handlers }, o = {
    all: u,
    applyData: t1,
    definitionById: r,
    footnoteById: i,
    footnoteCounts: a,
    footnoteOrder: [],
    handlers: l,
    one: s,
    options: n,
    patch: e1,
    wrap: r1
  };
  return Jn(e, function(f) {
    if (f.type === "definition" || f.type === "footnoteDefinition") {
      const c = f.type === "definition" ? r : i, p = String(f.identifier).toUpperCase();
      c.has(p) || c.set(p, f);
    }
  }), o;
  function s(f, c) {
    const p = f.type, d = o.handlers[p];
    if (Cn.call(o.handlers, p) && d)
      return d(o, f, c);
    if (o.options.passThrough && o.options.passThrough.includes(p)) {
      if ("children" in f) {
        const { children: w, ...k } = f, x = Ot(k);
        return x.children = o.all(f), x;
      }
      return Ot(f);
    }
    return (o.options.unknownHandler || n1)(o, f, c);
  }
  function u(f) {
    const c = [];
    if ("children" in f) {
      const p = f.children;
      let d = -1;
      for (; ++d < p.length; ) {
        const m = o.one(p[d], f);
        if (m) {
          if (d && p[d - 1].type === "break" && (!Array.isArray(m) && m.type === "text" && (m.value = $r(m.value)), !Array.isArray(m) && m.type === "element")) {
            const w = m.children[0];
            w && w.type === "text" && (w.value = $r(w.value));
          }
          Array.isArray(m) ? c.push(...m) : c.push(m);
        }
      }
    }
    return c;
  }
}
function e1(e, t) {
  e.position && (t.position = Oa(e));
}
function t1(e, t) {
  let n = t;
  if (e && e.data) {
    const r = e.data.hName, i = e.data.hChildren, a = e.data.hProperties;
    if (typeof r == "string")
      if (n.type === "element")
        n.tagName = r;
      else {
        const l = "children" in n ? n.children : [n];
        n = { type: "element", tagName: r, properties: {}, children: l };
      }
    n.type === "element" && a && Object.assign(n.properties, Ot(a)), "children" in n && n.children && i !== null && i !== void 0 && (n.children = i);
  }
  return n;
}
function n1(e, t) {
  const n = t.data || {}, r = "value" in t && !(Cn.call(n, "hProperties") || Cn.call(n, "hChildren")) ? { type: "text", value: t.value } : {
    type: "element",
    tagName: "div",
    properties: {},
    children: e.all(t)
  };
  return e.patch(t, r), e.applyData(t, r);
}
function r1(e, t) {
  const n = [];
  let r = -1;
  for (t && n.push({ type: "text", value: `
` }); ++r < e.length; )
    r && n.push({ type: "text", value: `
` }), n.push(e[r]);
  return t && e.length > 0 && n.push({ type: "text", value: `
` }), n;
}
function $r(e) {
  let t = 0, n = e.charCodeAt(t);
  for (; n === 9 || n === 32; )
    t++, n = e.charCodeAt(t);
  return e.slice(t);
}
function Ur(e, t) {
  const n = Ku(e, t), r = n.one(e, void 0), i = ju(n), a = Array.isArray(r) ? { type: "root", children: r } : r || { type: "root", children: [] };
  return i && a.children.push({ type: "text", value: `
` }, i), a;
}
function i1(e, t) {
  return e && "run" in e ? async function(n, r) {
    const i = (
      /** @type {HastRoot} */
      Ur(n, { file: r, ...t })
    );
    await e.run(i, r);
  } : function(n, r) {
    return (
      /** @type {HastRoot} */
      Ur(n, { file: r, ...e || t })
    );
  };
}
function Wr(e) {
  if (e)
    throw e;
}
var ln, qr;
function l1() {
  if (qr) return ln;
  qr = 1;
  var e = Object.prototype.hasOwnProperty, t = Object.prototype.toString, n = Object.defineProperty, r = Object.getOwnPropertyDescriptor, i = function(u) {
    return typeof Array.isArray == "function" ? Array.isArray(u) : t.call(u) === "[object Array]";
  }, a = function(u) {
    if (!u || t.call(u) !== "[object Object]")
      return !1;
    var f = e.call(u, "constructor"), c = u.constructor && u.constructor.prototype && e.call(u.constructor.prototype, "isPrototypeOf");
    if (u.constructor && !f && !c)
      return !1;
    var p;
    for (p in u)
      ;
    return typeof p > "u" || e.call(u, p);
  }, l = function(u, f) {
    n && f.name === "__proto__" ? n(u, f.name, {
      enumerable: !0,
      configurable: !0,
      value: f.newValue,
      writable: !0
    }) : u[f.name] = f.newValue;
  }, o = function(u, f) {
    if (f === "__proto__")
      if (e.call(u, f)) {
        if (r)
          return r(u, f).value;
      } else return;
    return u[f];
  };
  return ln = function s() {
    var u, f, c, p, d, m, w = arguments[0], k = 1, x = arguments.length, S = !1;
    for (typeof w == "boolean" && (S = w, w = arguments[1] || {}, k = 2), (w == null || typeof w != "object" && typeof w != "function") && (w = {}); k < x; ++k)
      if (u = arguments[k], u != null)
        for (f in u)
          c = o(w, f), p = o(u, f), w !== p && (S && p && (a(p) || (d = i(p))) ? (d ? (d = !1, m = c && i(c) ? c : []) : m = c && a(c) ? c : {}, l(w, { name: f, newValue: s(S, m, p) })) : typeof p < "u" && l(w, { name: f, newValue: p }));
    return w;
  }, ln;
}
var a1 = l1();
const an = /* @__PURE__ */ Ni(a1);
function Sn(e) {
  if (typeof e != "object" || e === null)
    return !1;
  const t = Object.getPrototypeOf(e);
  return (t === null || t === Object.prototype || Object.getPrototypeOf(t) === null) && !(Symbol.toStringTag in e) && !(Symbol.iterator in e);
}
function o1() {
  const e = [], t = { run: n, use: r };
  return t;
  function n(...i) {
    let a = -1;
    const l = i.pop();
    if (typeof l != "function")
      throw new TypeError("Expected function as last argument, not " + l);
    o(null, ...i);
    function o(s, ...u) {
      const f = e[++a];
      let c = -1;
      if (s) {
        l(s);
        return;
      }
      for (; ++c < i.length; )
        (u[c] === null || u[c] === void 0) && (u[c] = i[c]);
      i = u, f ? s1(f, o)(...u) : l(null, ...u);
    }
  }
  function r(i) {
    if (typeof i != "function")
      throw new TypeError(
        "Expected `middelware` to be a function, not " + i
      );
    return e.push(i), t;
  }
}
function s1(e, t) {
  let n;
  return r;
  function r(...l) {
    const o = e.length > l.length;
    let s;
    o && l.push(i);
    try {
      s = e.apply(this, l);
    } catch (u) {
      const f = (
        /** @type {Error} */
        u
      );
      if (o && n)
        throw f;
      return i(f);
    }
    o || (s && s.then && typeof s.then == "function" ? s.then(a, i) : s instanceof Error ? i(s) : a(s));
  }
  function i(l, ...o) {
    n || (n = !0, t(l, ...o));
  }
  function a(l) {
    i(null, l);
  }
}
const Ae = { basename: u1, dirname: c1, extname: f1, join: h1, sep: "/" };
function u1(e, t) {
  if (t !== void 0 && typeof t != "string")
    throw new TypeError('"ext" argument must be a string');
  Lt(e);
  let n = 0, r = -1, i = e.length, a;
  if (t === void 0 || t.length === 0 || t.length > e.length) {
    for (; i--; )
      if (e.codePointAt(i) === 47) {
        if (a) {
          n = i + 1;
          break;
        }
      } else r < 0 && (a = !0, r = i + 1);
    return r < 0 ? "" : e.slice(n, r);
  }
  if (t === e)
    return "";
  let l = -1, o = t.length - 1;
  for (; i--; )
    if (e.codePointAt(i) === 47) {
      if (a) {
        n = i + 1;
        break;
      }
    } else
      l < 0 && (a = !0, l = i + 1), o > -1 && (e.codePointAt(i) === t.codePointAt(o--) ? o < 0 && (r = i) : (o = -1, r = l));
  return n === r ? r = l : r < 0 && (r = e.length), e.slice(n, r);
}
function c1(e) {
  if (Lt(e), e.length === 0)
    return ".";
  let t = -1, n = e.length, r;
  for (; --n; )
    if (e.codePointAt(n) === 47) {
      if (r) {
        t = n;
        break;
      }
    } else r || (r = !0);
  return t < 0 ? e.codePointAt(0) === 47 ? "/" : "." : t === 1 && e.codePointAt(0) === 47 ? "//" : e.slice(0, t);
}
function f1(e) {
  Lt(e);
  let t = e.length, n = -1, r = 0, i = -1, a = 0, l;
  for (; t--; ) {
    const o = e.codePointAt(t);
    if (o === 47) {
      if (l) {
        r = t + 1;
        break;
      }
      continue;
    }
    n < 0 && (l = !0, n = t + 1), o === 46 ? i < 0 ? i = t : a !== 1 && (a = 1) : i > -1 && (a = -1);
  }
  return i < 0 || n < 0 || // We saw a non-dot character immediately before the dot.
  a === 0 || // The (right-most) trimmed path component is exactly `..`.
  a === 1 && i === n - 1 && i === r + 1 ? "" : e.slice(i, n);
}
function h1(...e) {
  let t = -1, n;
  for (; ++t < e.length; )
    Lt(e[t]), e[t] && (n = n === void 0 ? e[t] : n + "/" + e[t]);
  return n === void 0 ? "." : d1(n);
}
function d1(e) {
  Lt(e);
  const t = e.codePointAt(0) === 47;
  let n = p1(e, !t);
  return n.length === 0 && !t && (n = "."), n.length > 0 && e.codePointAt(e.length - 1) === 47 && (n += "/"), t ? "/" + n : n;
}
function p1(e, t) {
  let n = "", r = 0, i = -1, a = 0, l = -1, o, s;
  for (; ++l <= e.length; ) {
    if (l < e.length)
      o = e.codePointAt(l);
    else {
      if (o === 47)
        break;
      o = 47;
    }
    if (o === 47) {
      if (!(i === l - 1 || a === 1)) if (i !== l - 1 && a === 2) {
        if (n.length < 2 || r !== 2 || n.codePointAt(n.length - 1) !== 46 || n.codePointAt(n.length - 2) !== 46) {
          if (n.length > 2) {
            if (s = n.lastIndexOf("/"), s !== n.length - 1) {
              s < 0 ? (n = "", r = 0) : (n = n.slice(0, s), r = n.length - 1 - n.lastIndexOf("/")), i = l, a = 0;
              continue;
            }
          } else if (n.length > 0) {
            n = "", r = 0, i = l, a = 0;
            continue;
          }
        }
        t && (n = n.length > 0 ? n + "/.." : "..", r = 2);
      } else
        n.length > 0 ? n += "/" + e.slice(i + 1, l) : n = e.slice(i + 1, l), r = l - i - 1;
      i = l, a = 0;
    } else o === 46 && a > -1 ? a++ : a = -1;
  }
  return n;
}
function Lt(e) {
  if (typeof e != "string")
    throw new TypeError(
      "Path must be a string. Received " + JSON.stringify(e)
    );
}
const m1 = { cwd: g1 };
function g1() {
  return "/";
}
function Mn(e) {
  return !!(e !== null && typeof e == "object" && "href" in e && e.href && "protocol" in e && e.protocol && // @ts-expect-error: indexing is fine.
  e.auth === void 0);
}
function y1(e) {
  if (typeof e == "string")
    e = new URL(e);
  else if (!Mn(e)) {
    const t = new TypeError(
      'The "path" argument must be of type string or an instance of URL. Received `' + e + "`"
    );
    throw t.code = "ERR_INVALID_ARG_TYPE", t;
  }
  if (e.protocol !== "file:") {
    const t = new TypeError("The URL must be of scheme file");
    throw t.code = "ERR_INVALID_URL_SCHEME", t;
  }
  return x1(e);
}
function x1(e) {
  if (e.hostname !== "") {
    const r = new TypeError(
      'File URL host must be "localhost" or empty on darwin'
    );
    throw r.code = "ERR_INVALID_FILE_URL_HOST", r;
  }
  const t = e.pathname;
  let n = -1;
  for (; ++n < t.length; )
    if (t.codePointAt(n) === 37 && t.codePointAt(n + 1) === 50) {
      const r = t.codePointAt(n + 2);
      if (r === 70 || r === 102) {
        const i = new TypeError(
          "File URL path must not include encoded / characters"
        );
        throw i.code = "ERR_INVALID_FILE_URL_PATH", i;
      }
    }
  return decodeURIComponent(t);
}
const on = (
  /** @type {const} */
  [
    "history",
    "path",
    "basename",
    "stem",
    "extname",
    "dirname"
  ]
);
class il {
  /**
   * Create a new virtual file.
   *
   * `options` is treated as:
   *
   * *   `string` or `Uint8Array` — `{value: options}`
   * *   `URL` — `{path: options}`
   * *   `VFile` — shallow copies its data over to the new file
   * *   `object` — all fields are shallow copied over to the new file
   *
   * Path related fields are set in the following order (least specific to
   * most specific): `history`, `path`, `basename`, `stem`, `extname`,
   * `dirname`.
   *
   * You cannot set `dirname` or `extname` without setting either `history`,
   * `path`, `basename`, or `stem` too.
   *
   * @param {Compatible | null | undefined} [value]
   *   File value.
   * @returns
   *   New instance.
   */
  constructor(t) {
    let n;
    t ? Mn(t) ? n = { path: t } : typeof t == "string" || b1(t) ? n = { value: t } : n = t : n = {}, this.cwd = "cwd" in n ? "" : m1.cwd(), this.data = {}, this.history = [], this.messages = [], this.value, this.map, this.result, this.stored;
    let r = -1;
    for (; ++r < on.length; ) {
      const a = on[r];
      a in n && n[a] !== void 0 && n[a] !== null && (this[a] = a === "history" ? [...n[a]] : n[a]);
    }
    let i;
    for (i in n)
      on.includes(i) || (this[i] = n[i]);
  }
  /**
   * Get the basename (including extname) (example: `'index.min.js'`).
   *
   * @returns {string | undefined}
   *   Basename.
   */
  get basename() {
    return typeof this.path == "string" ? Ae.basename(this.path) : void 0;
  }
  /**
   * Set basename (including extname) (`'index.min.js'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be nullified (use `file.path = file.dirname` instead).
   *
   * @param {string} basename
   *   Basename.
   * @returns {undefined}
   *   Nothing.
   */
  set basename(t) {
    un(t, "basename"), sn(t, "basename"), this.path = Ae.join(this.dirname || "", t);
  }
  /**
   * Get the parent path (example: `'~'`).
   *
   * @returns {string | undefined}
   *   Dirname.
   */
  get dirname() {
    return typeof this.path == "string" ? Ae.dirname(this.path) : void 0;
  }
  /**
   * Set the parent path (example: `'~'`).
   *
   * Cannot be set if there’s no `path` yet.
   *
   * @param {string | undefined} dirname
   *   Dirname.
   * @returns {undefined}
   *   Nothing.
   */
  set dirname(t) {
    Gr(this.basename, "dirname"), this.path = Ae.join(t || "", this.basename);
  }
  /**
   * Get the extname (including dot) (example: `'.js'`).
   *
   * @returns {string | undefined}
   *   Extname.
   */
  get extname() {
    return typeof this.path == "string" ? Ae.extname(this.path) : void 0;
  }
  /**
   * Set the extname (including dot) (example: `'.js'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be set if there’s no `path` yet.
   *
   * @param {string | undefined} extname
   *   Extname.
   * @returns {undefined}
   *   Nothing.
   */
  set extname(t) {
    if (sn(t, "extname"), Gr(this.dirname, "extname"), t) {
      if (t.codePointAt(0) !== 46)
        throw new Error("`extname` must start with `.`");
      if (t.includes(".", 1))
        throw new Error("`extname` cannot contain multiple dots");
    }
    this.path = Ae.join(this.dirname, this.stem + (t || ""));
  }
  /**
   * Get the full path (example: `'~/index.min.js'`).
   *
   * @returns {string}
   *   Path.
   */
  get path() {
    return this.history[this.history.length - 1];
  }
  /**
   * Set the full path (example: `'~/index.min.js'`).
   *
   * Cannot be nullified.
   * You can set a file URL (a `URL` object with a `file:` protocol) which will
   * be turned into a path with `url.fileURLToPath`.
   *
   * @param {URL | string} path
   *   Path.
   * @returns {undefined}
   *   Nothing.
   */
  set path(t) {
    Mn(t) && (t = y1(t)), un(t, "path"), this.path !== t && this.history.push(t);
  }
  /**
   * Get the stem (basename w/o extname) (example: `'index.min'`).
   *
   * @returns {string | undefined}
   *   Stem.
   */
  get stem() {
    return typeof this.path == "string" ? Ae.basename(this.path, this.extname) : void 0;
  }
  /**
   * Set the stem (basename w/o extname) (example: `'index.min'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be nullified (use `file.path = file.dirname` instead).
   *
   * @param {string} stem
   *   Stem.
   * @returns {undefined}
   *   Nothing.
   */
  set stem(t) {
    un(t, "stem"), sn(t, "stem"), this.path = Ae.join(this.dirname || "", t + (this.extname || ""));
  }
  // Normal prototypal methods.
  /**
   * Create a fatal message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `true` (error; file not usable)
   * and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {never}
   *   Never.
   * @throws {VFileMessage}
   *   Message.
   */
  fail(t, n, r) {
    const i = this.message(t, n, r);
    throw i.fatal = !0, i;
  }
  /**
   * Create an info message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `undefined` (info; change
   * likely not needed) and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {VFileMessage}
   *   Message.
   */
  info(t, n, r) {
    const i = this.message(t, n, r);
    return i.fatal = void 0, i;
  }
  /**
   * Create a message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `false` (warning; change may be
   * needed) and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {VFileMessage}
   *   Message.
   */
  message(t, n, r) {
    const i = new ae(
      // @ts-expect-error: the overloads are fine.
      t,
      n,
      r
    );
    return this.path && (i.name = this.path + ":" + i.name, i.file = this.path), i.fatal = !1, this.messages.push(i), i;
  }
  /**
   * Serialize the file.
   *
   * > **Note**: which encodings are supported depends on the engine.
   * > For info on Node.js, see:
   * > <https://nodejs.org/api/util.html#whatwg-supported-encodings>.
   *
   * @param {string | null | undefined} [encoding='utf8']
   *   Character encoding to understand `value` as when it’s a `Uint8Array`
   *   (default: `'utf-8'`).
   * @returns {string}
   *   Serialized file.
   */
  toString(t) {
    return this.value === void 0 ? "" : typeof this.value == "string" ? this.value : new TextDecoder(t || void 0).decode(this.value);
  }
}
function sn(e, t) {
  if (e && e.includes(Ae.sep))
    throw new Error(
      "`" + t + "` cannot be a path: did not expect `" + Ae.sep + "`"
    );
}
function un(e, t) {
  if (!e)
    throw new Error("`" + t + "` cannot be empty");
}
function Gr(e, t) {
  if (!e)
    throw new Error("Setting `" + t + "` requires `path` to be set too");
}
function b1(e) {
  return !!(e && typeof e == "object" && "byteLength" in e && "byteOffset" in e);
}
const k1 = (
  /**
   * @type {new <Parameters extends Array<unknown>, Result>(property: string | symbol) => (...parameters: Parameters) => Result}
   */
  /** @type {unknown} */
  /**
   * @this {Function}
   * @param {string | symbol} property
   * @returns {(...parameters: Array<unknown>) => unknown}
   */
  (function(e) {
    const r = (
      /** @type {Record<string | symbol, Function>} */
      // Prototypes do exist.
      // type-coverage:ignore-next-line
      this.constructor.prototype
    ), i = r[e], a = function() {
      return i.apply(a, arguments);
    };
    return Object.setPrototypeOf(a, r), a;
  })
), w1 = {}.hasOwnProperty;
class Kn extends k1 {
  /**
   * Create a processor.
   */
  constructor() {
    super("copy"), this.Compiler = void 0, this.Parser = void 0, this.attachers = [], this.compiler = void 0, this.freezeIndex = -1, this.frozen = void 0, this.namespace = {}, this.parser = void 0, this.transformers = o1();
  }
  /**
   * Copy a processor.
   *
   * @deprecated
   *   This is a private internal method and should not be used.
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   New *unfrozen* processor ({@linkcode Processor}) that is
   *   configured to work the same as its ancestor.
   *   When the descendant processor is configured in the future it does not
   *   affect the ancestral processor.
   */
  copy() {
    const t = (
      /** @type {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>} */
      new Kn()
    );
    let n = -1;
    for (; ++n < this.attachers.length; ) {
      const r = this.attachers[n];
      t.use(...r);
    }
    return t.data(an(!0, {}, this.namespace)), t;
  }
  /**
   * Configure the processor with info available to all plugins.
   * Information is stored in an object.
   *
   * Typically, options can be given to a specific plugin, but sometimes it
   * makes sense to have information shared with several plugins.
   * For example, a list of HTML elements that are self-closing, which is
   * needed during all phases.
   *
   * > **Note**: setting information cannot occur on *frozen* processors.
   * > Call the processor first to create a new unfrozen processor.
   *
   * > **Note**: to register custom data in TypeScript, augment the
   * > {@linkcode Data} interface.
   *
   * @example
   *   This example show how to get and set info:
   *
   *   ```js
   *   import {unified} from 'unified'
   *
   *   const processor = unified().data('alpha', 'bravo')
   *
   *   processor.data('alpha') // => 'bravo'
   *
   *   processor.data() // => {alpha: 'bravo'}
   *
   *   processor.data({charlie: 'delta'})
   *
   *   processor.data() // => {charlie: 'delta'}
   *   ```
   *
   * @template {keyof Data} Key
   *
   * @overload
   * @returns {Data}
   *
   * @overload
   * @param {Data} dataset
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {Key} key
   * @returns {Data[Key]}
   *
   * @overload
   * @param {Key} key
   * @param {Data[Key]} value
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @param {Data | Key} [key]
   *   Key to get or set, or entire dataset to set, or nothing to get the
   *   entire dataset (optional).
   * @param {Data[Key]} [value]
   *   Value to set (optional).
   * @returns {unknown}
   *   The current processor when setting, the value at `key` when getting, or
   *   the entire dataset when getting without key.
   */
  data(t, n) {
    return typeof t == "string" ? arguments.length === 2 ? (hn("data", this.frozen), this.namespace[t] = n, this) : w1.call(this.namespace, t) && this.namespace[t] || void 0 : t ? (hn("data", this.frozen), this.namespace = t, this) : this.namespace;
  }
  /**
   * Freeze a processor.
   *
   * Frozen processors are meant to be extended and not to be configured
   * directly.
   *
   * When a processor is frozen it cannot be unfrozen.
   * New processors working the same way can be created by calling the
   * processor.
   *
   * It’s possible to freeze processors explicitly by calling `.freeze()`.
   * Processors freeze automatically when `.parse()`, `.run()`, `.runSync()`,
   * `.stringify()`, `.process()`, or `.processSync()` are called.
   *
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   The current processor.
   */
  freeze() {
    if (this.frozen)
      return this;
    const t = (
      /** @type {Processor} */
      /** @type {unknown} */
      this
    );
    for (; ++this.freezeIndex < this.attachers.length; ) {
      const [n, ...r] = this.attachers[this.freezeIndex];
      if (r[0] === !1)
        continue;
      r[0] === !0 && (r[0] = void 0);
      const i = n.call(t, ...r);
      typeof i == "function" && this.transformers.use(i);
    }
    return this.frozen = !0, this.freezeIndex = Number.POSITIVE_INFINITY, this;
  }
  /**
   * Parse text to a syntax tree.
   *
   * > **Note**: `parse` freezes the processor if not already *frozen*.
   *
   * > **Note**: `parse` performs the parse phase, not the run phase or other
   * > phases.
   *
   * @param {Compatible | undefined} [file]
   *   file to parse (optional); typically `string` or `VFile`; any value
   *   accepted as `x` in `new VFile(x)`.
   * @returns {ParseTree extends undefined ? Node : ParseTree}
   *   Syntax tree representing `file`.
   */
  parse(t) {
    this.freeze();
    const n = Ft(t), r = this.parser || this.Parser;
    return cn("parse", r), r(String(n), n);
  }
  /**
   * Process the given file as configured on the processor.
   *
   * > **Note**: `process` freezes the processor if not already *frozen*.
   *
   * > **Note**: `process` performs the parse, run, and stringify phases.
   *
   * @overload
   * @param {Compatible | undefined} file
   * @param {ProcessCallback<VFileWithOutput<CompileResult>>} done
   * @returns {undefined}
   *
   * @overload
   * @param {Compatible | undefined} [file]
   * @returns {Promise<VFileWithOutput<CompileResult>>}
   *
   * @param {Compatible | undefined} [file]
   *   File (optional); typically `string` or `VFile`]; any value accepted as
   *   `x` in `new VFile(x)`.
   * @param {ProcessCallback<VFileWithOutput<CompileResult>> | undefined} [done]
   *   Callback (optional).
   * @returns {Promise<VFile> | undefined}
   *   Nothing if `done` is given.
   *   Otherwise a promise, rejected with a fatal error or resolved with the
   *   processed file.
   *
   *   The parsed, transformed, and compiled value is available at
   *   `file.value` (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most
   *   > compilers return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  process(t, n) {
    const r = this;
    return this.freeze(), cn("process", this.parser || this.Parser), fn("process", this.compiler || this.Compiler), n ? i(void 0, n) : new Promise(i);
    function i(a, l) {
      const o = Ft(t), s = (
        /** @type {HeadTree extends undefined ? Node : HeadTree} */
        /** @type {unknown} */
        r.parse(o)
      );
      r.run(s, o, function(f, c, p) {
        if (f || !c || !p)
          return u(f);
        const d = (
          /** @type {CompileTree extends undefined ? Node : CompileTree} */
          /** @type {unknown} */
          c
        ), m = r.stringify(d, p);
        E1(m) ? p.value = m : p.result = m, u(
          f,
          /** @type {VFileWithOutput<CompileResult>} */
          p
        );
      });
      function u(f, c) {
        f || !c ? l(f) : a ? a(c) : n(void 0, c);
      }
    }
  }
  /**
   * Process the given file as configured on the processor.
   *
   * An error is thrown if asynchronous transforms are configured.
   *
   * > **Note**: `processSync` freezes the processor if not already *frozen*.
   *
   * > **Note**: `processSync` performs the parse, run, and stringify phases.
   *
   * @param {Compatible | undefined} [file]
   *   File (optional); typically `string` or `VFile`; any value accepted as
   *   `x` in `new VFile(x)`.
   * @returns {VFileWithOutput<CompileResult>}
   *   The processed file.
   *
   *   The parsed, transformed, and compiled value is available at
   *   `file.value` (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most
   *   > compilers return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  processSync(t) {
    let n = !1, r;
    return this.freeze(), cn("processSync", this.parser || this.Parser), fn("processSync", this.compiler || this.Compiler), this.process(t, i), Xr("processSync", "process", n), r;
    function i(a, l) {
      n = !0, Wr(a), r = l;
    }
  }
  /**
   * Run *transformers* on a syntax tree.
   *
   * > **Note**: `run` freezes the processor if not already *frozen*.
   *
   * > **Note**: `run` performs the run phase, not other phases.
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
   * @returns {undefined}
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {Compatible | undefined} file
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
   * @returns {undefined}
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {Compatible | undefined} [file]
   * @returns {Promise<TailTree extends undefined ? Node : TailTree>}
   *
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   *   Tree to transform and inspect.
   * @param {(
   *   RunCallback<TailTree extends undefined ? Node : TailTree> |
   *   Compatible
   * )} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} [done]
   *   Callback (optional).
   * @returns {Promise<TailTree extends undefined ? Node : TailTree> | undefined}
   *   Nothing if `done` is given.
   *   Otherwise, a promise rejected with a fatal error or resolved with the
   *   transformed tree.
   */
  run(t, n, r) {
    Yr(t), this.freeze();
    const i = this.transformers;
    return !r && typeof n == "function" && (r = n, n = void 0), r ? a(void 0, r) : new Promise(a);
    function a(l, o) {
      const s = Ft(n);
      i.run(t, s, u);
      function u(f, c, p) {
        const d = (
          /** @type {TailTree extends undefined ? Node : TailTree} */
          c || t
        );
        f ? o(f) : l ? l(d) : r(void 0, d, p);
      }
    }
  }
  /**
   * Run *transformers* on a syntax tree.
   *
   * An error is thrown if asynchronous transforms are configured.
   *
   * > **Note**: `runSync` freezes the processor if not already *frozen*.
   *
   * > **Note**: `runSync` performs the run phase, not other phases.
   *
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   *   Tree to transform and inspect.
   * @param {Compatible | undefined} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @returns {TailTree extends undefined ? Node : TailTree}
   *   Transformed tree.
   */
  runSync(t, n) {
    let r = !1, i;
    return this.run(t, n, a), Xr("runSync", "run", r), i;
    function a(l, o) {
      Wr(l), i = o, r = !0;
    }
  }
  /**
   * Compile a syntax tree.
   *
   * > **Note**: `stringify` freezes the processor if not already *frozen*.
   *
   * > **Note**: `stringify` performs the stringify phase, not the run phase
   * > or other phases.
   *
   * @param {CompileTree extends undefined ? Node : CompileTree} tree
   *   Tree to compile.
   * @param {Compatible | undefined} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @returns {CompileResult extends undefined ? Value : CompileResult}
   *   Textual representation of the tree (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most compilers
   *   > return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  stringify(t, n) {
    this.freeze();
    const r = Ft(n), i = this.compiler || this.Compiler;
    return fn("stringify", i), Yr(t), i(t, r);
  }
  /**
   * Configure the processor to use a plugin, a list of usable values, or a
   * preset.
   *
   * If the processor is already using a plugin, the previous plugin
   * configuration is changed based on the options that are passed in.
   * In other words, the plugin is not added a second time.
   *
   * > **Note**: `use` cannot be called on *frozen* processors.
   * > Call the processor first to create a new unfrozen processor.
   *
   * @example
   *   There are many ways to pass plugins to `.use()`.
   *   This example gives an overview:
   *
   *   ```js
   *   import {unified} from 'unified'
   *
   *   unified()
   *     // Plugin with options:
   *     .use(pluginA, {x: true, y: true})
   *     // Passing the same plugin again merges configuration (to `{x: true, y: false, z: true}`):
   *     .use(pluginA, {y: false, z: true})
   *     // Plugins:
   *     .use([pluginB, pluginC])
   *     // Two plugins, the second with options:
   *     .use([pluginD, [pluginE, {}]])
   *     // Preset with plugins and settings:
   *     .use({plugins: [pluginF, [pluginG, {}]], settings: {position: false}})
   *     // Settings only:
   *     .use({settings: {position: false}})
   *   ```
   *
   * @template {Array<unknown>} [Parameters=[]]
   * @template {Node | string | undefined} [Input=undefined]
   * @template [Output=Input]
   *
   * @overload
   * @param {Preset | null | undefined} [preset]
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {PluggableList} list
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {Plugin<Parameters, Input, Output>} plugin
   * @param {...(Parameters | [boolean])} parameters
   * @returns {UsePlugin<ParseTree, HeadTree, TailTree, CompileTree, CompileResult, Input, Output>}
   *
   * @param {PluggableList | Plugin | Preset | null | undefined} value
   *   Usable value.
   * @param {...unknown} parameters
   *   Parameters, when a plugin is given as a usable value.
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   Current processor.
   */
  use(t, ...n) {
    const r = this.attachers, i = this.namespace;
    if (hn("use", this.frozen), t != null) if (typeof t == "function")
      s(t, n);
    else if (typeof t == "object")
      Array.isArray(t) ? o(t) : l(t);
    else
      throw new TypeError("Expected usable value, not `" + t + "`");
    return this;
    function a(u) {
      if (typeof u == "function")
        s(u, []);
      else if (typeof u == "object")
        if (Array.isArray(u)) {
          const [f, ...c] = (
            /** @type {PluginTuple<Array<unknown>>} */
            u
          );
          s(f, c);
        } else
          l(u);
      else
        throw new TypeError("Expected usable value, not `" + u + "`");
    }
    function l(u) {
      if (!("plugins" in u) && !("settings" in u))
        throw new Error(
          "Expected usable value but received an empty preset, which is probably a mistake: presets typically come with `plugins` and sometimes with `settings`, but this has neither"
        );
      o(u.plugins), u.settings && (i.settings = an(!0, i.settings, u.settings));
    }
    function o(u) {
      let f = -1;
      if (u != null) if (Array.isArray(u))
        for (; ++f < u.length; ) {
          const c = u[f];
          a(c);
        }
      else
        throw new TypeError("Expected a list of plugins, not `" + u + "`");
    }
    function s(u, f) {
      let c = -1, p = -1;
      for (; ++c < r.length; )
        if (r[c][0] === u) {
          p = c;
          break;
        }
      if (p === -1)
        r.push([u, ...f]);
      else if (f.length > 0) {
        let [d, ...m] = f;
        const w = r[p][1];
        Sn(w) && Sn(d) && (d = an(!0, w, d)), r[p] = [u, d, ...m];
      }
    }
  }
}
const A1 = new Kn().freeze();
function cn(e, t) {
  if (typeof t != "function")
    throw new TypeError("Cannot `" + e + "` without `parser`");
}
function fn(e, t) {
  if (typeof t != "function")
    throw new TypeError("Cannot `" + e + "` without `compiler`");
}
function hn(e, t) {
  if (t)
    throw new Error(
      "Cannot call `" + e + "` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`."
    );
}
function Yr(e) {
  if (!Sn(e) || typeof e.type != "string")
    throw new TypeError("Expected node, got `" + e + "`");
}
function Xr(e, t, n) {
  if (!n)
    throw new Error(
      "`" + e + "` finished async. Use `" + t + "` instead"
    );
}
function Ft(e) {
  return v1(e) ? e : new il(e);
}
function v1(e) {
  return !!(e && typeof e == "object" && "message" in e && "messages" in e);
}
function E1(e) {
  return typeof e == "string" || C1(e);
}
function C1(e) {
  return !!(e && typeof e == "object" && "byteLength" in e && "byteOffset" in e);
}
const S1 = "https://github.com/remarkjs/react-markdown/blob/main/changelog.md", Qr = [], Jr = { allowDangerousHtml: !0 }, M1 = /^(https?|ircs?|mailto|xmpp)$/i, L1 = [
  { from: "astPlugins", id: "remove-buggy-html-in-markdown-parser" },
  { from: "allowDangerousHtml", id: "remove-buggy-html-in-markdown-parser" },
  {
    from: "allowNode",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "allowElement"
  },
  {
    from: "allowedTypes",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "allowedElements"
  },
  { from: "className", id: "remove-classname" },
  {
    from: "disallowedTypes",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "disallowedElements"
  },
  { from: "escapeHtml", id: "remove-buggy-html-in-markdown-parser" },
  { from: "includeElementIndex", id: "#remove-includeelementindex" },
  {
    from: "includeNodeIndex",
    id: "change-includenodeindex-to-includeelementindex"
  },
  { from: "linkTarget", id: "remove-linktarget" },
  { from: "plugins", id: "change-plugins-to-remarkplugins", to: "remarkPlugins" },
  { from: "rawSourcePos", id: "#remove-rawsourcepos" },
  { from: "renderers", id: "change-renderers-to-components", to: "components" },
  { from: "source", id: "change-source-to-children", to: "children" },
  { from: "sourcePos", id: "#remove-sourcepos" },
  { from: "transformImageUri", id: "#add-urltransform", to: "urlTransform" },
  { from: "transformLinkUri", id: "#add-urltransform", to: "urlTransform" }
];
function N1(e) {
  const t = I1(e), n = T1(e);
  return F1(t.runSync(t.parse(n), n), e);
}
function I1(e) {
  const t = e.rehypePlugins || Qr, n = e.remarkPlugins || Qr, r = e.remarkRehypeOptions ? { ...e.remarkRehypeOptions, ...Jr } : Jr;
  return A1().use(cu).use(n).use(i1, r).use(t);
}
function T1(e) {
  const t = e.children || "", n = new il();
  return typeof t == "string" && (n.value = t), n;
}
function F1(e, t) {
  const n = t.allowedElements, r = t.allowElement, i = t.components, a = t.disallowedElements, l = t.skipHtml, o = t.unwrapDisallowed, s = t.urlTransform || z1;
  for (const f of L1)
    Object.hasOwn(t, f.from) && ("" + f.from + (f.to ? "use `" + f.to + "` instead" : "remove it") + S1 + f.id, void 0);
  return Jn(e, u), Wa(e, {
    Fragment: Dn,
    components: i,
    ignoreInvalidStyle: !0,
    jsx: b,
    jsxs: I,
    passKeys: !0,
    passNode: !0
  });
  function u(f, c, p) {
    if (f.type === "raw" && p && typeof c == "number")
      return l ? p.children.splice(c, 1) : p.children[c] = { type: "text", value: f.value }, c;
    if (f.type === "element") {
      let d;
      for (d in tn)
        if (Object.hasOwn(tn, d) && Object.hasOwn(f.properties, d)) {
          const m = f.properties[d], w = tn[d];
          (w === null || w.includes(f.tagName)) && (f.properties[d] = s(String(m || ""), d, f));
        }
    }
    if (f.type === "element") {
      let d = n ? !n.includes(f.tagName) : a ? a.includes(f.tagName) : !1;
      if (!d && r && typeof c == "number" && (d = !r(f, c, p)), d && p && typeof c == "number")
        return o && f.children ? p.children.splice(c, 1, ...f.children) : p.children.splice(c, 1), c;
    }
  }
}
function z1(e) {
  const t = e.indexOf(":"), n = e.indexOf("?"), r = e.indexOf("#"), i = e.indexOf("/");
  return (
    // If there is no protocol, it’s relative.
    t === -1 || // If the first colon is after a `?`, `#`, or `/`, it’s not a protocol.
    i !== -1 && t > i || n !== -1 && t > n || r !== -1 && t > r || // It is a protocol, it should be allowed.
    M1.test(e.slice(0, t)) ? e : ""
  );
}
function Kr(e, t) {
  const n = String(e);
  if (typeof t != "string")
    throw new TypeError("Expected character");
  let r = 0, i = n.indexOf(t);
  for (; i !== -1; )
    r++, i = n.indexOf(t, i + t.length);
  return r;
}
function H1(e) {
  if (typeof e != "string")
    throw new TypeError("Expected a string");
  return e.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
function P1(e, t, n) {
  const i = Yt((n || {}).ignore || []), a = Z1(t);
  let l = -1;
  for (; ++l < a.length; )
    rl(e, "text", o);
  function o(u, f) {
    let c = -1, p;
    for (; ++c < f.length; ) {
      const d = f[c], m = p ? p.children : void 0;
      if (i(
        d,
        m ? m.indexOf(d) : void 0,
        p
      ))
        return;
      p = d;
    }
    if (p)
      return s(u, f);
  }
  function s(u, f) {
    const c = f[f.length - 1], p = a[l][0], d = a[l][1];
    let m = 0;
    const k = c.children.indexOf(u);
    let x = !1, S = [];
    p.lastIndex = 0;
    let C = p.exec(u.value);
    for (; C; ) {
      const H = C.index, Z = {
        index: C.index,
        input: C.input,
        stack: [...f, u]
      };
      let v = d(...C, Z);
      if (typeof v == "string" && (v = v.length > 0 ? { type: "text", value: v } : void 0), v === !1 ? p.lastIndex = H + 1 : (m !== H && S.push({
        type: "text",
        value: u.value.slice(m, H)
      }), Array.isArray(v) ? S.push(...v) : v && S.push(v), m = H + C[0].length, x = !0), !p.global)
        break;
      C = p.exec(u.value);
    }
    return x ? (m < u.value.length && S.push({ type: "text", value: u.value.slice(m) }), c.children.splice(k, 1, ...S)) : S = [u], k + S.length;
  }
}
function Z1(e) {
  const t = [];
  if (!Array.isArray(e))
    throw new TypeError("Expected find and replace tuple or list of tuples");
  const n = !e[0] || Array.isArray(e[0]) ? e : [e];
  let r = -1;
  for (; ++r < n.length; ) {
    const i = n[r];
    t.push([D1(i[0]), R1(i[1])]);
  }
  return t;
}
function D1(e) {
  return typeof e == "string" ? new RegExp(H1(e), "g") : e;
}
function R1(e) {
  return typeof e == "function" ? e : function() {
    return e;
  };
}
const dn = "phrasing", pn = ["autolink", "link", "image", "label"];
function _1() {
  return {
    transforms: [W1],
    enter: {
      literalAutolink: O1,
      literalAutolinkEmail: mn,
      literalAutolinkHttp: mn,
      literalAutolinkWww: mn
    },
    exit: {
      literalAutolink: U1,
      literalAutolinkEmail: $1,
      literalAutolinkHttp: B1,
      literalAutolinkWww: j1
    }
  };
}
function V1() {
  return {
    unsafe: [
      {
        character: "@",
        before: "[+\\-.\\w]",
        after: "[\\-.\\w]",
        inConstruct: dn,
        notInConstruct: pn
      },
      {
        character: ".",
        before: "[Ww]",
        after: "[\\-.\\w]",
        inConstruct: dn,
        notInConstruct: pn
      },
      {
        character: ":",
        before: "[ps]",
        after: "\\/",
        inConstruct: dn,
        notInConstruct: pn
      }
    ]
  };
}
function O1(e) {
  this.enter({ type: "link", title: null, url: "", children: [] }, e);
}
function mn(e) {
  this.config.enter.autolinkProtocol.call(this, e);
}
function B1(e) {
  this.config.exit.autolinkProtocol.call(this, e);
}
function j1(e) {
  this.config.exit.data.call(this, e);
  const t = this.stack[this.stack.length - 1];
  t.type, t.url = "http://" + this.sliceSerialize(e);
}
function $1(e) {
  this.config.exit.autolinkEmail.call(this, e);
}
function U1(e) {
  this.exit(e);
}
function W1(e) {
  P1(
    e,
    [
      [/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, q1],
      [new RegExp("(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)", "gu"), G1]
    ],
    { ignore: ["link", "linkReference"] }
  );
}
function q1(e, t, n, r, i) {
  let a = "";
  if (!ll(i) || (/^w/i.test(t) && (n = t + n, t = "", a = "http://"), !Y1(n)))
    return !1;
  const l = X1(n + r);
  if (!l[0]) return !1;
  const o = {
    type: "link",
    title: null,
    url: a + t + l[0],
    children: [{ type: "text", value: t + l[0] }]
  };
  return l[1] ? [o, { type: "text", value: l[1] }] : o;
}
function G1(e, t, n, r) {
  return (
    // Not an expected previous character.
    !ll(r, !0) || // Label ends in not allowed character.
    /[-\d_]$/.test(n) ? !1 : {
      type: "link",
      title: null,
      url: "mailto:" + t + "@" + n,
      children: [{ type: "text", value: t + "@" + n }]
    }
  );
}
function Y1(e) {
  const t = e.split(".");
  return !(t.length < 2 || t[t.length - 1] && (/_/.test(t[t.length - 1]) || !/[a-zA-Z\d]/.test(t[t.length - 1])) || t[t.length - 2] && (/_/.test(t[t.length - 2]) || !/[a-zA-Z\d]/.test(t[t.length - 2])));
}
function X1(e) {
  const t = /[!"&'),.:;<>?\]}]+$/.exec(e);
  if (!t)
    return [e, void 0];
  e = e.slice(0, t.index);
  let n = t[0], r = n.indexOf(")");
  const i = Kr(e, "(");
  let a = Kr(e, ")");
  for (; r !== -1 && i > a; )
    e += n.slice(0, r + 1), n = n.slice(r + 1), r = n.indexOf(")"), a++;
  return [e, n];
}
function ll(e, t) {
  const n = e.input.charCodeAt(e.index - 1);
  return (e.index === 0 || $e(n) || Wt(n)) && // If it’s an email, the previous character should not be a slash.
  (!t || n !== 47);
}
al.peek = lc;
function Q1() {
  this.buffer();
}
function J1(e) {
  this.enter({ type: "footnoteReference", identifier: "", label: "" }, e);
}
function K1() {
  this.buffer();
}
function ec(e) {
  this.enter(
    { type: "footnoteDefinition", identifier: "", label: "", children: [] },
    e
  );
}
function tc(e) {
  const t = this.resume(), n = this.stack[this.stack.length - 1];
  n.type, n.identifier = we(
    this.sliceSerialize(e)
  ).toLowerCase(), n.label = t;
}
function nc(e) {
  this.exit(e);
}
function rc(e) {
  const t = this.resume(), n = this.stack[this.stack.length - 1];
  n.type, n.identifier = we(
    this.sliceSerialize(e)
  ).toLowerCase(), n.label = t;
}
function ic(e) {
  this.exit(e);
}
function lc() {
  return "[";
}
function al(e, t, n, r) {
  const i = n.createTracker(r);
  let a = i.move("[^");
  const l = n.enter("footnoteReference"), o = n.enter("reference");
  return a += i.move(
    n.safe(n.associationId(e), { after: "]", before: a })
  ), o(), l(), a += i.move("]"), a;
}
function ac() {
  return {
    enter: {
      gfmFootnoteCallString: Q1,
      gfmFootnoteCall: J1,
      gfmFootnoteDefinitionLabelString: K1,
      gfmFootnoteDefinition: ec
    },
    exit: {
      gfmFootnoteCallString: tc,
      gfmFootnoteCall: nc,
      gfmFootnoteDefinitionLabelString: rc,
      gfmFootnoteDefinition: ic
    }
  };
}
function oc(e) {
  let t = !1;
  return e && e.firstLineBlank && (t = !0), {
    handlers: { footnoteDefinition: n, footnoteReference: al },
    // This is on by default already.
    unsafe: [{ character: "[", inConstruct: ["label", "phrasing", "reference"] }]
  };
  function n(r, i, a, l) {
    const o = a.createTracker(l);
    let s = o.move("[^");
    const u = a.enter("footnoteDefinition"), f = a.enter("label");
    return s += o.move(
      a.safe(a.associationId(r), { before: s, after: "]" })
    ), f(), s += o.move("]:"), r.children && r.children.length > 0 && (o.shift(4), s += o.move(
      (t ? `
` : " ") + a.indentLines(
        a.containerFlow(r, o.current()),
        t ? ol : sc
      )
    )), u(), s;
  }
}
function sc(e, t, n) {
  return t === 0 ? e : ol(e, t, n);
}
function ol(e, t, n) {
  return (n ? "" : "    ") + e;
}
const uc = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe"
];
sl.peek = pc;
function cc() {
  return {
    canContainEols: ["delete"],
    enter: { strikethrough: hc },
    exit: { strikethrough: dc }
  };
}
function fc() {
  return {
    unsafe: [
      {
        character: "~",
        inConstruct: "phrasing",
        notInConstruct: uc
      }
    ],
    handlers: { delete: sl }
  };
}
function hc(e) {
  this.enter({ type: "delete", children: [] }, e);
}
function dc(e) {
  this.exit(e);
}
function sl(e, t, n, r) {
  const i = n.createTracker(r), a = n.enter("strikethrough");
  let l = i.move("~~");
  return l += n.containerPhrasing(e, {
    ...i.current(),
    before: l,
    after: "~"
  }), l += i.move("~~"), a(), l;
}
function pc() {
  return "~";
}
function mc(e) {
  return e.length;
}
function gc(e, t) {
  const n = t || {}, r = (n.align || []).concat(), i = n.stringLength || mc, a = [], l = [], o = [], s = [];
  let u = 0, f = -1;
  for (; ++f < e.length; ) {
    const w = [], k = [];
    let x = -1;
    for (e[f].length > u && (u = e[f].length); ++x < e[f].length; ) {
      const S = yc(e[f][x]);
      if (n.alignDelimiters !== !1) {
        const C = i(S);
        k[x] = C, (s[x] === void 0 || C > s[x]) && (s[x] = C);
      }
      w.push(S);
    }
    l[f] = w, o[f] = k;
  }
  let c = -1;
  if (typeof r == "object" && "length" in r)
    for (; ++c < u; )
      a[c] = ei(r[c]);
  else {
    const w = ei(r);
    for (; ++c < u; )
      a[c] = w;
  }
  c = -1;
  const p = [], d = [];
  for (; ++c < u; ) {
    const w = a[c];
    let k = "", x = "";
    w === 99 ? (k = ":", x = ":") : w === 108 ? k = ":" : w === 114 && (x = ":");
    let S = n.alignDelimiters === !1 ? 1 : Math.max(
      1,
      s[c] - k.length - x.length
    );
    const C = k + "-".repeat(S) + x;
    n.alignDelimiters !== !1 && (S = k.length + S + x.length, S > s[c] && (s[c] = S), d[c] = S), p[c] = C;
  }
  l.splice(1, 0, p), o.splice(1, 0, d), f = -1;
  const m = [];
  for (; ++f < l.length; ) {
    const w = l[f], k = o[f];
    c = -1;
    const x = [];
    for (; ++c < u; ) {
      const S = w[c] || "";
      let C = "", H = "";
      if (n.alignDelimiters !== !1) {
        const Z = s[c] - (k[c] || 0), v = a[c];
        v === 114 ? C = " ".repeat(Z) : v === 99 ? Z % 2 ? (C = " ".repeat(Z / 2 + 0.5), H = " ".repeat(Z / 2 - 0.5)) : (C = " ".repeat(Z / 2), H = C) : H = " ".repeat(Z);
      }
      n.delimiterStart !== !1 && !c && x.push("|"), n.padding !== !1 && // Don’t add the opening space if we’re not aligning and the cell is
      // empty: there will be a closing space.
      !(n.alignDelimiters === !1 && S === "") && (n.delimiterStart !== !1 || c) && x.push(" "), n.alignDelimiters !== !1 && x.push(C), x.push(S), n.alignDelimiters !== !1 && x.push(H), n.padding !== !1 && x.push(" "), (n.delimiterEnd !== !1 || c !== u - 1) && x.push("|");
    }
    m.push(
      n.delimiterEnd === !1 ? x.join("").replace(/ +$/, "") : x.join("")
    );
  }
  return m.join(`
`);
}
function yc(e) {
  return e == null ? "" : String(e);
}
function ei(e) {
  const t = typeof e == "string" ? e.codePointAt(0) : 0;
  return t === 67 || t === 99 ? 99 : t === 76 || t === 108 ? 108 : t === 82 || t === 114 ? 114 : 0;
}
function xc(e, t, n, r) {
  const i = n.enter("blockquote"), a = n.createTracker(r);
  a.move("> "), a.shift(2);
  const l = n.indentLines(
    n.containerFlow(e, a.current()),
    bc
  );
  return i(), l;
}
function bc(e, t, n) {
  return ">" + (n ? "" : " ") + e;
}
function kc(e, t) {
  return ti(e, t.inConstruct, !0) && !ti(e, t.notInConstruct, !1);
}
function ti(e, t, n) {
  if (typeof t == "string" && (t = [t]), !t || t.length === 0)
    return n;
  let r = -1;
  for (; ++r < t.length; )
    if (e.includes(t[r]))
      return !0;
  return !1;
}
function ni(e, t, n, r) {
  let i = -1;
  for (; ++i < n.unsafe.length; )
    if (n.unsafe[i].character === `
` && kc(n.stack, n.unsafe[i]))
      return /[ \t]/.test(r.before) ? "" : " ";
  return `\\
`;
}
function wc(e, t) {
  const n = String(e);
  let r = n.indexOf(t), i = r, a = 0, l = 0;
  if (typeof t != "string")
    throw new TypeError("Expected substring");
  for (; r !== -1; )
    r === i ? ++a > l && (l = a) : a = 1, i = r + t.length, r = n.indexOf(t, i);
  return l;
}
function Ac(e, t) {
  return !!(t.options.fences === !1 && e.value && // If there’s no info…
  !e.lang && // And there’s a non-whitespace character…
  /[^ \r\n]/.test(e.value) && // And the value doesn’t start or end in a blank…
  !/^[\t ]*(?:[\r\n]|$)|(?:^|[\r\n])[\t ]*$/.test(e.value));
}
function vc(e) {
  const t = e.options.fence || "`";
  if (t !== "`" && t !== "~")
    throw new Error(
      "Cannot serialize code with `" + t + "` for `options.fence`, expected `` ` `` or `~`"
    );
  return t;
}
function Ec(e, t, n, r) {
  const i = vc(n), a = e.value || "", l = i === "`" ? "GraveAccent" : "Tilde";
  if (Ac(e, n)) {
    const c = n.enter("codeIndented"), p = n.indentLines(a, Cc);
    return c(), p;
  }
  const o = n.createTracker(r), s = i.repeat(Math.max(wc(a, i) + 1, 3)), u = n.enter("codeFenced");
  let f = o.move(s);
  if (e.lang) {
    const c = n.enter(`codeFencedLang${l}`);
    f += o.move(
      n.safe(e.lang, {
        before: f,
        after: " ",
        encode: ["`"],
        ...o.current()
      })
    ), c();
  }
  if (e.lang && e.meta) {
    const c = n.enter(`codeFencedMeta${l}`);
    f += o.move(" "), f += o.move(
      n.safe(e.meta, {
        before: f,
        after: `
`,
        encode: ["`"],
        ...o.current()
      })
    ), c();
  }
  return f += o.move(`
`), a && (f += o.move(a + `
`)), f += o.move(s), u(), f;
}
function Cc(e, t, n) {
  return (n ? "" : "    ") + e;
}
function er(e) {
  const t = e.options.quote || '"';
  if (t !== '"' && t !== "'")
    throw new Error(
      "Cannot serialize title with `" + t + "` for `options.quote`, expected `\"`, or `'`"
    );
  return t;
}
function Sc(e, t, n, r) {
  const i = er(n), a = i === '"' ? "Quote" : "Apostrophe", l = n.enter("definition");
  let o = n.enter("label");
  const s = n.createTracker(r);
  let u = s.move("[");
  return u += s.move(
    n.safe(n.associationId(e), {
      before: u,
      after: "]",
      ...s.current()
    })
  ), u += s.move("]: "), o(), // If there’s no url, or…
  !e.url || // If there are control characters or whitespace.
  /[\0- \u007F]/.test(e.url) ? (o = n.enter("destinationLiteral"), u += s.move("<"), u += s.move(
    n.safe(e.url, { before: u, after: ">", ...s.current() })
  ), u += s.move(">")) : (o = n.enter("destinationRaw"), u += s.move(
    n.safe(e.url, {
      before: u,
      after: e.title ? " " : `
`,
      ...s.current()
    })
  )), o(), e.title && (o = n.enter(`title${a}`), u += s.move(" " + i), u += s.move(
    n.safe(e.title, {
      before: u,
      after: i,
      ...s.current()
    })
  ), u += s.move(i), o()), l(), u;
}
function Mc(e) {
  const t = e.options.emphasis || "*";
  if (t !== "*" && t !== "_")
    throw new Error(
      "Cannot serialize emphasis with `" + t + "` for `options.emphasis`, expected `*`, or `_`"
    );
  return t;
}
function vt(e) {
  return "&#x" + e.toString(16).toUpperCase() + ";";
}
function Bt(e, t, n) {
  const r = rt(e), i = rt(t);
  return r === void 0 ? i === void 0 ? (
    // Letter inside:
    // we have to encode *both* letters for `_` as it is looser.
    // it already forms for `*` (and GFMs `~`).
    n === "_" ? { inside: !0, outside: !0 } : { inside: !1, outside: !1 }
  ) : i === 1 ? (
    // Whitespace inside: encode both (letter, whitespace).
    { inside: !0, outside: !0 }
  ) : (
    // Punctuation inside: encode outer (letter)
    { inside: !1, outside: !0 }
  ) : r === 1 ? i === void 0 ? (
    // Letter inside: already forms.
    { inside: !1, outside: !1 }
  ) : i === 1 ? (
    // Whitespace inside: encode both (whitespace).
    { inside: !0, outside: !0 }
  ) : (
    // Punctuation inside: already forms.
    { inside: !1, outside: !1 }
  ) : i === void 0 ? (
    // Letter inside: already forms.
    { inside: !1, outside: !1 }
  ) : i === 1 ? (
    // Whitespace inside: encode inner (whitespace).
    { inside: !0, outside: !1 }
  ) : (
    // Punctuation inside: already forms.
    { inside: !1, outside: !1 }
  );
}
ul.peek = Lc;
function ul(e, t, n, r) {
  const i = Mc(n), a = n.enter("emphasis"), l = n.createTracker(r), o = l.move(i);
  let s = l.move(
    n.containerPhrasing(e, {
      after: i,
      before: o,
      ...l.current()
    })
  );
  const u = s.charCodeAt(0), f = Bt(
    r.before.charCodeAt(r.before.length - 1),
    u,
    i
  );
  f.inside && (s = vt(u) + s.slice(1));
  const c = s.charCodeAt(s.length - 1), p = Bt(r.after.charCodeAt(0), c, i);
  p.inside && (s = s.slice(0, -1) + vt(c));
  const d = l.move(i);
  return a(), n.attentionEncodeSurroundingInfo = {
    after: p.outside,
    before: f.outside
  }, o + s + d;
}
function Lc(e, t, n) {
  return n.options.emphasis || "*";
}
function Nc(e, t) {
  let n = !1;
  return Jn(e, function(r) {
    if ("value" in r && /\r?\n|\r/.test(r.value) || r.type === "break")
      return n = !0, En;
  }), !!((!e.depth || e.depth < 3) && Un(e) && (t.options.setext || n));
}
function Ic(e, t, n, r) {
  const i = Math.max(Math.min(6, e.depth || 1), 1), a = n.createTracker(r);
  if (Nc(e, n)) {
    const f = n.enter("headingSetext"), c = n.enter("phrasing"), p = n.containerPhrasing(e, {
      ...a.current(),
      before: `
`,
      after: `
`
    });
    return c(), f(), p + `
` + (i === 1 ? "=" : "-").repeat(
      // The whole size…
      p.length - // Minus the position of the character after the last EOL (or
      // 0 if there is none)…
      (Math.max(p.lastIndexOf("\r"), p.lastIndexOf(`
`)) + 1)
    );
  }
  const l = "#".repeat(i), o = n.enter("headingAtx"), s = n.enter("phrasing");
  a.move(l + " ");
  let u = n.containerPhrasing(e, {
    before: "# ",
    after: `
`,
    ...a.current()
  });
  return /^[\t ]/.test(u) && (u = vt(u.charCodeAt(0)) + u.slice(1)), u = u ? l + " " + u : l, n.options.closeAtx && (u += " " + l), s(), o(), u;
}
cl.peek = Tc;
function cl(e) {
  return e.value || "";
}
function Tc() {
  return "<";
}
fl.peek = Fc;
function fl(e, t, n, r) {
  const i = er(n), a = i === '"' ? "Quote" : "Apostrophe", l = n.enter("image");
  let o = n.enter("label");
  const s = n.createTracker(r);
  let u = s.move("![");
  return u += s.move(
    n.safe(e.alt, { before: u, after: "]", ...s.current() })
  ), u += s.move("]("), o(), // If there’s no url but there is a title…
  !e.url && e.title || // If there are control characters or whitespace.
  /[\0- \u007F]/.test(e.url) ? (o = n.enter("destinationLiteral"), u += s.move("<"), u += s.move(
    n.safe(e.url, { before: u, after: ">", ...s.current() })
  ), u += s.move(">")) : (o = n.enter("destinationRaw"), u += s.move(
    n.safe(e.url, {
      before: u,
      after: e.title ? " " : ")",
      ...s.current()
    })
  )), o(), e.title && (o = n.enter(`title${a}`), u += s.move(" " + i), u += s.move(
    n.safe(e.title, {
      before: u,
      after: i,
      ...s.current()
    })
  ), u += s.move(i), o()), u += s.move(")"), l(), u;
}
function Fc() {
  return "!";
}
hl.peek = zc;
function hl(e, t, n, r) {
  const i = e.referenceType, a = n.enter("imageReference");
  let l = n.enter("label");
  const o = n.createTracker(r);
  let s = o.move("![");
  const u = n.safe(e.alt, {
    before: s,
    after: "]",
    ...o.current()
  });
  s += o.move(u + "]["), l();
  const f = n.stack;
  n.stack = [], l = n.enter("reference");
  const c = n.safe(n.associationId(e), {
    before: s,
    after: "]",
    ...o.current()
  });
  return l(), n.stack = f, a(), i === "full" || !u || u !== c ? s += o.move(c + "]") : i === "shortcut" ? s = s.slice(0, -1) : s += o.move("]"), s;
}
function zc() {
  return "!";
}
dl.peek = Hc;
function dl(e, t, n) {
  let r = e.value || "", i = "`", a = -1;
  for (; new RegExp("(^|[^`])" + i + "([^`]|$)").test(r); )
    i += "`";
  for (/[^ \r\n]/.test(r) && (/^[ \r\n]/.test(r) && /[ \r\n]$/.test(r) || /^`|`$/.test(r)) && (r = " " + r + " "); ++a < n.unsafe.length; ) {
    const l = n.unsafe[a], o = n.compilePattern(l);
    let s;
    if (l.atBreak)
      for (; s = o.exec(r); ) {
        let u = s.index;
        r.charCodeAt(u) === 10 && r.charCodeAt(u - 1) === 13 && u--, r = r.slice(0, u) + " " + r.slice(s.index + 1);
      }
  }
  return i + r + i;
}
function Hc() {
  return "`";
}
function pl(e, t) {
  const n = Un(e);
  return !!(!t.options.resourceLink && // If there’s a url…
  e.url && // And there’s a no title…
  !e.title && // And the content of `node` is a single text node…
  e.children && e.children.length === 1 && e.children[0].type === "text" && // And if the url is the same as the content…
  (n === e.url || "mailto:" + n === e.url) && // And that starts w/ a protocol…
  /^[a-z][a-z+.-]+:/i.test(e.url) && // And that doesn’t contain ASCII control codes (character escapes and
  // references don’t work), space, or angle brackets…
  !/[\0- <>\u007F]/.test(e.url));
}
ml.peek = Pc;
function ml(e, t, n, r) {
  const i = er(n), a = i === '"' ? "Quote" : "Apostrophe", l = n.createTracker(r);
  let o, s;
  if (pl(e, n)) {
    const f = n.stack;
    n.stack = [], o = n.enter("autolink");
    let c = l.move("<");
    return c += l.move(
      n.containerPhrasing(e, {
        before: c,
        after: ">",
        ...l.current()
      })
    ), c += l.move(">"), o(), n.stack = f, c;
  }
  o = n.enter("link"), s = n.enter("label");
  let u = l.move("[");
  return u += l.move(
    n.containerPhrasing(e, {
      before: u,
      after: "](",
      ...l.current()
    })
  ), u += l.move("]("), s(), // If there’s no url but there is a title…
  !e.url && e.title || // If there are control characters or whitespace.
  /[\0- \u007F]/.test(e.url) ? (s = n.enter("destinationLiteral"), u += l.move("<"), u += l.move(
    n.safe(e.url, { before: u, after: ">", ...l.current() })
  ), u += l.move(">")) : (s = n.enter("destinationRaw"), u += l.move(
    n.safe(e.url, {
      before: u,
      after: e.title ? " " : ")",
      ...l.current()
    })
  )), s(), e.title && (s = n.enter(`title${a}`), u += l.move(" " + i), u += l.move(
    n.safe(e.title, {
      before: u,
      after: i,
      ...l.current()
    })
  ), u += l.move(i), s()), u += l.move(")"), o(), u;
}
function Pc(e, t, n) {
  return pl(e, n) ? "<" : "[";
}
gl.peek = Zc;
function gl(e, t, n, r) {
  const i = e.referenceType, a = n.enter("linkReference");
  let l = n.enter("label");
  const o = n.createTracker(r);
  let s = o.move("[");
  const u = n.containerPhrasing(e, {
    before: s,
    after: "]",
    ...o.current()
  });
  s += o.move(u + "]["), l();
  const f = n.stack;
  n.stack = [], l = n.enter("reference");
  const c = n.safe(n.associationId(e), {
    before: s,
    after: "]",
    ...o.current()
  });
  return l(), n.stack = f, a(), i === "full" || !u || u !== c ? s += o.move(c + "]") : i === "shortcut" ? s = s.slice(0, -1) : s += o.move("]"), s;
}
function Zc() {
  return "[";
}
function tr(e) {
  const t = e.options.bullet || "*";
  if (t !== "*" && t !== "+" && t !== "-")
    throw new Error(
      "Cannot serialize items with `" + t + "` for `options.bullet`, expected `*`, `+`, or `-`"
    );
  return t;
}
function Dc(e) {
  const t = tr(e), n = e.options.bulletOther;
  if (!n)
    return t === "*" ? "-" : "*";
  if (n !== "*" && n !== "+" && n !== "-")
    throw new Error(
      "Cannot serialize items with `" + n + "` for `options.bulletOther`, expected `*`, `+`, or `-`"
    );
  if (n === t)
    throw new Error(
      "Expected `bullet` (`" + t + "`) and `bulletOther` (`" + n + "`) to be different"
    );
  return n;
}
function Rc(e) {
  const t = e.options.bulletOrdered || ".";
  if (t !== "." && t !== ")")
    throw new Error(
      "Cannot serialize items with `" + t + "` for `options.bulletOrdered`, expected `.` or `)`"
    );
  return t;
}
function yl(e) {
  const t = e.options.rule || "*";
  if (t !== "*" && t !== "-" && t !== "_")
    throw new Error(
      "Cannot serialize rules with `" + t + "` for `options.rule`, expected `*`, `-`, or `_`"
    );
  return t;
}
function _c(e, t, n, r) {
  const i = n.enter("list"), a = n.bulletCurrent;
  let l = e.ordered ? Rc(n) : tr(n);
  const o = e.ordered ? l === "." ? ")" : "." : Dc(n);
  let s = t && n.bulletLastUsed ? l === n.bulletLastUsed : !1;
  if (!e.ordered) {
    const f = e.children ? e.children[0] : void 0;
    if (
      // Bullet could be used as a thematic break marker:
      (l === "*" || l === "-") && // Empty first list item:
      f && (!f.children || !f.children[0]) && // Directly in two other list items:
      n.stack[n.stack.length - 1] === "list" && n.stack[n.stack.length - 2] === "listItem" && n.stack[n.stack.length - 3] === "list" && n.stack[n.stack.length - 4] === "listItem" && // That are each the first child.
      n.indexStack[n.indexStack.length - 1] === 0 && n.indexStack[n.indexStack.length - 2] === 0 && n.indexStack[n.indexStack.length - 3] === 0 && (s = !0), yl(n) === l && f
    ) {
      let c = -1;
      for (; ++c < e.children.length; ) {
        const p = e.children[c];
        if (p && p.type === "listItem" && p.children && p.children[0] && p.children[0].type === "thematicBreak") {
          s = !0;
          break;
        }
      }
    }
  }
  s && (l = o), n.bulletCurrent = l;
  const u = n.containerFlow(e, r);
  return n.bulletLastUsed = l, n.bulletCurrent = a, i(), u;
}
function Vc(e) {
  const t = e.options.listItemIndent || "one";
  if (t !== "tab" && t !== "one" && t !== "mixed")
    throw new Error(
      "Cannot serialize items with `" + t + "` for `options.listItemIndent`, expected `tab`, `one`, or `mixed`"
    );
  return t;
}
function Oc(e, t, n, r) {
  const i = Vc(n);
  let a = n.bulletCurrent || tr(n);
  t && t.type === "list" && t.ordered && (a = (typeof t.start == "number" && t.start > -1 ? t.start : 1) + (n.options.incrementListMarker === !1 ? 0 : t.children.indexOf(e)) + a);
  let l = a.length + 1;
  (i === "tab" || i === "mixed" && (t && t.type === "list" && t.spread || e.spread)) && (l = Math.ceil(l / 4) * 4);
  const o = n.createTracker(r);
  o.move(a + " ".repeat(l - a.length)), o.shift(l);
  const s = n.enter("listItem"), u = n.indentLines(
    n.containerFlow(e, o.current()),
    f
  );
  return s(), u;
  function f(c, p, d) {
    return p ? (d ? "" : " ".repeat(l)) + c : (d ? a : a + " ".repeat(l - a.length)) + c;
  }
}
function Bc(e, t, n, r) {
  const i = n.enter("paragraph"), a = n.enter("phrasing"), l = n.containerPhrasing(e, r);
  return a(), i(), l;
}
const jc = (
  /** @type {(node?: unknown) => node is Exclude<PhrasingContent, Html>} */
  Yt([
    "break",
    "delete",
    "emphasis",
    // To do: next major: removed since footnotes were added to GFM.
    "footnote",
    "footnoteReference",
    "image",
    "imageReference",
    "inlineCode",
    // Enabled by `mdast-util-math`:
    "inlineMath",
    "link",
    "linkReference",
    // Enabled by `mdast-util-mdx`:
    "mdxJsxTextElement",
    // Enabled by `mdast-util-mdx`:
    "mdxTextExpression",
    "strong",
    "text",
    // Enabled by `mdast-util-directive`:
    "textDirective"
  ])
);
function $c(e, t, n, r) {
  return (e.children.some(function(l) {
    return jc(l);
  }) ? n.containerPhrasing : n.containerFlow).call(n, e, r);
}
function Uc(e) {
  const t = e.options.strong || "*";
  if (t !== "*" && t !== "_")
    throw new Error(
      "Cannot serialize strong with `" + t + "` for `options.strong`, expected `*`, or `_`"
    );
  return t;
}
xl.peek = Wc;
function xl(e, t, n, r) {
  const i = Uc(n), a = n.enter("strong"), l = n.createTracker(r), o = l.move(i + i);
  let s = l.move(
    n.containerPhrasing(e, {
      after: i,
      before: o,
      ...l.current()
    })
  );
  const u = s.charCodeAt(0), f = Bt(
    r.before.charCodeAt(r.before.length - 1),
    u,
    i
  );
  f.inside && (s = vt(u) + s.slice(1));
  const c = s.charCodeAt(s.length - 1), p = Bt(r.after.charCodeAt(0), c, i);
  p.inside && (s = s.slice(0, -1) + vt(c));
  const d = l.move(i + i);
  return a(), n.attentionEncodeSurroundingInfo = {
    after: p.outside,
    before: f.outside
  }, o + s + d;
}
function Wc(e, t, n) {
  return n.options.strong || "*";
}
function qc(e, t, n, r) {
  return n.safe(e.value, r);
}
function Gc(e) {
  const t = e.options.ruleRepetition || 3;
  if (t < 3)
    throw new Error(
      "Cannot serialize rules with repetition `" + t + "` for `options.ruleRepetition`, expected `3` or more"
    );
  return t;
}
function Yc(e, t, n) {
  const r = (yl(n) + (n.options.ruleSpaces ? " " : "")).repeat(Gc(n));
  return n.options.ruleSpaces ? r.slice(0, -1) : r;
}
const bl = {
  blockquote: xc,
  break: ni,
  code: Ec,
  definition: Sc,
  emphasis: ul,
  hardBreak: ni,
  heading: Ic,
  html: cl,
  image: fl,
  imageReference: hl,
  inlineCode: dl,
  link: ml,
  linkReference: gl,
  list: _c,
  listItem: Oc,
  paragraph: Bc,
  root: $c,
  strong: xl,
  text: qc,
  thematicBreak: Yc
};
function Xc() {
  return {
    enter: {
      table: Qc,
      tableData: ri,
      tableHeader: ri,
      tableRow: Kc
    },
    exit: {
      codeText: e0,
      table: Jc,
      tableData: gn,
      tableHeader: gn,
      tableRow: gn
    }
  };
}
function Qc(e) {
  const t = e._align;
  this.enter(
    {
      type: "table",
      align: t.map(function(n) {
        return n === "none" ? null : n;
      }),
      children: []
    },
    e
  ), this.data.inTable = !0;
}
function Jc(e) {
  this.exit(e), this.data.inTable = void 0;
}
function Kc(e) {
  this.enter({ type: "tableRow", children: [] }, e);
}
function gn(e) {
  this.exit(e);
}
function ri(e) {
  this.enter({ type: "tableCell", children: [] }, e);
}
function e0(e) {
  let t = this.resume();
  this.data.inTable && (t = t.replace(/\\([\\|])/g, t0));
  const n = this.stack[this.stack.length - 1];
  n.type, n.value = t, this.exit(e);
}
function t0(e, t) {
  return t === "|" ? t : e;
}
function n0(e) {
  const t = e || {}, n = t.tableCellPadding, r = t.tablePipeAlign, i = t.stringLength, a = n ? " " : "|";
  return {
    unsafe: [
      { character: "\r", inConstruct: "tableCell" },
      { character: `
`, inConstruct: "tableCell" },
      // A pipe, when followed by a tab or space (padding), or a dash or colon
      // (unpadded delimiter row), could result in a table.
      { atBreak: !0, character: "|", after: "[	 :-]" },
      // A pipe in a cell must be encoded.
      { character: "|", inConstruct: "tableCell" },
      // A colon must be followed by a dash, in which case it could start a
      // delimiter row.
      { atBreak: !0, character: ":", after: "-" },
      // A delimiter row can also start with a dash, when followed by more
      // dashes, a colon, or a pipe.
      // This is a stricter version than the built in check for lists, thematic
      // breaks, and setex heading underlines though:
      // <https://github.com/syntax-tree/mdast-util-to-markdown/blob/51a2038/lib/unsafe.js#L57>
      { atBreak: !0, character: "-", after: "[:|-]" }
    ],
    handlers: {
      inlineCode: p,
      table: l,
      tableCell: s,
      tableRow: o
    }
  };
  function l(d, m, w, k) {
    return u(f(d, w, k), d.align);
  }
  function o(d, m, w, k) {
    const x = c(d, w, k), S = u([x]);
    return S.slice(0, S.indexOf(`
`));
  }
  function s(d, m, w, k) {
    const x = w.enter("tableCell"), S = w.enter("phrasing"), C = w.containerPhrasing(d, {
      ...k,
      before: a,
      after: a
    });
    return S(), x(), C;
  }
  function u(d, m) {
    return gc(d, {
      align: m,
      // @ts-expect-error: `markdown-table` types should support `null`.
      alignDelimiters: r,
      // @ts-expect-error: `markdown-table` types should support `null`.
      padding: n,
      // @ts-expect-error: `markdown-table` types should support `null`.
      stringLength: i
    });
  }
  function f(d, m, w) {
    const k = d.children;
    let x = -1;
    const S = [], C = m.enter("table");
    for (; ++x < k.length; )
      S[x] = c(k[x], m, w);
    return C(), S;
  }
  function c(d, m, w) {
    const k = d.children;
    let x = -1;
    const S = [], C = m.enter("tableRow");
    for (; ++x < k.length; )
      S[x] = s(k[x], d, m, w);
    return C(), S;
  }
  function p(d, m, w) {
    let k = bl.inlineCode(d, m, w);
    return w.stack.includes("tableCell") && (k = k.replace(/\|/g, "\\$&")), k;
  }
}
function r0() {
  return {
    exit: {
      taskListCheckValueChecked: ii,
      taskListCheckValueUnchecked: ii,
      paragraph: l0
    }
  };
}
function i0() {
  return {
    unsafe: [{ atBreak: !0, character: "-", after: "[:|-]" }],
    handlers: { listItem: a0 }
  };
}
function ii(e) {
  const t = this.stack[this.stack.length - 2];
  t.type, t.checked = e.type === "taskListCheckValueChecked";
}
function l0(e) {
  const t = this.stack[this.stack.length - 2];
  if (t && t.type === "listItem" && typeof t.checked == "boolean") {
    const n = this.stack[this.stack.length - 1];
    n.type;
    const r = n.children[0];
    if (r && r.type === "text") {
      const i = t.children;
      let a = -1, l;
      for (; ++a < i.length; ) {
        const o = i[a];
        if (o.type === "paragraph") {
          l = o;
          break;
        }
      }
      l === n && (r.value = r.value.slice(1), r.value.length === 0 ? n.children.shift() : n.position && r.position && typeof r.position.start.offset == "number" && (r.position.start.column++, r.position.start.offset++, n.position.start = Object.assign({}, r.position.start)));
    }
  }
  this.exit(e);
}
function a0(e, t, n, r) {
  const i = e.children[0], a = typeof e.checked == "boolean" && i && i.type === "paragraph", l = "[" + (e.checked ? "x" : " ") + "] ", o = n.createTracker(r);
  a && o.move(l);
  let s = bl.listItem(e, t, n, {
    ...r,
    ...o.current()
  });
  return a && (s = s.replace(/^(?:[*+-]|\d+\.)([\r\n]| {1,3})/, u)), s;
  function u(f) {
    return f + l;
  }
}
function o0() {
  return [
    _1(),
    ac(),
    cc(),
    Xc(),
    r0()
  ];
}
function s0(e) {
  return {
    extensions: [
      V1(),
      oc(e),
      fc(),
      n0(e),
      i0()
    ]
  };
}
const u0 = {
  tokenize: m0,
  partial: !0
}, kl = {
  tokenize: g0,
  partial: !0
}, wl = {
  tokenize: y0,
  partial: !0
}, Al = {
  tokenize: x0,
  partial: !0
}, c0 = {
  tokenize: b0,
  partial: !0
}, vl = {
  name: "wwwAutolink",
  tokenize: d0,
  previous: Cl
}, El = {
  name: "protocolAutolink",
  tokenize: p0,
  previous: Sl
}, Ie = {
  name: "emailAutolink",
  tokenize: h0,
  previous: Ml
}, ve = {};
function f0() {
  return {
    text: ve
  };
}
let _e = 48;
for (; _e < 123; )
  ve[_e] = Ie, _e++, _e === 58 ? _e = 65 : _e === 91 && (_e = 97);
ve[43] = Ie;
ve[45] = Ie;
ve[46] = Ie;
ve[95] = Ie;
ve[72] = [Ie, El];
ve[104] = [Ie, El];
ve[87] = [Ie, vl];
ve[119] = [Ie, vl];
function h0(e, t, n) {
  const r = this;
  let i, a;
  return l;
  function l(c) {
    return !Ln(c) || !Ml.call(r, r.previous) || nr(r.events) ? n(c) : (e.enter("literalAutolink"), e.enter("literalAutolinkEmail"), o(c));
  }
  function o(c) {
    return Ln(c) ? (e.consume(c), o) : c === 64 ? (e.consume(c), s) : n(c);
  }
  function s(c) {
    return c === 46 ? e.check(c0, f, u)(c) : c === 45 || c === 95 || le(c) ? (a = !0, e.consume(c), s) : f(c);
  }
  function u(c) {
    return e.consume(c), i = !0, s;
  }
  function f(c) {
    return a && i && ce(r.previous) ? (e.exit("literalAutolinkEmail"), e.exit("literalAutolink"), t(c)) : n(c);
  }
}
function d0(e, t, n) {
  const r = this;
  return i;
  function i(l) {
    return l !== 87 && l !== 119 || !Cl.call(r, r.previous) || nr(r.events) ? n(l) : (e.enter("literalAutolink"), e.enter("literalAutolinkWww"), e.check(u0, e.attempt(kl, e.attempt(wl, a), n), n)(l));
  }
  function a(l) {
    return e.exit("literalAutolinkWww"), e.exit("literalAutolink"), t(l);
  }
}
function p0(e, t, n) {
  const r = this;
  let i = "", a = !1;
  return l;
  function l(c) {
    return (c === 72 || c === 104) && Sl.call(r, r.previous) && !nr(r.events) ? (e.enter("literalAutolink"), e.enter("literalAutolinkHttp"), i += String.fromCodePoint(c), e.consume(c), o) : n(c);
  }
  function o(c) {
    if (ce(c) && i.length < 5)
      return i += String.fromCodePoint(c), e.consume(c), o;
    if (c === 58) {
      const p = i.toLowerCase();
      if (p === "http" || p === "https")
        return e.consume(c), s;
    }
    return n(c);
  }
  function s(c) {
    return c === 47 ? (e.consume(c), a ? u : (a = !0, s)) : n(c);
  }
  function u(c) {
    return c === null || _t(c) || X(c) || $e(c) || Wt(c) ? n(c) : e.attempt(kl, e.attempt(wl, f), n)(c);
  }
  function f(c) {
    return e.exit("literalAutolinkHttp"), e.exit("literalAutolink"), t(c);
  }
}
function m0(e, t, n) {
  let r = 0;
  return i;
  function i(l) {
    return (l === 87 || l === 119) && r < 3 ? (r++, e.consume(l), i) : l === 46 && r === 3 ? (e.consume(l), a) : n(l);
  }
  function a(l) {
    return l === null ? n(l) : t(l);
  }
}
function g0(e, t, n) {
  let r, i, a;
  return l;
  function l(u) {
    return u === 46 || u === 95 ? e.check(Al, s, o)(u) : u === null || X(u) || $e(u) || u !== 45 && Wt(u) ? s(u) : (a = !0, e.consume(u), l);
  }
  function o(u) {
    return u === 95 ? r = !0 : (i = r, r = void 0), e.consume(u), l;
  }
  function s(u) {
    return i || r || !a ? n(u) : t(u);
  }
}
function y0(e, t) {
  let n = 0, r = 0;
  return i;
  function i(l) {
    return l === 40 ? (n++, e.consume(l), i) : l === 41 && r < n ? a(l) : l === 33 || l === 34 || l === 38 || l === 39 || l === 41 || l === 42 || l === 44 || l === 46 || l === 58 || l === 59 || l === 60 || l === 63 || l === 93 || l === 95 || l === 126 ? e.check(Al, t, a)(l) : l === null || X(l) || $e(l) ? t(l) : (e.consume(l), i);
  }
  function a(l) {
    return l === 41 && r++, e.consume(l), i;
  }
}
function x0(e, t, n) {
  return r;
  function r(o) {
    return o === 33 || o === 34 || o === 39 || o === 41 || o === 42 || o === 44 || o === 46 || o === 58 || o === 59 || o === 63 || o === 95 || o === 126 ? (e.consume(o), r) : o === 38 ? (e.consume(o), a) : o === 93 ? (e.consume(o), i) : (
      // `<` is an end.
      o === 60 || // So is whitespace.
      o === null || X(o) || $e(o) ? t(o) : n(o)
    );
  }
  function i(o) {
    return o === null || o === 40 || o === 91 || X(o) || $e(o) ? t(o) : r(o);
  }
  function a(o) {
    return ce(o) ? l(o) : n(o);
  }
  function l(o) {
    return o === 59 ? (e.consume(o), r) : ce(o) ? (e.consume(o), l) : n(o);
  }
}
function b0(e, t, n) {
  return r;
  function r(a) {
    return e.consume(a), i;
  }
  function i(a) {
    return le(a) ? n(a) : t(a);
  }
}
function Cl(e) {
  return e === null || e === 40 || e === 42 || e === 95 || e === 91 || e === 93 || e === 126 || X(e);
}
function Sl(e) {
  return !ce(e);
}
function Ml(e) {
  return !(e === 47 || Ln(e));
}
function Ln(e) {
  return e === 43 || e === 45 || e === 46 || e === 95 || le(e);
}
function nr(e) {
  let t = e.length, n = !1;
  for (; t--; ) {
    const r = e[t][1];
    if ((r.type === "labelLink" || r.type === "labelImage") && !r._balanced) {
      n = !0;
      break;
    }
    if (r._gfmAutolinkLiteralWalkedInto) {
      n = !1;
      break;
    }
  }
  return e.length > 0 && !n && (e[e.length - 1][1]._gfmAutolinkLiteralWalkedInto = !0), n;
}
const k0 = {
  tokenize: L0,
  partial: !0
};
function w0() {
  return {
    document: {
      91: {
        name: "gfmFootnoteDefinition",
        tokenize: C0,
        continuation: {
          tokenize: S0
        },
        exit: M0
      }
    },
    text: {
      91: {
        name: "gfmFootnoteCall",
        tokenize: E0
      },
      93: {
        name: "gfmPotentialFootnoteCall",
        add: "after",
        tokenize: A0,
        resolveTo: v0
      }
    }
  };
}
function A0(e, t, n) {
  const r = this;
  let i = r.events.length;
  const a = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []);
  let l;
  for (; i--; ) {
    const s = r.events[i][1];
    if (s.type === "labelImage") {
      l = s;
      break;
    }
    if (s.type === "gfmFootnoteCall" || s.type === "labelLink" || s.type === "label" || s.type === "image" || s.type === "link")
      break;
  }
  return o;
  function o(s) {
    if (!l || !l._balanced)
      return n(s);
    const u = we(r.sliceSerialize({
      start: l.end,
      end: r.now()
    }));
    return u.codePointAt(0) !== 94 || !a.includes(u.slice(1)) ? n(s) : (e.enter("gfmFootnoteCallLabelMarker"), e.consume(s), e.exit("gfmFootnoteCallLabelMarker"), t(s));
  }
}
function v0(e, t) {
  let n = e.length;
  for (; n--; )
    if (e[n][1].type === "labelImage" && e[n][0] === "enter") {
      e[n][1];
      break;
    }
  e[n + 1][1].type = "data", e[n + 3][1].type = "gfmFootnoteCallLabelMarker";
  const r = {
    type: "gfmFootnoteCall",
    start: Object.assign({}, e[n + 3][1].start),
    end: Object.assign({}, e[e.length - 1][1].end)
  }, i = {
    type: "gfmFootnoteCallMarker",
    start: Object.assign({}, e[n + 3][1].end),
    end: Object.assign({}, e[n + 3][1].end)
  };
  i.end.column++, i.end.offset++, i.end._bufferIndex++;
  const a = {
    type: "gfmFootnoteCallString",
    start: Object.assign({}, i.end),
    end: Object.assign({}, e[e.length - 1][1].start)
  }, l = {
    type: "chunkString",
    contentType: "string",
    start: Object.assign({}, a.start),
    end: Object.assign({}, a.end)
  }, o = [
    // Take the `labelImageMarker` (now `data`, the `!`)
    e[n + 1],
    e[n + 2],
    ["enter", r, t],
    // The `[`
    e[n + 3],
    e[n + 4],
    // The `^`.
    ["enter", i, t],
    ["exit", i, t],
    // Everything in between.
    ["enter", a, t],
    ["enter", l, t],
    ["exit", l, t],
    ["exit", a, t],
    // The ending (`]`, properly parsed and labelled).
    e[e.length - 2],
    e[e.length - 1],
    ["exit", r, t]
  ];
  return e.splice(n, e.length - n + 1, ...o), e;
}
function E0(e, t, n) {
  const r = this, i = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []);
  let a = 0, l;
  return o;
  function o(c) {
    return e.enter("gfmFootnoteCall"), e.enter("gfmFootnoteCallLabelMarker"), e.consume(c), e.exit("gfmFootnoteCallLabelMarker"), s;
  }
  function s(c) {
    return c !== 94 ? n(c) : (e.enter("gfmFootnoteCallMarker"), e.consume(c), e.exit("gfmFootnoteCallMarker"), e.enter("gfmFootnoteCallString"), e.enter("chunkString").contentType = "string", u);
  }
  function u(c) {
    if (
      // Too long.
      a > 999 || // Closing brace with nothing.
      c === 93 && !l || // Space or tab is not supported by GFM for some reason.
      // `\n` and `[` not being supported makes sense.
      c === null || c === 91 || X(c)
    )
      return n(c);
    if (c === 93) {
      e.exit("chunkString");
      const p = e.exit("gfmFootnoteCallString");
      return i.includes(we(r.sliceSerialize(p))) ? (e.enter("gfmFootnoteCallLabelMarker"), e.consume(c), e.exit("gfmFootnoteCallLabelMarker"), e.exit("gfmFootnoteCall"), t) : n(c);
    }
    return X(c) || (l = !0), a++, e.consume(c), c === 92 ? f : u;
  }
  function f(c) {
    return c === 91 || c === 92 || c === 93 ? (e.consume(c), a++, u) : u(c);
  }
}
function C0(e, t, n) {
  const r = this, i = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []);
  let a, l = 0, o;
  return s;
  function s(m) {
    return e.enter("gfmFootnoteDefinition")._container = !0, e.enter("gfmFootnoteDefinitionLabel"), e.enter("gfmFootnoteDefinitionLabelMarker"), e.consume(m), e.exit("gfmFootnoteDefinitionLabelMarker"), u;
  }
  function u(m) {
    return m === 94 ? (e.enter("gfmFootnoteDefinitionMarker"), e.consume(m), e.exit("gfmFootnoteDefinitionMarker"), e.enter("gfmFootnoteDefinitionLabelString"), e.enter("chunkString").contentType = "string", f) : n(m);
  }
  function f(m) {
    if (
      // Too long.
      l > 999 || // Closing brace with nothing.
      m === 93 && !o || // Space or tab is not supported by GFM for some reason.
      // `\n` and `[` not being supported makes sense.
      m === null || m === 91 || X(m)
    )
      return n(m);
    if (m === 93) {
      e.exit("chunkString");
      const w = e.exit("gfmFootnoteDefinitionLabelString");
      return a = we(r.sliceSerialize(w)), e.enter("gfmFootnoteDefinitionLabelMarker"), e.consume(m), e.exit("gfmFootnoteDefinitionLabelMarker"), e.exit("gfmFootnoteDefinitionLabel"), p;
    }
    return X(m) || (o = !0), l++, e.consume(m), m === 92 ? c : f;
  }
  function c(m) {
    return m === 91 || m === 92 || m === 93 ? (e.consume(m), l++, f) : f(m);
  }
  function p(m) {
    return m === 58 ? (e.enter("definitionMarker"), e.consume(m), e.exit("definitionMarker"), i.includes(a) || i.push(a), U(e, d, "gfmFootnoteDefinitionWhitespace")) : n(m);
  }
  function d(m) {
    return t(m);
  }
}
function S0(e, t, n) {
  return e.check(Mt, t, e.attempt(k0, t, n));
}
function M0(e) {
  e.exit("gfmFootnoteDefinition");
}
function L0(e, t, n) {
  const r = this;
  return U(e, i, "gfmFootnoteDefinitionIndent", 5);
  function i(a) {
    const l = r.events[r.events.length - 1];
    return l && l[1].type === "gfmFootnoteDefinitionIndent" && l[2].sliceSerialize(l[1], !0).length === 4 ? t(a) : n(a);
  }
}
function N0(e) {
  let n = (e || {}).singleTilde;
  const r = {
    name: "strikethrough",
    tokenize: a,
    resolveAll: i
  };
  return n == null && (n = !0), {
    text: {
      126: r
    },
    insideSpan: {
      null: [r]
    },
    attentionMarkers: {
      null: [126]
    }
  };
  function i(l, o) {
    let s = -1;
    for (; ++s < l.length; )
      if (l[s][0] === "enter" && l[s][1].type === "strikethroughSequenceTemporary" && l[s][1]._close) {
        let u = s;
        for (; u--; )
          if (l[u][0] === "exit" && l[u][1].type === "strikethroughSequenceTemporary" && l[u][1]._open && // If the sizes are the same:
          l[s][1].end.offset - l[s][1].start.offset === l[u][1].end.offset - l[u][1].start.offset) {
            l[s][1].type = "strikethroughSequence", l[u][1].type = "strikethroughSequence";
            const f = {
              type: "strikethrough",
              start: Object.assign({}, l[u][1].start),
              end: Object.assign({}, l[s][1].end)
            }, c = {
              type: "strikethroughText",
              start: Object.assign({}, l[u][1].end),
              end: Object.assign({}, l[s][1].start)
            }, p = [["enter", f, o], ["enter", l[u][1], o], ["exit", l[u][1], o], ["enter", c, o]], d = o.parser.constructs.insideSpan.null;
            d && ge(p, p.length, 0, qt(d, l.slice(u + 1, s), o)), ge(p, p.length, 0, [["exit", c, o], ["enter", l[s][1], o], ["exit", l[s][1], o], ["exit", f, o]]), ge(l, u - 1, s - u + 3, p), s = u + p.length - 2;
            break;
          }
      }
    for (s = -1; ++s < l.length; )
      l[s][1].type === "strikethroughSequenceTemporary" && (l[s][1].type = "data");
    return l;
  }
  function a(l, o, s) {
    const u = this.previous, f = this.events;
    let c = 0;
    return p;
    function p(m) {
      return u === 126 && f[f.length - 1][1].type !== "characterEscape" ? s(m) : (l.enter("strikethroughSequenceTemporary"), d(m));
    }
    function d(m) {
      const w = rt(u);
      if (m === 126)
        return c > 1 ? s(m) : (l.consume(m), c++, d);
      if (c < 2 && !n) return s(m);
      const k = l.exit("strikethroughSequenceTemporary"), x = rt(m);
      return k._open = !x || x === 2 && !!w, k._close = !w || w === 2 && !!x, o(m);
    }
  }
}
class I0 {
  /**
   * Create a new edit map.
   */
  constructor() {
    this.map = [];
  }
  /**
   * Create an edit: a remove and/or add at a certain place.
   *
   * @param {number} index
   * @param {number} remove
   * @param {Array<Event>} add
   * @returns {undefined}
   */
  add(t, n, r) {
    T0(this, t, n, r);
  }
  // To do: add this when moving to `micromark`.
  // /**
  //  * Create an edit: but insert `add` before existing additions.
  //  *
  //  * @param {number} index
  //  * @param {number} remove
  //  * @param {Array<Event>} add
  //  * @returns {undefined}
  //  */
  // addBefore(index, remove, add) {
  //   addImplementation(this, index, remove, add, true)
  // }
  /**
   * Done, change the events.
   *
   * @param {Array<Event>} events
   * @returns {undefined}
   */
  consume(t) {
    if (this.map.sort(function(a, l) {
      return a[0] - l[0];
    }), this.map.length === 0)
      return;
    let n = this.map.length;
    const r = [];
    for (; n > 0; )
      n -= 1, r.push(t.slice(this.map[n][0] + this.map[n][1]), this.map[n][2]), t.length = this.map[n][0];
    r.push(t.slice()), t.length = 0;
    let i = r.pop();
    for (; i; ) {
      for (const a of i)
        t.push(a);
      i = r.pop();
    }
    this.map.length = 0;
  }
}
function T0(e, t, n, r) {
  let i = 0;
  if (!(n === 0 && r.length === 0)) {
    for (; i < e.map.length; ) {
      if (e.map[i][0] === t) {
        e.map[i][1] += n, e.map[i][2].push(...r);
        return;
      }
      i += 1;
    }
    e.map.push([t, n, r]);
  }
}
function F0(e, t) {
  let n = !1;
  const r = [];
  for (; t < e.length; ) {
    const i = e[t];
    if (n) {
      if (i[0] === "enter")
        i[1].type === "tableContent" && r.push(e[t + 1][1].type === "tableDelimiterMarker" ? "left" : "none");
      else if (i[1].type === "tableContent") {
        if (e[t - 1][1].type === "tableDelimiterMarker") {
          const a = r.length - 1;
          r[a] = r[a] === "left" ? "center" : "right";
        }
      } else if (i[1].type === "tableDelimiterRow")
        break;
    } else i[0] === "enter" && i[1].type === "tableDelimiterRow" && (n = !0);
    t += 1;
  }
  return r;
}
function z0() {
  return {
    flow: {
      null: {
        name: "table",
        tokenize: H0,
        resolveAll: P0
      }
    }
  };
}
function H0(e, t, n) {
  const r = this;
  let i = 0, a = 0, l;
  return o;
  function o(A) {
    let F = r.events.length - 1;
    for (; F > -1; ) {
      const z = r.events[F][1].type;
      if (z === "lineEnding" || // Note: markdown-rs uses `whitespace` instead of `linePrefix`
      z === "linePrefix") F--;
      else break;
    }
    const L = F > -1 ? r.events[F][1].type : null, q = L === "tableHead" || L === "tableRow" ? v : s;
    return q === v && r.parser.lazy[r.now().line] ? n(A) : q(A);
  }
  function s(A) {
    return e.enter("tableHead"), e.enter("tableRow"), u(A);
  }
  function u(A) {
    return A === 124 || (l = !0, a += 1), f(A);
  }
  function f(A) {
    return A === null ? n(A) : P(A) ? a > 1 ? (a = 0, r.interrupt = !0, e.exit("tableRow"), e.enter("lineEnding"), e.consume(A), e.exit("lineEnding"), d) : n(A) : O(A) ? U(e, f, "whitespace")(A) : (a += 1, l && (l = !1, i += 1), A === 124 ? (e.enter("tableCellDivider"), e.consume(A), e.exit("tableCellDivider"), l = !0, f) : (e.enter("data"), c(A)));
  }
  function c(A) {
    return A === null || A === 124 || X(A) ? (e.exit("data"), f(A)) : (e.consume(A), A === 92 ? p : c);
  }
  function p(A) {
    return A === 92 || A === 124 ? (e.consume(A), c) : c(A);
  }
  function d(A) {
    return r.interrupt = !1, r.parser.lazy[r.now().line] ? n(A) : (e.enter("tableDelimiterRow"), l = !1, O(A) ? U(e, m, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(A) : m(A));
  }
  function m(A) {
    return A === 45 || A === 58 ? k(A) : A === 124 ? (l = !0, e.enter("tableCellDivider"), e.consume(A), e.exit("tableCellDivider"), w) : Z(A);
  }
  function w(A) {
    return O(A) ? U(e, k, "whitespace")(A) : k(A);
  }
  function k(A) {
    return A === 58 ? (a += 1, l = !0, e.enter("tableDelimiterMarker"), e.consume(A), e.exit("tableDelimiterMarker"), x) : A === 45 ? (a += 1, x(A)) : A === null || P(A) ? H(A) : Z(A);
  }
  function x(A) {
    return A === 45 ? (e.enter("tableDelimiterFiller"), S(A)) : Z(A);
  }
  function S(A) {
    return A === 45 ? (e.consume(A), S) : A === 58 ? (l = !0, e.exit("tableDelimiterFiller"), e.enter("tableDelimiterMarker"), e.consume(A), e.exit("tableDelimiterMarker"), C) : (e.exit("tableDelimiterFiller"), C(A));
  }
  function C(A) {
    return O(A) ? U(e, H, "whitespace")(A) : H(A);
  }
  function H(A) {
    return A === 124 ? m(A) : A === null || P(A) ? !l || i !== a ? Z(A) : (e.exit("tableDelimiterRow"), e.exit("tableHead"), t(A)) : Z(A);
  }
  function Z(A) {
    return n(A);
  }
  function v(A) {
    return e.enter("tableRow"), V(A);
  }
  function V(A) {
    return A === 124 ? (e.enter("tableCellDivider"), e.consume(A), e.exit("tableCellDivider"), V) : A === null || P(A) ? (e.exit("tableRow"), t(A)) : O(A) ? U(e, V, "whitespace")(A) : (e.enter("data"), $(A));
  }
  function $(A) {
    return A === null || A === 124 || X(A) ? (e.exit("data"), V(A)) : (e.consume(A), A === 92 ? B : $);
  }
  function B(A) {
    return A === 92 || A === 124 ? (e.consume(A), $) : $(A);
  }
}
function P0(e, t) {
  let n = -1, r = !0, i = 0, a = [0, 0, 0, 0], l = [0, 0, 0, 0], o = !1, s = 0, u, f, c;
  const p = new I0();
  for (; ++n < e.length; ) {
    const d = e[n], m = d[1];
    d[0] === "enter" ? m.type === "tableHead" ? (o = !1, s !== 0 && (li(p, t, s, u, f), f = void 0, s = 0), u = {
      type: "table",
      start: Object.assign({}, m.start),
      // Note: correct end is set later.
      end: Object.assign({}, m.end)
    }, p.add(n, 0, [["enter", u, t]])) : m.type === "tableRow" || m.type === "tableDelimiterRow" ? (r = !0, c = void 0, a = [0, 0, 0, 0], l = [0, n + 1, 0, 0], o && (o = !1, f = {
      type: "tableBody",
      start: Object.assign({}, m.start),
      // Note: correct end is set later.
      end: Object.assign({}, m.end)
    }, p.add(n, 0, [["enter", f, t]])), i = m.type === "tableDelimiterRow" ? 2 : f ? 3 : 1) : i && (m.type === "data" || m.type === "tableDelimiterMarker" || m.type === "tableDelimiterFiller") ? (r = !1, l[2] === 0 && (a[1] !== 0 && (l[0] = l[1], c = zt(p, t, a, i, void 0, c), a = [0, 0, 0, 0]), l[2] = n)) : m.type === "tableCellDivider" && (r ? r = !1 : (a[1] !== 0 && (l[0] = l[1], c = zt(p, t, a, i, void 0, c)), a = l, l = [a[1], n, 0, 0])) : m.type === "tableHead" ? (o = !0, s = n) : m.type === "tableRow" || m.type === "tableDelimiterRow" ? (s = n, a[1] !== 0 ? (l[0] = l[1], c = zt(p, t, a, i, n, c)) : l[1] !== 0 && (c = zt(p, t, l, i, n, c)), i = 0) : i && (m.type === "data" || m.type === "tableDelimiterMarker" || m.type === "tableDelimiterFiller") && (l[3] = n);
  }
  for (s !== 0 && li(p, t, s, u, f), p.consume(t.events), n = -1; ++n < t.events.length; ) {
    const d = t.events[n];
    d[0] === "enter" && d[1].type === "table" && (d[1]._align = F0(t.events, n));
  }
  return e;
}
function zt(e, t, n, r, i, a) {
  const l = r === 1 ? "tableHeader" : r === 2 ? "tableDelimiter" : "tableData", o = "tableContent";
  n[0] !== 0 && (a.end = Object.assign({}, Je(t.events, n[0])), e.add(n[0], 0, [["exit", a, t]]));
  const s = Je(t.events, n[1]);
  if (a = {
    type: l,
    start: Object.assign({}, s),
    // Note: correct end is set later.
    end: Object.assign({}, s)
  }, e.add(n[1], 0, [["enter", a, t]]), n[2] !== 0) {
    const u = Je(t.events, n[2]), f = Je(t.events, n[3]), c = {
      type: o,
      start: Object.assign({}, u),
      end: Object.assign({}, f)
    };
    if (e.add(n[2], 0, [["enter", c, t]]), r !== 2) {
      const p = t.events[n[2]], d = t.events[n[3]];
      if (p[1].end = Object.assign({}, d[1].end), p[1].type = "chunkText", p[1].contentType = "text", n[3] > n[2] + 1) {
        const m = n[2] + 1, w = n[3] - n[2] - 1;
        e.add(m, w, []);
      }
    }
    e.add(n[3] + 1, 0, [["exit", c, t]]);
  }
  return i !== void 0 && (a.end = Object.assign({}, Je(t.events, i)), e.add(i, 0, [["exit", a, t]]), a = void 0), a;
}
function li(e, t, n, r, i) {
  const a = [], l = Je(t.events, n);
  i && (i.end = Object.assign({}, l), a.push(["exit", i, t])), r.end = Object.assign({}, l), a.push(["exit", r, t]), e.add(n + 1, 0, a);
}
function Je(e, t) {
  const n = e[t], r = n[0] === "enter" ? "start" : "end";
  return n[1][r];
}
const Z0 = {
  name: "tasklistCheck",
  tokenize: R0
};
function D0() {
  return {
    text: {
      91: Z0
    }
  };
}
function R0(e, t, n) {
  const r = this;
  return i;
  function i(s) {
    return (
      // Exit if there’s stuff before.
      r.previous !== null || // Exit if not in the first content that is the first child of a list
      // item.
      !r._gfmTasklistFirstContentOfListItem ? n(s) : (e.enter("taskListCheck"), e.enter("taskListCheckMarker"), e.consume(s), e.exit("taskListCheckMarker"), a)
    );
  }
  function a(s) {
    return X(s) ? (e.enter("taskListCheckValueUnchecked"), e.consume(s), e.exit("taskListCheckValueUnchecked"), l) : s === 88 || s === 120 ? (e.enter("taskListCheckValueChecked"), e.consume(s), e.exit("taskListCheckValueChecked"), l) : n(s);
  }
  function l(s) {
    return s === 93 ? (e.enter("taskListCheckMarker"), e.consume(s), e.exit("taskListCheckMarker"), e.exit("taskListCheck"), o) : n(s);
  }
  function o(s) {
    return P(s) ? t(s) : O(s) ? e.check({
      tokenize: _0
    }, t, n)(s) : n(s);
  }
}
function _0(e, t, n) {
  return U(e, r, "whitespace");
  function r(i) {
    return i === null ? n(i) : t(i);
  }
}
function V0(e) {
  return Di([
    f0(),
    w0(),
    N0(e),
    z0(),
    D0()
  ]);
}
const O0 = {};
function B0(e) {
  const t = (
    /** @type {Processor<Root>} */
    this
  ), n = e || O0, r = t.data(), i = r.micromarkExtensions || (r.micromarkExtensions = []), a = r.fromMarkdownExtensions || (r.fromMarkdownExtensions = []), l = r.toMarkdownExtensions || (r.toMarkdownExtensions = []);
  i.push(V0(n)), a.push(o0()), l.push(s0(n));
}
function j0({
  href: e,
  children: t,
  node: n,
  ...r
}) {
  const i = typeof e == "string" && /^https?:\/\//i.test(e);
  return /* @__PURE__ */ b(
    "a",
    {
      href: e,
      ...i ? { target: "_blank", rel: "noreferrer noopener" } : {},
      ...r,
      children: t
    }
  );
}
const ai = {
  a: j0
};
function $0({ value: e, size: t = "base", className: n, components: r }) {
  const i = ["notis-markdown", t === "sm" ? "notis-markdown--sm" : null, n].filter(Boolean).join(" ");
  return /* @__PURE__ */ b("div", { className: i, children: /* @__PURE__ */ b(
    N1,
    {
      remarkPlugins: [B0],
      components: r ? { ...ai, ...r } : ai,
      children: e
    }
  ) });
}
const U0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M232,44H160a43.86,43.86,0,0,0-32,13.85A43.86,43.86,0,0,0,96,44H24A12,12,0,0,0,12,56V200a12,12,0,0,0,12,12H96a20,20,0,0,1,20,20,12,12,0,0,0,24,0,20,20,0,0,1,20-20h72a12,12,0,0,0,12-12V56A12,12,0,0,0,232,44ZM96,188H36V68H96a20,20,0,0,1,20,20V192.81A43.79,43.79,0,0,0,96,188Zm124,0H160a43.71,43.71,0,0,0-20,4.83V88a20,20,0,0,1,20-20h60ZM164,96h32a12,12,0,0,1,0,24H164a12,12,0,0,1,0-24Zm44,52a12,12,0,0,1-12,12H164a12,12,0,0,1,0-24h32A12,12,0,0,1,208,148Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M232,56V200H160a32,32,0,0,0-32,32V88a32,32,0,0,1,32-32Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64ZM160,88h40a8,8,0,0,1,0,16H160a8,8,0,0,1,0-16Zm48,40a8,8,0,0,1-8,8H160a8,8,0,0,1,0-16h40A8,8,0,0,1,208,128Zm0,32a8,8,0,0,1-8,8H160a8,8,0,0,1,0-16h40A8,8,0,0,1,208,160Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M232,48H168a32,32,0,0,0-32,32v87.73a8.17,8.17,0,0,1-7.47,8.25,8,8,0,0,1-8.53-8V80A32,32,0,0,0,88,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,23.94,7.9,7.9,0,0,0,5.12,7.55A8,8,0,0,0,136,232a24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM208,168H168.27a8.17,8.17,0,0,1-8.25-7.47,8,8,0,0,1,8-8.53h39.73a8.17,8.17,0,0,1,8.25,7.47A8,8,0,0,1,208,168Zm0-32H168.27a8.17,8.17,0,0,1-8.25-7.47,8,8,0,0,1,8-8.53h39.73a8.17,8.17,0,0,1,8.25,7.47A8,8,0,0,1,208,136Zm0-32H168.27A8.17,8.17,0,0,1,160,96.53,8,8,0,0,1,168,88h39.73A8.17,8.17,0,0,1,216,95.47,8,8,0,0,1,208,104Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M232,50H160a38,38,0,0,0-32,17.55A38,38,0,0,0,96,50H24a6,6,0,0,0-6,6V200a6,6,0,0,0,6,6H96a26,26,0,0,1,26,26,6,6,0,0,0,12,0,26,26,0,0,1,26-26h72a6,6,0,0,0,6-6V56A6,6,0,0,0,232,50ZM96,194H30V62H96a26,26,0,0,1,26,26V204.31A37.86,37.86,0,0,0,96,194Zm130,0H160a37.87,37.87,0,0,0-26,10.32V88a26,26,0,0,1,26-26h66ZM160,90h40a6,6,0,0,1,0,12H160a6,6,0,0,1,0-12Zm46,38a6,6,0,0,1-6,6H160a6,6,0,0,1,0-12h40A6,6,0,0,1,206,128Zm0,32a6,6,0,0,1-6,6H160a6,6,0,0,1,0-12h40A6,6,0,0,1,206,160Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64ZM160,88h40a8,8,0,0,1,0,16H160a8,8,0,0,1,0-16Zm48,40a8,8,0,0,1-8,8H160a8,8,0,0,1,0-16h40A8,8,0,0,1,208,128Zm0,32a8,8,0,0,1-8,8H160a8,8,0,0,1,0-16h40A8,8,0,0,1,208,160Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M232,52H160a36,36,0,0,0-32,19.54A36,36,0,0,0,96,52H24a4,4,0,0,0-4,4V200a4,4,0,0,0,4,4H96a28,28,0,0,1,28,28,4,4,0,0,0,8,0,28,28,0,0,1,28-28h72a4,4,0,0,0,4-4V56A4,4,0,0,0,232,52ZM96,196H28V60H96a28,28,0,0,1,28,28V209.4A35.94,35.94,0,0,0,96,196Zm132,0H160a35.94,35.94,0,0,0-28,13.41V88a28,28,0,0,1,28-28h68ZM160,92h40a4,4,0,0,1,0,8H160a4,4,0,0,1,0-8Zm44,36a4,4,0,0,1-4,4H160a4,4,0,0,1,0-8h40A4,4,0,0,1,204,128Zm0,32a4,4,0,0,1-4,4H160a4,4,0,0,1,0-8h40A4,4,0,0,1,204,160Z" }))
  ]
]), W0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M208,96l-80,80L48,96Z", opacity: "0.2" }), /* @__PURE__ */ h.createElement("path", { d: "M215.39,92.94A8,8,0,0,0,208,88H48a8,8,0,0,0-5.66,13.66l80,80a8,8,0,0,0,11.32,0l80-80A8,8,0,0,0,215.39,92.94ZM128,164.69,67.31,104H188.69Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,48,88H208a8,8,0,0,1,5.66,13.66Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M212.24,100.24l-80,80a6,6,0,0,1-8.48,0l-80-80a6,6,0,0,1,8.48-8.48L128,167.51l75.76-75.75a6,6,0,0,1,8.48,8.48Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M210.83,98.83l-80,80a4,4,0,0,1-5.66,0l-80-80a4,4,0,0,1,5.66-5.66L128,170.34l77.17-77.17a4,4,0,1,1,5.66,5.66Z" }))
  ]
]), q0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M216.49,168.49a12,12,0,0,1-17,0L128,97,56.49,168.49a12,12,0,0,1-17-17l80-80a12,12,0,0,1,17,0l80,80A12,12,0,0,1,216.49,168.49Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M208,160H48l80-80Z", opacity: "0.2" }), /* @__PURE__ */ h.createElement("path", { d: "M213.66,154.34l-80-80a8,8,0,0,0-11.32,0l-80,80A8,8,0,0,0,48,168H208a8,8,0,0,0,5.66-13.66ZM67.31,152,128,91.31,188.69,152Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M215.39,163.06A8,8,0,0,1,208,168H48a8,8,0,0,1-5.66-13.66l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,215.39,163.06Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M212.24,164.24a6,6,0,0,1-8.48,0L128,88.49,52.24,164.24a6,6,0,0,1-8.48-8.48l80-80a6,6,0,0,1,8.48,0l80,80A6,6,0,0,1,212.24,164.24Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M210.83,162.83a4,4,0,0,1-5.66,0L128,85.66,50.83,162.83a4,4,0,0,1-5.66-5.66l80-80a4,4,0,0,1,5.66,0l80,80A4,4,0,0,1,210.83,162.83Z" }))
  ]
]), G0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M236,208a12,12,0,0,1-12,12H32a12,12,0,0,1-12-12V48a12,12,0,0,1,24,0v99l43.51-43.52a12,12,0,0,1,17,0L128,127l43-43H160a12,12,0,0,1,0-24h40a12,12,0,0,1,12,12v40a12,12,0,0,1-24,0V101l-51.51,51.52a12,12,0,0,1-17,0L96,129,44,181v15H224A12,12,0,0,1,236,208Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M224,64V208H32V48H208A16,16,0,0,1,224,64Z", opacity: "0.2" }), /* @__PURE__ */ h.createElement("path", { d: "M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0V156.69l50.34-50.35a8,8,0,0,1,11.32,0L128,132.69,180.69,80H160a8,8,0,0,1,0-16h40a8,8,0,0,1,8,8v40a8,8,0,0,1-16,0V91.31l-58.34,58.35a8,8,0,0,1-11.32,0L96,123.31l-56,56V200H224A8,8,0,0,1,232,208Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM200,192H56a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v76.69l34.34-34.35a8,8,0,0,1,11.32,0L128,132.69,172.69,88H144a8,8,0,0,1,0-16h48a8,8,0,0,1,8,8v48a8,8,0,0,1-16,0V99.31l-50.34,50.35a8,8,0,0,1-11.32,0L104,131.31l-40,40V176H200a8,8,0,0,1,0,16Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M230,208a6,6,0,0,1-6,6H32a6,6,0,0,1-6-6V48a6,6,0,0,1,12,0V161.52l53.76-53.76a6,6,0,0,1,8.48,0L128,135.51,185.52,78H160a6,6,0,0,1,0-12h40a6,6,0,0,1,6,6v40a6,6,0,0,1-12,0V86.48l-61.76,61.76a6,6,0,0,1-8.48,0L96,120.49l-58,58V202H224A6,6,0,0,1,230,208Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0V156.69l50.34-50.35a8,8,0,0,1,11.32,0L128,132.69,180.69,80H160a8,8,0,0,1,0-16h40a8,8,0,0,1,8,8v40a8,8,0,0,1-16,0V91.31l-58.34,58.35a8,8,0,0,1-11.32,0L96,123.31l-56,56V200H224A8,8,0,0,1,232,208Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M228,208a4,4,0,0,1-4,4H32a4,4,0,0,1-4-4V48a4,4,0,0,1,8,0V166.34l57.17-57.17a4,4,0,0,1,5.66,0L128,138.34,190.34,76H160a4,4,0,0,1,0-8h40a4,4,0,0,1,4,4v40a4,4,0,0,1-8,0V81.66l-65.17,65.17a4,4,0,0,1-5.66,0L96,117.66l-60,60V204H224A4,4,0,0,1,228,208Z" }))
  ]
]), Y0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M120,128a16,16,0,1,1-16-16A16,16,0,0,1,120,128Zm32-16a16,16,0,1,0,16,16A16,16,0,0,0,152,112Zm84,16A108,108,0,0,1,78.77,224.15L46.34,235A20,20,0,0,1,21,209.66l10.81-32.43A108,108,0,1,1,236,128Zm-24,0A84,84,0,1,0,55.27,170.06a12,12,0,0,1,1,9.81l-9.93,29.79,29.79-9.93a12.1,12.1,0,0,1,3.8-.62,12,12,0,0,1,6,1.62A84,84,0,0,0,212,128Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M224,128A96,96,0,0,1,79.93,211.11h0L42.54,223.58a8,8,0,0,1-10.12-10.12l12.47-37.39h0A96,96,0,1,1,224,128Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-4-1.08,7.85,7.85,0,0,0-2.53.42L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Zm12-88a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm-44,0a12,12,0,1,1-12-12A12,12,0,0,1,96,128Zm88,0a12,12,0,1,1-12-12A12,12,0,0,1,184,128Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24ZM84,140a12,12,0,1,1,12-12A12,12,0,0,1,84,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,128,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,172,140Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M138,128a10,10,0,1,1-10-10A10,10,0,0,1,138,128ZM84,118a10,10,0,1,0,10,10A10,10,0,0,0,84,118Zm88,0a10,10,0,1,0,10,10A10,10,0,0,0,172,118Zm58,10A102,102,0,0,1,79.31,217.65L44.44,229.27a14,14,0,0,1-17.71-17.71l11.62-34.87A102,102,0,1,1,230,128Zm-12,0A90,90,0,1,0,50.08,173.06a6,6,0,0,1,.5,4.91L38.12,215.35a2,2,0,0,0,2.53,2.53L78,205.42a6.2,6.2,0,0,1,1.9-.31,6.09,6.09,0,0,1,3,.81A90,90,0,0,0,218,128Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128ZM84,116a12,12,0,1,0,12,12A12,12,0,0,0,84,116Zm88,0a12,12,0,1,0,12,12A12,12,0,0,0,172,116Zm60,12A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Zm-16,0A88,88,0,1,0,51.81,172.06a8,8,0,0,1,.66,6.54L40,216,77.4,203.53a7.85,7.85,0,0,1,2.53-.42,8,8,0,0,1,4,1.08A88,88,0,0,0,216,128Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M136,128a8,8,0,1,1-8-8A8,8,0,0,1,136,128Zm-52-8a8,8,0,1,0,8,8A8,8,0,0,0,84,120Zm88,0a8,8,0,1,0,8,8A8,8,0,0,0,172,120Zm56,8A100,100,0,0,1,79.5,215.47l-35.69,11.9a12,12,0,0,1-15.18-15.18l11.9-35.69A100,100,0,1,1,228,128Zm-8,0A92,92,0,1,0,48.35,174.07a4,4,0,0,1,.33,3.27L36.22,214.72a4,4,0,0,0,5.06,5.06l37.38-12.46a3.93,3.93,0,0,1,1.27-.21,4.05,4.05,0,0,1,2,.54A92,92,0,0,0,220,128Z" }))
  ]
]), X0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M236,128a108,108,0,0,1-216,0c0-42.52,24.73-81.34,63-98.9A12,12,0,1,1,93,50.91C63.24,64.57,44,94.83,44,128a84,84,0,0,0,168,0c0-33.17-19.24-63.43-49-77.09A12,12,0,1,1,173,29.1C211.27,46.66,236,85.48,236,128Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ h.createElement("path", { d: "M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,176A72,72,0,0,1,92,65.64a8,8,0,0,1,8,13.85,56,56,0,1,0,56,0,8,8,0,0,1,8-13.85A72,72,0,0,1,128,200Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M230,128a102,102,0,0,1-204,0c0-40.18,23.35-76.86,59.5-93.45a6,6,0,0,1,5,10.9C58.61,60.09,38,92.49,38,128a90,90,0,0,0,180,0c0-35.51-20.61-67.91-52.5-82.55a6,6,0,0,1,5-10.9C206.65,51.14,230,87.82,230,128Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M228,128a100,100,0,0,1-200,0c0-39.4,22.9-75.37,58.33-91.63a4,4,0,1,1,3.34,7.27C57.07,58.6,36,91.71,36,128a92,92,0,0,0,184,0c0-36.29-21.07-69.4-53.67-84.36a4,4,0,1,1,3.34-7.27C205.1,52.63,228,88.6,228,128Z" }))
  ]
]), Q0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M176.69,48.72a225,225,0,0,0-42.52-35,12,12,0,0,0-12.34,0,225,225,0,0,0-42.52,35C51,78.47,36,111.42,36,144a92,92,0,0,0,184,0C220,111.42,205,78.47,176.69,48.72ZM100,184c0-13.33,5.53-26.26,16.45-38.45A93,93,0,0,1,128,134.72a93,93,0,0,1,11.55,10.83C150.47,157.74,156,170.67,156,184a28,28,0,0,1-56,0Zm79.84,3.94c.09-1.3.16-2.61.16-3.94,0-46.26-44-73.17-45.83-74.29a12,12,0,0,0-12.34,0C120,110.83,76,137.74,76,184c0,1.33.07,2.64.16,3.94A67.68,67.68,0,0,1,60,144c0-26.52,12.21-52.86,36.28-78.3A213.07,213.07,0,0,1,128,38.39C145.82,50.86,196,90.71,196,144A67.68,67.68,0,0,1,179.84,187.94Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M208,144A80,80,0,0,1,130.06,224,40,40,0,0,0,168,184c0-40-40-64-40-64s-40,24-40,64A40,40,0,0,0,125.94,224,80,80,0,0,1,48,144c0-72,80-120,80-120S208,72,208,144Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M173.79,51.48a221.25,221.25,0,0,0-41.67-34.34,8,8,0,0,0-8.24,0A221.25,221.25,0,0,0,82.21,51.48C54.59,80.48,40,112.47,40,144a88,88,0,0,0,176,0C216,112.47,201.41,80.48,173.79,51.48ZM96,184c0-27.67,22.53-47.28,32-54.3,9.48,7,32,26.63,32,54.3a32,32,0,0,1-64,0Zm77.27,15.93A47.8,47.8,0,0,0,176,184c0-44-42.09-69.79-43.88-70.86a8,8,0,0,0-8.24,0C122.09,114.21,80,140,80,184a47.8,47.8,0,0,0,2.73,15.93A71.88,71.88,0,0,1,56,144c0-34.41,20.4-63.15,37.52-81.19A216.21,216.21,0,0,1,128,33.54a215.77,215.77,0,0,1,34.48,29.27C193.49,95.5,200,125,200,144A71.88,71.88,0,0,1,173.27,199.93Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M173.79,51.48a221.25,221.25,0,0,0-41.67-34.34,8,8,0,0,0-8.24,0A221.25,221.25,0,0,0,82.21,51.48C54.59,80.48,40,112.47,40,144a88,88,0,0,0,176,0C216,112.47,201.41,80.48,173.79,51.48ZM96,184c0-27.67,22.53-47.28,32-54.3,9.48,7,32,26.63,32,54.3a32,32,0,0,1-64,0Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M172.34,52.86a218.34,218.34,0,0,0-41.25-34,6,6,0,0,0-6.18,0,218.34,218.34,0,0,0-41.25,34C56.4,81.48,42,113,42,144a86,86,0,0,0,172,0C214,113,199.6,81.48,172.34,52.86ZM94,184c0-29.8,25.11-50.41,34-56.78,8.91,6.35,34,26.87,34,56.78a34.05,34.05,0,0,1-32.25,34c-.59,0-1.16,0-1.75,0s-1.16,0-1.75,0A34.05,34.05,0,0,1,94,184Zm74.42,21.94A45.68,45.68,0,0,0,174,184c0-42.9-41.16-68.09-42.91-69.14a6,6,0,0,0-6.18,0C123.16,115.91,82,141.1,82,184a45.68,45.68,0,0,0,5.58,21.94A74,74,0,0,1,54,144c0-59.83,59.62-103.26,74-112.86,14.39,9.6,74,53,74,112.86A74,74,0,0,1,168.42,205.94Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M173.79,51.48a221.25,221.25,0,0,0-41.67-34.34,8,8,0,0,0-8.24,0A221.25,221.25,0,0,0,82.21,51.48C54.59,80.48,40,112.47,40,144a88,88,0,0,0,176,0C216,112.47,201.41,80.48,173.79,51.48ZM96,184c0-27.67,22.53-47.28,32-54.3,9.48,7,32,26.63,32,54.3a32,32,0,0,1-64,0Zm77.27,15.93A47.8,47.8,0,0,0,176,184c0-44-42.09-69.79-43.88-70.86a8,8,0,0,0-8.24,0C122.09,114.21,80,140,80,184a47.8,47.8,0,0,0,2.73,15.93A71.88,71.88,0,0,1,56,144c0-34.41,20.4-63.15,37.52-81.19A216.21,216.21,0,0,1,128,33.54a215.77,215.77,0,0,1,34.48,29.27C193.49,95.5,200,125,200,144A71.88,71.88,0,0,1,173.27,199.93Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M170.9,54.24a216.79,216.79,0,0,0-40.84-33.67,4,4,0,0,0-4.12,0A216.79,216.79,0,0,0,85.1,54.24C58.21,82.48,44,113.51,44,144a84,84,0,0,0,168,0C212,113.51,197.79,82.48,170.9,54.24ZM92,184c0-32.11,28.07-53.75,36-59.21,7.93,5.47,36,27.1,36,59.21a36,36,0,0,1-72,0Zm69.94,28A43.82,43.82,0,0,0,172,184c0-41.78-40.23-66.4-41.94-67.43a4,4,0,0,0-4.12,0C124.23,117.6,84,142.22,84,184a43.82,43.82,0,0,0,10.06,28A76.07,76.07,0,0,1,52,144c0-62.48,63.64-107.17,76-115.26,12.36,8.09,76,52.78,76,115.26A76.07,76.07,0,0,1,161.94,212Z" }))
  ]
]), J0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M180,232a12,12,0,0,1-12,12H88a12,12,0,0,1,0-24h80A12,12,0,0,1,180,232Zm40-128a91.51,91.51,0,0,1-35.17,72.35A12.26,12.26,0,0,0,180,186v2a20,20,0,0,1-20,20H96a20,20,0,0,1-20-20v-2a12,12,0,0,0-4.7-9.51A91.57,91.57,0,0,1,36,104.52C35.73,54.69,76,13.2,125.79,12A92,92,0,0,1,220,104Zm-24,0a68,68,0,0,0-69.65-68C89.56,36.88,59.8,67.55,60,104.38a67.71,67.71,0,0,0,26.1,53.19A35.87,35.87,0,0,1,100,184h56.1A36.13,36.13,0,0,1,170,157.49,67.68,67.68,0,0,0,196,104Zm-20.07-5.32a48.5,48.5,0,0,0-31.91-40,12,12,0,0,0-8,22.62,24.31,24.31,0,0,1,16.09,20,12,12,0,0,0,23.86-2.64Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M208,104a79.86,79.86,0,0,1-30.59,62.92A24.29,24.29,0,0,0,168,186v6a8,8,0,0,1-8,8H96a8,8,0,0,1-8-8v-6a24.11,24.11,0,0,0-9.3-19A79.87,79.87,0,0,1,48,104.45C47.76,61.09,82.72,25,126.07,24A80,80,0,0,1,208,104Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Zm-16.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-32.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M174,232a6,6,0,0,1-6,6H88a6,6,0,0,1,0-12h80A6,6,0,0,1,174,232Zm40-128a85.56,85.56,0,0,1-32.88,67.64A18.23,18.23,0,0,0,174,186v6a14,14,0,0,1-14,14H96a14,14,0,0,1-14-14v-6a18,18,0,0,0-7-14.23h0a85.59,85.59,0,0,1-33-67.24C41.74,57.91,79.39,19.12,125.93,18A86,86,0,0,1,214,104Zm-12,0a74,74,0,0,0-75.79-74C86.17,31,53.78,64.34,54,104.42a73.67,73.67,0,0,0,28.4,57.87A29.92,29.92,0,0,1,94,186v6a2,2,0,0,0,2,2h64a2,2,0,0,0,2-2v-6a30.18,30.18,0,0,1,11.7-23.78A73.59,73.59,0,0,0,202,104Zm-20.08-9A55.58,55.58,0,0,0,137,50.08a6,6,0,1,0-2,11.84C152.38,64.84,167.13,79.6,170.08,97a6,6,0,0,0,5.91,5,6.87,6.87,0,0,0,1-.08A6,6,0,0,0,181.92,95Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Zm-16.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M172,232a4,4,0,0,1-4,4H88a4,4,0,0,1,0-8h80A4,4,0,0,1,172,232Zm40-128a83.59,83.59,0,0,1-32.11,66.06A20.2,20.2,0,0,0,172,186v6a12,12,0,0,1-12,12H96a12,12,0,0,1-12-12v-6a20,20,0,0,0-7.76-15.81A83.58,83.58,0,0,1,44,104.47C43.75,59,80.52,21.09,126,20a84,84,0,0,1,86,84Zm-8,0a76,76,0,0,0-77.83-76C85,29,51.77,63.27,52,104.43a75.62,75.62,0,0,0,29.17,59.43A28,28,0,0,1,92,186v6a4,4,0,0,0,4,4h64a4,4,0,0,0,4-4v-6a28.14,28.14,0,0,1,10.94-22.2A75.62,75.62,0,0,0,204,104ZM136.66,52.06a4,4,0,0,0-1.32,7.88C153.53,63,169,78.45,172.06,96.67A4,4,0,0,0,176,100a3.88,3.88,0,0,0,.67-.06,4,4,0,0,0,3.27-4.61A53.51,53.51,0,0,0,136.66,52.06Z" }))
  ]
]), K0 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M219.71,117.38a12,12,0,0,0-7.25-8.52L161.28,88.39l10.59-70.61a12,12,0,0,0-20.64-10l-112,120a12,12,0,0,0,4.31,19.33l51.18,20.47L84.13,238.22a12,12,0,0,0,20.64,10l112-120A12,12,0,0,0,219.71,117.38ZM113.6,203.55l6.27-41.77a12,12,0,0,0-7.41-12.92L68.74,131.37,142.4,52.45l-6.27,41.77a12,12,0,0,0,7.41,12.92l43.72,17.49Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M96,240l16-80L48,136,160,16,144,96l64,24Z", opacity: "0.2" }), /* @__PURE__ */ h.createElement("path", { d: "M215.79,118.17a8,8,0,0,0-5-5.66L153.18,90.9l14.66-73.33a8,8,0,0,0-13.69-7l-112,120a8,8,0,0,0,3,13l57.63,21.61L88.16,238.43a8,8,0,0,0,13.69,7l112-120A8,8,0,0,0,215.79,118.17ZM109.37,214l10.47-52.38a8,8,0,0,0-5-9.06L62,132.71l84.62-90.66L136.16,94.43a8,8,0,0,0,5,9.06l52.8,19.8Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M213.85,125.46l-112,120a8,8,0,0,1-13.69-7l14.66-73.33L45.19,143.49a8,8,0,0,1-3-13l112-120a8,8,0,0,1,13.69,7L153.18,90.9l57.63,21.61a8,8,0,0,1,3,12.95Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M213.84,118.63a6,6,0,0,0-3.73-4.25L150.88,92.17l15-75a6,6,0,0,0-10.27-5.27l-112,120a6,6,0,0,0,2.28,9.71l59.23,22.21-15,75a6,6,0,0,0,3.14,6.52A6.07,6.07,0,0,0,96,246a6,6,0,0,0,4.39-1.91l112-120A6,6,0,0,0,213.84,118.63ZM106,220.46l11.85-59.28a6,6,0,0,0-3.77-6.8l-55.6-20.85,91.46-98L138.12,94.82a6,6,0,0,0,3.77,6.8l55.6,20.85Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M215.79,118.17a8,8,0,0,0-5-5.66L153.18,90.9l14.66-73.33a8,8,0,0,0-13.69-7l-112,120a8,8,0,0,0,3,13l57.63,21.61L88.16,238.43a8,8,0,0,0,13.69,7l112-120A8,8,0,0,0,215.79,118.17ZM109.37,214l10.47-52.38a8,8,0,0,0-5-9.06L62,132.71l84.62-90.66L136.16,94.43a8,8,0,0,0,5,9.06l52.8,19.8Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M211.89,119.09a4,4,0,0,0-2.49-2.84l-60.81-22.8,15.33-76.67a4,4,0,0,0-6.84-3.51l-112,120a4,4,0,0,0-1,3.64,4,4,0,0,0,2.49,2.84l60.81,22.8L92.08,239.22a4,4,0,0,0,6.84,3.51l112-120A4,4,0,0,0,211.89,119.09ZM102.68,227l13.24-66.2a4,4,0,0,0-2.52-4.53L55,134.36,153.32,29l-13.24,66.2a4,4,0,0,0,2.52,4.53L201,121.64Z" }))
  ]
]), e2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M244,96a12,12,0,0,1-12,12H220v12a12,12,0,0,1-24,0V108H184a12,12,0,0,1,0-24h12V72a12,12,0,0,1,24,0V84h12A12,12,0,0,1,244,96ZM144,60h4v4a12,12,0,0,0,24,0V60h4a12,12,0,0,0,0-24h-4V32a12,12,0,0,0-24,0v4h-4a12,12,0,0,0,0,24Zm75.81,90.38A12,12,0,0,1,222,162.3,100,100,0,1,1,93.7,34a12,12,0,0,1,15.89,13.6A85.12,85.12,0,0,0,108,64a84.09,84.09,0,0,0,84,84,85.22,85.22,0,0,0,16.37-1.59A12,12,0,0,1,219.81,150.38ZM190,172A108.13,108.13,0,0,1,84,66,76,76,0,1,0,190,172Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M210.69,158.18A88,88,0,1,1,97.82,45.31,96.08,96.08,0,0,0,192,160,96.78,96.78,0,0,0,210.69,158.18Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M240,96a8,8,0,0,1-8,8H216v16a8,8,0,0,1-16,0V104H184a8,8,0,0,1,0-16h16V72a8,8,0,0,1,16,0V88h16A8,8,0,0,1,240,96ZM144,56h8v8a8,8,0,0,0,16,0V56h8a8,8,0,0,0,0-16h-8V32a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16Zm72.77,97a8,8,0,0,1,1.43,8A96,96,0,1,1,95.07,37.8a8,8,0,0,1,10.6,9.06A88.07,88.07,0,0,0,209.14,150.33,8,8,0,0,1,216.77,153Zm-19.39,14.88c-1.79.09-3.59.14-5.38.14A104.11,104.11,0,0,1,88,64c0-1.79,0-3.59.14-5.38A80,80,0,1,0,197.38,167.86Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M240,96a8,8,0,0,1-8,8H216v16a8,8,0,0,1-16,0V104H184a8,8,0,0,1,0-16h16V72a8,8,0,0,1,16,0V88h16A8,8,0,0,1,240,96ZM144,56h8v8a8,8,0,0,0,16,0V56h8a8,8,0,0,0,0-16h-8V32a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16Zm65.14,94.33A88.07,88.07,0,0,1,105.67,46.86a8,8,0,0,0-10.6-9.06A96,96,0,1,0,218.2,160.93a8,8,0,0,0-9.06-10.6Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M238,96a6,6,0,0,1-6,6H214v18a6,6,0,0,1-12,0V102H184a6,6,0,0,1,0-12h18V72a6,6,0,0,1,12,0V90h18A6,6,0,0,1,238,96ZM144,54h10V64a6,6,0,0,0,12,0V54h10a6,6,0,0,0,0-12H166V32a6,6,0,0,0-12,0V42H144a6,6,0,0,0,0,12Zm71.25,100.28a6,6,0,0,1,1.07,6A94,94,0,1,1,95.76,39.68a6,6,0,0,1,7.94,6.79A90.11,90.11,0,0,0,192,154a90.9,90.9,0,0,0,17.53-1.7A6,6,0,0,1,215.25,154.28Zm-14.37,11.34q-4.42.38-8.88.38A102.12,102.12,0,0,1,90,64q0-4.45.38-8.88a82,82,0,1,0,110.5,110.5Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M240,96a8,8,0,0,1-8,8H216v16a8,8,0,0,1-16,0V104H184a8,8,0,0,1,0-16h16V72a8,8,0,0,1,16,0V88h16A8,8,0,0,1,240,96ZM144,56h8v8a8,8,0,0,0,16,0V56h8a8,8,0,0,0,0-16h-8V32a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16Zm72.77,97a8,8,0,0,1,1.43,8A96,96,0,1,1,95.07,37.8a8,8,0,0,1,10.6,9.06A88.07,88.07,0,0,0,209.14,150.33,8,8,0,0,1,216.77,153Zm-19.39,14.88c-1.79.09-3.59.14-5.38.14A104.11,104.11,0,0,1,88,64c0-1.79,0-3.59.14-5.38A80,80,0,1,0,197.38,167.86Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M236,96a4,4,0,0,1-4,4H212v20a4,4,0,0,1-8,0V100H184a4,4,0,0,1,0-8h20V72a4,4,0,0,1,8,0V92h20A4,4,0,0,1,236,96ZM144,52h12V64a4,4,0,0,0,8,0V52h12a4,4,0,0,0,0-8H164V32a4,4,0,0,0-8,0V44H144a4,4,0,0,0,0,8Zm69.73,103.58a4,4,0,0,1,.71,4,92,92,0,1,1-118-118,4,4,0,0,1,5.29,4.54A93.18,93.18,0,0,0,100,64a92.1,92.1,0,0,0,92,92,93.18,93.18,0,0,0,17.91-1.74A4,4,0,0,1,213.73,155.58Zm-9.46,7.67A100,100,0,0,1,92.75,51.73,84,84,0,1,0,204.27,163.25Z" }))
  ]
]), t2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M108,108a12,12,0,0,1,12-12h56a12,12,0,0,1,0,24H120A12,12,0,0,1,108,108Zm68,28H120a12,12,0,0,0,0,24h56a12,12,0,0,0,0-24Zm52-88V208a20,20,0,0,1-20,20H48a20,20,0,0,1-20-20V48A20,20,0,0,1,48,28H208A20,20,0,0,1,228,48ZM52,204H68V52H52ZM204,52H92V204H204Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M80,40V216H48a8,8,0,0,1-8-8V48a8,8,0,0,1,8-8Z", opacity: "0.2" }), /* @__PURE__ */ h.createElement("path", { d: "M184,112a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h64A8,8,0,0,1,184,112Zm-8,24H112a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm48-88V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM48,208H72V48H48Zm160,0V48H88V208H208Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM80,208H48V48H80Zm96-56H112a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm0-32H112a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M182,112a6,6,0,0,1-6,6H112a6,6,0,0,1,0-12h64A6,6,0,0,1,182,112Zm-6,26H112a6,6,0,0,0,0,12h64a6,6,0,0,0,0-12Zm46-90V208a14,14,0,0,1-14,14H48a14,14,0,0,1-14-14V48A14,14,0,0,1,48,34H208A14,14,0,0,1,222,48ZM48,210H74V46H48a2,2,0,0,0-2,2V208A2,2,0,0,0,48,210ZM210,48a2,2,0,0,0-2-2H86V210H208a2,2,0,0,0,2-2Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M184,112a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h64A8,8,0,0,1,184,112Zm-8,24H112a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm48-88V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM48,208H72V48H48Zm160,0V48H88V208H208Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M180,112a4,4,0,0,1-4,4H112a4,4,0,0,1,0-8h64A4,4,0,0,1,180,112Zm-4,28H112a4,4,0,0,0,0,8h64a4,4,0,0,0,0-8Zm44-92V208a12,12,0,0,1-12,12H48a12,12,0,0,1-12-12V48A12,12,0,0,1,48,36H208A12,12,0,0,1,220,48ZM48,212H76V44H48a4,4,0,0,0-4,4V208A4,4,0,0,0,48,212ZM212,48a4,4,0,0,0-4-4H84V212H208a4,4,0,0,0,4-4Z" }))
  ]
]), n2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M100,52H40A20,20,0,0,0,20,72v64a20,20,0,0,0,20,20H96v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,100,52Zm-4,80H44V76H96ZM216,52H156a20,20,0,0,0-20,20v64a20,20,0,0,0,20,20h56v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,216,52Zm-4,80H160V76h52Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M108,72v72H40a8,8,0,0,1-8-8V72a8,8,0,0,1,8-8h60A8,8,0,0,1,108,72Zm108-8H156a8,8,0,0,0-8,8v64a8,8,0,0,0,8,8h68V72A8,8,0,0,0,216,64Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M100,56H40A16,16,0,0,0,24,72v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,100,56Zm0,80H40V72h60ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Zm0,80H156V72h60Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M116,72v88a48.05,48.05,0,0,1-48,48,8,8,0,0,1,0-16,32,32,0,0,0,32-32v-8H40a16,16,0,0,1-16-16V72A16,16,0,0,1,40,56h60A16,16,0,0,1,116,72ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M100,58H40A14,14,0,0,0,26,72v64a14,14,0,0,0,14,14h62v10a34,34,0,0,1-34,34,6,6,0,0,0,0,12,46.06,46.06,0,0,0,46-46V72A14,14,0,0,0,100,58Zm2,80H40a2,2,0,0,1-2-2V72a2,2,0,0,1,2-2h60a2,2,0,0,1,2,2ZM216,58H156a14,14,0,0,0-14,14v64a14,14,0,0,0,14,14h62v10a34,34,0,0,1-34,34,6,6,0,0,0,0,12,46.06,46.06,0,0,0,46-46V72A14,14,0,0,0,216,58Zm2,80H156a2,2,0,0,1-2-2V72a2,2,0,0,1,2-2h60a2,2,0,0,1,2,2Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M100,56H40A16,16,0,0,0,24,72v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,100,56Zm0,80H40V72h60ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Zm0,80H156V72h60Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M100,60H40A12,12,0,0,0,28,72v64a12,12,0,0,0,12,12h64v12a36,36,0,0,1-36,36,4,4,0,0,0,0,8,44.05,44.05,0,0,0,44-44V72A12,12,0,0,0,100,60Zm4,80H40a4,4,0,0,1-4-4V72a4,4,0,0,1,4-4h60a4,4,0,0,1,4,4ZM216,60H156a12,12,0,0,0-12,12v64a12,12,0,0,0,12,12h64v12a36,36,0,0,1-36,36,4,4,0,0,0,0,8,44.05,44.05,0,0,0,44-44V72A12,12,0,0,0,216,60Zm4,80H156a4,4,0,0,1-4-4V72a4,4,0,0,1,4-4h60a4,4,0,0,1,4,4Z" }))
  ]
]), r2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M227.85,46.89a20,20,0,0,0-18.74-18.74c-13.13-.77-46.65.42-74.48,28.24L131,60H74.36a19.83,19.83,0,0,0-14.14,5.86L25.87,100.19a20,20,0,0,0,11.35,33.95l37.14,5.18,42.32,42.32,5.19,37.18A19.88,19.88,0,0,0,135.34,235a20.13,20.13,0,0,0,6.37,1,19.9,19.9,0,0,0,14.1-5.87l34.34-34.35A19.85,19.85,0,0,0,196,181.64V125l3.6-3.59C227.43,93.54,228.62,60,227.85,46.89ZM76,84h31L75.75,115.28l-27.23-3.8ZM151.6,73.37A72.27,72.27,0,0,1,204,52a72.17,72.17,0,0,1-21.38,52.41L128,159,97,128ZM172,180l-27.49,27.49-3.8-27.23L172,149Zm-72,22c-8.71,11.85-26.19,26-60,26a12,12,0,0,1-12-12c0-33.84,14.12-51.32,26-60A12,12,0,1,1,68.18,175.3C62.3,179.63,55.51,187.8,53,203c15.21-2.51,23.37-9.3,27.7-15.18A12,12,0,1,1,100,202Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M184,120v61.65a8,8,0,0,1-2.34,5.65l-34.35,34.35a8,8,0,0,1-13.57-4.53L128,176ZM136,72H74.35a8,8,0,0,0-5.65,2.34L34.35,108.69a8,8,0,0,0,4.53,13.57L80,128ZM40,216c37.65,0,50.69-19.69,54.56-28.18L68.18,161.44C59.69,165.31,40,178.35,40,216Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M223.85,47.12a16,16,0,0,0-15-15c-12.58-.75-44.73.4-71.41,27.07L132.69,64H74.36A15.91,15.91,0,0,0,63,68.68L28.7,103a16,16,0,0,0,9.07,27.16l38.47,5.37,44.21,44.21,5.37,38.49a15.94,15.94,0,0,0,10.78,12.92,16.11,16.11,0,0,0,5.1.83A15.91,15.91,0,0,0,153,227.3L187.32,193A15.91,15.91,0,0,0,192,181.64V123.31l4.77-4.77C223.45,91.86,224.6,59.71,223.85,47.12ZM74.36,80h42.33L77.16,119.52,40,114.34Zm74.41-9.45a76.65,76.65,0,0,1,59.11-22.47,76.46,76.46,0,0,1-22.42,59.16L128,164.68,91.32,128ZM176,181.64,141.67,216l-5.19-37.17L176,139.31Zm-74.16,9.5C97.34,201,82.29,224,40,224a8,8,0,0,1-8-8c0-42.29,23-57.34,32.86-61.85a8,8,0,0,1,6.64,14.56c-6.43,2.93-20.62,12.36-23.12,38.91,26.55-2.5,36-16.69,38.91-23.12a8,8,0,1,1,14.56,6.64Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M101.85,191.14C97.34,201,82.29,224,40,224a8,8,0,0,1-8-8c0-42.29,23-57.34,32.86-61.85a8,8,0,0,1,6.64,14.56c-6.43,2.93-20.62,12.36-23.12,38.91,26.55-2.5,36-16.69,38.91-23.12a8,8,0,1,1,14.56,6.64Zm122-144a16,16,0,0,0-15-15c-12.58-.75-44.73.4-71.4,27.07h0L88,108.7A8,8,0,0,1,76.67,97.39l26.56-26.57A4,4,0,0,0,100.41,64H74.35A15.9,15.9,0,0,0,63,68.68L28.7,103a16,16,0,0,0,9.07,27.16l38.47,5.37,44.21,44.21,5.37,38.49a15.94,15.94,0,0,0,10.78,12.92,16.11,16.11,0,0,0,5.1.83A15.91,15.91,0,0,0,153,227.3L187.32,193A16,16,0,0,0,192,181.65V155.59a4,4,0,0,0-6.83-2.82l-26.57,26.56a8,8,0,0,1-11.71-.42,8.2,8.2,0,0,1,.6-11.1l49.27-49.27h0C223.45,91.86,224.6,59.71,223.85,47.12Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M221.86,47.24a14,14,0,0,0-13.11-13.1c-12.31-.73-43.77.39-69.88,26.5L133.52,66H74.35a13.9,13.9,0,0,0-9.89,4.1L30.11,104.44a14,14,0,0,0,7.94,23.76l39.13,5.46,45.16,45.16L127.8,218a14,14,0,0,0,23.76,7.92l34.35-34.35a13.91,13.91,0,0,0,4.1-9.89V122.48l5.35-5.35h0C221.46,91,222.59,59.56,221.86,47.24ZM38.11,115a2,2,0,0,1,.49-2L72.94,78.58A2,2,0,0,1,74.35,78h47.17L77.87,121.64l-38.14-5.32A1.93,1.93,0,0,1,38.11,115ZM178,181.65a2,2,0,0,1-.59,1.41L143.08,217.4a2,2,0,0,1-3.4-1.11l-5.32-38.16L178,134.48Zm8.87-73h0L128,167.51,88.49,128l58.87-58.88a78.47,78.47,0,0,1,60.69-23A2,2,0,0,1,209.88,48,78.47,78.47,0,0,1,186.88,108.64ZM100,190.31C95.68,199.84,81.13,222,40,222a6,6,0,0,1-6-6c0-41.13,22.16-55.68,31.69-60a6,6,0,1,1,5,10.92c-7,3.17-22.53,13.52-24.47,42.91,29.39-1.94,39.74-17.52,42.91-24.47a6,6,0,1,1,10.92,5Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M223.85,47.12a16,16,0,0,0-15-15c-12.58-.75-44.73.4-71.41,27.07L132.69,64H74.36A15.91,15.91,0,0,0,63,68.68L28.7,103a16,16,0,0,0,9.07,27.16l38.47,5.37,44.21,44.21,5.37,38.49a15.94,15.94,0,0,0,10.78,12.92,16.11,16.11,0,0,0,5.1.83A15.91,15.91,0,0,0,153,227.3L187.32,193A15.91,15.91,0,0,0,192,181.64V123.31l4.77-4.77C223.45,91.86,224.6,59.71,223.85,47.12ZM74.36,80h42.33L77.16,119.52,40,114.34Zm74.41-9.45a76.65,76.65,0,0,1,59.11-22.47,76.46,76.46,0,0,1-22.42,59.16L128,164.68,91.32,128ZM176,181.64,141.67,216l-5.19-37.17L176,139.31Zm-74.16,9.5C97.34,201,82.29,224,40,224a8,8,0,0,1-8-8c0-42.29,23-57.34,32.86-61.85a8,8,0,0,1,6.64,14.56c-6.43,2.93-20.62,12.36-23.12,38.91,26.55-2.5,36-16.69,38.91-23.12a8,8,0,1,1,14.56,6.64Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M219.86,47.36a12,12,0,0,0-11.22-11.22c-12-.71-42.82.38-68.35,25.91L134.35,68h-60a11.9,11.9,0,0,0-8.48,3.52L31.52,105.85a12,12,0,0,0,6.81,20.37l39.79,5.55,46.11,46.11,5.55,39.81a12,12,0,0,0,20.37,6.79l34.34-34.35a11.9,11.9,0,0,0,3.52-8.48v-60l5.94-5.94C219.48,90.18,220.57,59.41,219.86,47.36ZM36.21,115.6a3.94,3.94,0,0,1,1-4.09L71.53,77.17A4,4,0,0,1,74.35,76h52L78.58,123.76,39.44,118.3A3.94,3.94,0,0,1,36.21,115.6ZM180,181.65a4,4,0,0,1-1.17,2.83l-34.35,34.34a4,4,0,0,1-6.79-2.25l-5.46-39.15L180,129.65Zm-52-11.31L85.66,128l60.28-60.29c23.24-23.24,51.25-24.23,62.22-23.58a3.93,3.93,0,0,1,3.71,3.71c.65,11-.35,39-23.58,62.22ZM98.21,189.48C94,198.66,80,220,40,220a4,4,0,0,1-4-4c0-40,21.34-54,30.52-58.21a4,4,0,0,1,3.32,7.28c-7.46,3.41-24.43,14.66-25.76,46.85,32.19-1.33,43.44-18.3,46.85-25.76a4,4,0,1,1,7.28,3.32Z" }))
  ]
]), i2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M199,125.31l-49.88-18.39L130.69,57a19.92,19.92,0,0,0-37.38,0L74.92,106.92,25,125.31a19.92,19.92,0,0,0,0,37.38l49.88,18.39L93.31,231a19.92,19.92,0,0,0,37.38,0l18.39-49.88L199,162.69a19.92,19.92,0,0,0,0-37.38Zm-63.38,35.16a12,12,0,0,0-7.11,7.11L112,212.28l-16.47-44.7a12,12,0,0,0-7.11-7.11L43.72,144l44.7-16.47a12,12,0,0,0,7.11-7.11L112,75.72l16.47,44.7a12,12,0,0,0,7.11,7.11L180.28,144ZM140,40a12,12,0,0,1,12-12h12V16a12,12,0,0,1,24,0V28h12a12,12,0,0,1,0,24H188V64a12,12,0,0,1-24,0V52H152A12,12,0,0,1,140,40ZM252,88a12,12,0,0,1-12,12h-4v4a12,12,0,0,1-24,0v-4h-4a12,12,0,0,1,0-24h4V72a12,12,0,0,1,24,0v4h4A12,12,0,0,1,252,88Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M194.82,151.43l-55.09,20.3-20.3,55.09a7.92,7.92,0,0,1-14.86,0l-20.3-55.09-55.09-20.3a7.92,7.92,0,0,1,0-14.86l55.09-20.3,20.3-55.09a7.92,7.92,0,0,1,14.86,0l20.3,55.09,55.09,20.3A7.92,7.92,0,0,1,194.82,151.43Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88L78,110l19-51.62a15.92,15.92,0,0,1,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M196.89,130.94,144.4,111.6,125.06,59.11a13.92,13.92,0,0,0-26.12,0L79.6,111.6,27.11,130.94a13.92,13.92,0,0,0,0,26.12L79.6,176.4l19.34,52.49a13.92,13.92,0,0,0,26.12,0L144.4,176.4l52.49-19.34a13.92,13.92,0,0,0,0-26.12Zm-4.15,14.86-55.08,20.3a6,6,0,0,0-3.56,3.56l-20.3,55.08a1.92,1.92,0,0,1-3.6,0L89.9,169.66a6,6,0,0,0-3.56-3.56L31.26,145.8a1.92,1.92,0,0,1,0-3.6l55.08-20.3a6,6,0,0,0,3.56-3.56l20.3-55.08a1.92,1.92,0,0,1,3.6,0l20.3,55.08a6,6,0,0,0,3.56,3.56l55.08,20.3a1.92,1.92,0,0,1,0,3.6ZM146,40a6,6,0,0,1,6-6h18V16a6,6,0,0,1,12,0V34h18a6,6,0,0,1,0,12H182V64a6,6,0,0,1-12,0V46H152A6,6,0,0,1,146,40ZM246,88a6,6,0,0,1-6,6H230v10a6,6,0,0,1-12,0V94H208a6,6,0,0,1,0-12h10V72a6,6,0,0,1,12,0V82h10A6,6,0,0,1,246,88Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M196.2,132.81l-53.36-19.65L123.19,59.8a11.93,11.93,0,0,0-22.38,0L81.16,113.16,27.8,132.81a11.93,11.93,0,0,0,0,22.38l53.36,19.65,19.65,53.36a11.93,11.93,0,0,0,22.38,0l19.65-53.36,53.36-19.65a11.93,11.93,0,0,0,0-22.38Zm-2.77,14.87L138.35,168a4,4,0,0,0-2.37,2.37l-20.3,55.08a3.92,3.92,0,0,1-7.36,0L88,170.35A4,4,0,0,0,85.65,168l-55.08-20.3a3.92,3.92,0,0,1,0-7.36L85.65,120A4,4,0,0,0,88,117.65l20.3-55.08a3.92,3.92,0,0,1,7.36,0L136,117.65a4,4,0,0,0,2.37,2.37l55.08,20.3a3.92,3.92,0,0,1,0,7.36ZM148,40a4,4,0,0,1,4-4h20V16a4,4,0,0,1,8,0V36h20a4,4,0,0,1,0,8H180V64a4,4,0,0,1-8,0V44H152A4,4,0,0,1,148,40Zm96,48a4,4,0,0,1-4,4H228v12a4,4,0,0,1-8,0V92H208a4,4,0,0,1,0-8h12V72a4,4,0,0,1,8,0V84h12A4,4,0,0,1,244,88Z" }))
  ]
]), l2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M243,96a20.33,20.33,0,0,0-17.74-14l-56.59-4.57L146.83,24.62a20.36,20.36,0,0,0-37.66,0L87.35,77.44,30.76,82A20.45,20.45,0,0,0,19.1,117.88l43.18,37.24-13.2,55.7A20.37,20.37,0,0,0,79.57,233L128,203.19,176.43,233a20.39,20.39,0,0,0,30.49-22.15l-13.2-55.7,43.18-37.24A20.43,20.43,0,0,0,243,96ZM172.53,141.7a12,12,0,0,0-3.84,11.86L181.58,208l-47.29-29.08a12,12,0,0,0-12.58,0L74.42,208l12.89-54.4a12,12,0,0,0-3.84-11.86L41.2,105.24l55.4-4.47a12,12,0,0,0,10.13-7.38L128,41.89l21.27,51.5a12,12,0,0,0,10.13,7.38l55.4,4.47Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M229.06,108.79l-48.7,42,14.88,62.79a8.4,8.4,0,0,1-12.52,9.17L128,189.09,73.28,222.74a8.4,8.4,0,0,1-12.52-9.17l14.88-62.79-48.7-42A8.46,8.46,0,0,1,31.73,94L95.64,88.8l24.62-59.6a8.36,8.36,0,0,1,15.48,0l24.62,59.6L224.27,94A8.46,8.46,0,0,1,229.06,108.79Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M237.28,97.87A14.18,14.18,0,0,0,224.76,88l-60.25-4.87-23.22-56.2a14.37,14.37,0,0,0-26.58,0L91.49,83.11,31.24,88a14.18,14.18,0,0,0-12.52,9.89A14.43,14.43,0,0,0,23,113.32L69,152.93l-14,59.25a14.4,14.4,0,0,0,5.59,15,14.1,14.1,0,0,0,15.91.6L128,196.12l51.58,31.71a14.1,14.1,0,0,0,15.91-.6,14.4,14.4,0,0,0,5.59-15l-14-59.25L233,113.32A14.43,14.43,0,0,0,237.28,97.87Zm-12.14,6.37-48.69,42a6,6,0,0,0-1.92,5.92l14.88,62.79a2.35,2.35,0,0,1-.95,2.57,2.24,2.24,0,0,1-2.6.1L131.14,184a6,6,0,0,0-6.28,0L70.14,217.61a2.24,2.24,0,0,1-2.6-.1,2.35,2.35,0,0,1-1-2.57l14.88-62.79a6,6,0,0,0-1.92-5.92l-48.69-42a2.37,2.37,0,0,1-.73-2.65,2.28,2.28,0,0,1,2.07-1.65l63.92-5.16a6,6,0,0,0,5.06-3.69l24.63-59.6a2.35,2.35,0,0,1,4.38,0l24.63,59.6a6,6,0,0,0,5.06,3.69l63.92,5.16a2.28,2.28,0,0,1,2.07,1.65A2.37,2.37,0,0,1,225.14,104.24Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M235.36,98.49A12.21,12.21,0,0,0,224.59,90l-61.47-5L139.44,27.67a12.37,12.37,0,0,0-22.88,0L92.88,85,31.41,90a12.45,12.45,0,0,0-7.07,21.84l46.85,40.41L56.87,212.64a12.35,12.35,0,0,0,18.51,13.49L128,193.77l52.62,32.36a12.12,12.12,0,0,0,13.69-.51,12.28,12.28,0,0,0,4.82-13l-14.32-60.42,46.85-40.41A12.29,12.29,0,0,0,235.36,98.49Zm-8.93,7.26-48.68,42a4,4,0,0,0-1.28,3.95l14.87,62.79a4.37,4.37,0,0,1-1.72,4.65,4.24,4.24,0,0,1-4.81.18L130.1,185.67a4,4,0,0,0-4.2,0L71.19,219.32a4.24,4.24,0,0,1-4.81-.18,4.37,4.37,0,0,1-1.72-4.65L79.53,151.7a4,4,0,0,0-1.28-3.95l-48.68-42A4.37,4.37,0,0,1,28.25,101a4.31,4.31,0,0,1,3.81-3L96,92.79a4,4,0,0,0,3.38-2.46L124,30.73a4.35,4.35,0,0,1,8.08,0l24.62,59.6A4,4,0,0,0,160,92.79l63.9,5.15a4.31,4.31,0,0,1,3.81,3A4.37,4.37,0,0,1,226.43,105.75Z" }))
  ]
]), a2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M240,148H203.89c.07-1.33.11-2.66.11-4a76,76,0,0,0-152,0c0,1.34,0,2.67.11,4H16a12,12,0,0,0,0,24H240a12,12,0,0,0,0-24ZM76,144a52,52,0,0,1,104,0c0,1.34-.07,2.67-.17,4H76.17C76.07,146.67,76,145.34,76,144Zm144,56a12,12,0,0,1-12,12H48a12,12,0,0,1,0-24H208A12,12,0,0,1,220,200ZM12.62,92.21a12,12,0,0,1,15.17-7.59l12,4a12,12,0,1,1-7.58,22.77l-12-4A12,12,0,0,1,12.62,92.21Zm56-48.41a12,12,0,1,1,22.76-7.59l4,12A12,12,0,1,1,72.62,55.8Zm140,60a12,12,0,0,1,7.59-15.18l12-4a12,12,0,0,1,7.58,22.77l-12,4a12,12,0,0,1-15.17-7.59Zm-48-55.59,4-12a12,12,0,1,1,22.76,7.59l-4,12a12,12,0,1,1-22.76-7.59Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement(
      "path",
      {
        d: "M192,144a64.33,64.33,0,0,1-2,16H66a64,64,0,1,1,126-16Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ h.createElement("path", { d: "M240,152H199.55a73.54,73.54,0,0,0,.45-8,72,72,0,0,0-144,0,73.54,73.54,0,0,0,.45,8H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM72,144a56,56,0,1,1,111.41,8H72.59A56.13,56.13,0,0,1,72,144Zm144,56a8,8,0,0,1-8,8H48a8,8,0,0,1,0-16H208A8,8,0,0,1,216,200ZM72.84,43.58a8,8,0,0,1,14.32-7.16l8,16a8,8,0,0,1-14.32,7.16Zm-56,48.84a8,8,0,0,1,10.74-3.57l16,8a8,8,0,0,1-7.16,14.31l-16-8A8,8,0,0,1,16.84,92.42Zm192,15.16a8,8,0,0,1,3.58-10.73l16-8a8,8,0,1,1,7.16,14.31l-16,8a8,8,0,0,1-10.74-3.58Zm-48-55.16,8-16a8,8,0,0,1,14.32,7.16l-8,16a8,8,0,1,1-14.32-7.16Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M248,160a8,8,0,0,1-8,8H16a8,8,0,0,1,0-16H56.45a73.54,73.54,0,0,1-.45-8,72,72,0,0,1,144,0,73.54,73.54,0,0,1-.45,8H240A8,8,0,0,1,248,160Zm-40,32H48a8,8,0,0,0,0,16H208a8,8,0,0,0,0-16ZM80.84,59.58a8,8,0,0,0,14.32-7.16l-8-16a8,8,0,0,0-14.32,7.16ZM20.42,103.16l16,8a8,8,0,1,0,7.16-14.31l-16-8a8,8,0,1,0-7.16,14.31ZM216,112a8,8,0,0,0,3.57-.84l16-8a8,8,0,1,0-7.16-14.31l-16,8A8,8,0,0,0,216,112ZM164.42,63.16a8,8,0,0,0,10.74-3.58l8-16a8,8,0,0,0-14.32-7.16l-8,16A8,8,0,0,0,164.42,63.16Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M240,154H197.28a70.91,70.91,0,0,0,.72-10,70,70,0,0,0-140,0,70.91,70.91,0,0,0,.72,10H16a6,6,0,0,0,0,12H240a6,6,0,0,0,0-12ZM70,144a58,58,0,1,1,115.13,10H70.87A58.63,58.63,0,0,1,70,144Zm144,56a6,6,0,0,1-6,6H48a6,6,0,0,1,0-12H208A6,6,0,0,1,214,200ZM74.63,42.69a6,6,0,0,1,10.74-5.37l8,16a6,6,0,0,1-10.74,5.36Zm-56,50.63a6,6,0,0,1,8.05-2.69l16,8a6,6,0,0,1-5.36,10.74l-16-8A6,6,0,0,1,18.63,93.32Zm192,13.36a6,6,0,0,1,2.69-8.05l16-8a6,6,0,1,1,5.36,10.74l-16,8a6,6,0,0,1-8.05-2.69Zm-48-53.36,8-16a6,6,0,0,1,10.74,5.37l-8,16a6,6,0,1,1-10.74-5.36Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M240,152H199.55a73.54,73.54,0,0,0,.45-8,72,72,0,0,0-144,0,73.54,73.54,0,0,0,.45,8H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM72,144a56,56,0,1,1,111.41,8H72.59A56.13,56.13,0,0,1,72,144Zm144,56a8,8,0,0,1-8,8H48a8,8,0,0,1,0-16H208A8,8,0,0,1,216,200ZM72.84,43.58a8,8,0,0,1,14.32-7.16l8,16a8,8,0,0,1-14.32,7.16Zm-56,48.84a8,8,0,0,1,10.74-3.57l16,8a8,8,0,0,1-7.16,14.31l-16-8A8,8,0,0,1,16.84,92.42Zm192,15.16a8,8,0,0,1,3.58-10.73l16-8a8,8,0,1,1,7.16,14.31l-16,8a8,8,0,0,1-10.74-3.58Zm-48-55.16,8-16a8,8,0,0,1,14.32,7.16l-8,16a8,8,0,1,1-14.32-7.16Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M240,156H194.94A68,68,0,1,0,60,144a68.73,68.73,0,0,0,1.06,12H16a4,4,0,0,0,0,8H240a4,4,0,0,0,0-8ZM68,144a60,60,0,1,1,118.79,12H69.21A60.16,60.16,0,0,1,68,144Zm144,56a4,4,0,0,1-4,4H48a4,4,0,0,1,0-8H208A4,4,0,0,1,212,200ZM76.42,41.79a4,4,0,0,1,7.16-3.58l8,16a4,4,0,0,1-7.16,3.58Zm-56,52.42a4,4,0,0,1,5.37-1.79l16,8a4,4,0,0,1-3.58,7.16l-16-8A4,4,0,0,1,20.42,94.21Zm192,11.58a4,4,0,0,1,1.79-5.37l16-8a4,4,0,1,1,3.58,7.16l-16,8a4,4,0,0,1-5.37-1.79Zm-48-51.58,8-16a4,4,0,1,1,7.16,3.58l-8,16a4,4,0,0,1-7.16-3.58Z" }))
  ]
]), o2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M229.26,90.4a108,108,0,0,1-177.63,114A108,108,0,0,1,195.41,43.63l20.1-20.11a12,12,0,0,1,17,17l-96,96a12,12,0,1,1-17-17l24-24a36,36,0,1,0,19.76,39.65,12,12,0,0,1,23.53,4.74,60,60,0,1,1-25.73-62L178.3,60.74a84,84,0,1,0,28.46,38,12,12,0,1,1,22.5-8.35Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M176,128a48,48,0,1,1-48-48A48,48,0,0,1,176,128Z", opacity: "0.2" }), /* @__PURE__ */ h.createElement("path", { d: "M221.87,83.16A104.1,104.1,0,1,1,195.67,49l22.67-22.68a8,8,0,0,1,11.32,11.32l-96,96a8,8,0,0,1-11.32-11.32l27.72-27.72a40,40,0,1,0,17.87,31.09,8,8,0,1,1,16-.9,56,56,0,1,1-22.38-41.65L184.3,60.39a87.88,87.88,0,1,0,23.13,29.67,8,8,0,0,1,14.44-6.9Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M221.87,83.16A104.1,104.1,0,1,1,195.67,49l22.67-22.68a8,8,0,0,1,11.32,11.32L167.6,99.71h0l-37.71,37.71-23.95,23.95a40,40,0,0,0,62-35.67,8,8,0,1,1,16-.9,56,56,0,0,1-95.5,42.79h0a56,56,0,0,1,73.13-84.43L184.3,60.39a87.88,87.88,0,1,0,23.13,29.67,8,8,0,0,1,14.44-6.9Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M220.06,84a102.06,102.06,0,1,1-24.31-32.27l24-24a6,6,0,0,1,8.48,8.49l-96,96a6,6,0,1,1-8.48-8.49l29.39-29.4a42,42,0,1,0,16.78,31.24,6,6,0,1,1,12-.68A54,54,0,1,1,161.7,85.83l25.54-25.55a89.91,89.91,0,1,0,22,28.93A6,6,0,1,1,220.06,84Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M221.87,83.16A104.1,104.1,0,1,1,195.67,49l22.67-22.68a8,8,0,0,1,11.32,11.32l-96,96a8,8,0,0,1-11.32-11.32l27.72-27.72a40,40,0,1,0,17.87,31.09,8,8,0,1,1,16-.9,56,56,0,1,1-22.38-41.65L184.3,60.39a87.88,87.88,0,1,0,23.13,29.67,8,8,0,0,1,14.44-6.9Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ h.createElement(h.Fragment, null, /* @__PURE__ */ h.createElement("path", { d: "M218.26,84.89a100.16,100.16,0,1,1-22.44-30.37l25.35-25.35a4,4,0,1,1,5.66,5.66l-96,96a4,4,0,0,1-5.66-5.66l31-31a44,44,0,1,0,15.78,31.3,4,4,0,0,1,8-.46,52,52,0,1,1-18.1-36.51l28.34-28.33A92,92,0,0,0,63,193.05,92,92,0,0,0,211,88.33a4,4,0,1,1,7.22-3.44Z" }))
  ]
]), s2 = wi({
  color: "currentColor",
  size: "1em",
  weight: "regular",
  mirrored: !1
}), ne = h.forwardRef(
  (e, t) => {
    const {
      alt: n,
      color: r,
      size: i,
      weight: a,
      mirrored: l,
      children: o,
      weights: s,
      ...u
    } = e, {
      color: f = "currentColor",
      size: c,
      weight: p = "regular",
      mirrored: d = !1,
      ...m
    } = h.useContext(s2);
    return /* @__PURE__ */ h.createElement(
      "svg",
      {
        ref: t,
        xmlns: "http://www.w3.org/2000/svg",
        width: i ?? c,
        height: i ?? c,
        fill: r ?? f,
        viewBox: "0 0 256 256",
        transform: l || d ? "scale(-1, 1)" : void 0,
        ...m,
        ...u
      },
      !!n && /* @__PURE__ */ h.createElement("title", null, n),
      o,
      s.get(a ?? p)
    );
  }
);
ne.displayName = "IconBase";
const rr = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: U0 }));
rr.displayName = "BookOpenTextIcon";
const Ll = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: W0 }));
Ll.displayName = "CaretDownIcon";
const Nl = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: q0 }));
Nl.displayName = "CaretUpIcon";
const Rt = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: G0 }));
Rt.displayName = "ChartLineUpIcon";
const Il = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: Y0 }));
Il.displayName = "ChatCircleDotsIcon";
const Tl = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: X0 }));
Tl.displayName = "CircleNotchIcon";
const jt = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: Q0 }));
jt.displayName = "FlameIcon";
const Fl = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: J0 }));
Fl.displayName = "LightbulbIcon";
const $t = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: K0 }));
$t.displayName = "LightningIcon";
const et = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: e2 }));
et.displayName = "MoonStarsIcon";
const tt = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: t2 }));
tt.displayName = "NotebookIcon";
const zl = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: n2 }));
zl.displayName = "QuotesIcon";
const ir = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: r2 }));
ir.displayName = "RocketLaunchIcon";
const lr = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: i2 }));
lr.displayName = "SparkleIcon";
const Hl = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: l2 }));
Hl.displayName = "StarIcon";
const Be = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: a2 }));
Be.displayName = "SunHorizonIcon";
const Pl = h.forwardRef((e, t) => /* @__PURE__ */ h.createElement(ne, { ref: t, ...e, weights: o2 }));
Pl.displayName = "TargetIcon";
function oi(e, t) {
  if (typeof e == "function")
    return e(t);
  e != null && (e.current = t);
}
function u2(...e) {
  return (t) => {
    let n = !1;
    const r = e.map((i) => {
      const a = oi(i, t);
      return !n && typeof a == "function" && (n = !0), a;
    });
    if (n)
      return () => {
        for (let i = 0; i < r.length; i++) {
          const a = r[i];
          typeof a == "function" ? a() : oi(e[i], null);
        }
      };
  };
}
function c2(...e) {
  return h.useCallback(u2(...e), e);
}
// @__NO_SIDE_EFFECTS__
function f2(e) {
  const t = h.forwardRef((n, r) => {
    let { children: i, ...a } = n, l = null, o = !1;
    const s = [];
    si(i) && typeof Ht == "function" && (i = Ht(i._payload)), h.Children.forEach(i, (p) => {
      var d;
      if (y2(p)) {
        o = !0;
        const m = p;
        let w = "child" in m.props ? m.props.child : m.props.children;
        si(w) && typeof Ht == "function" && (w = Ht(w._payload)), l = p2(m, w), s.push((d = l == null ? void 0 : l.props) == null ? void 0 : d.children);
      } else
        s.push(p);
    }), l ? l = h.cloneElement(l, void 0, s) : (
      // A `Slottable` was found but it didn't resolve to a single element (e.g.
      // it wrapped multiple elements, text, or a render-prop `child` that
      // wasn't an element). Don't fall back to treating the `Slottable` wrapper
      // itself as the slot target — throw a descriptive error below instead.
      !o && h.Children.count(i) === 1 && h.isValidElement(i) && (l = i)
    );
    const u = l ? g2(l) : void 0, f = c2(r, u);
    if (!l) {
      if (i || i === 0)
        throw new Error(
          o ? w2(e) : k2(e)
        );
      return i;
    }
    const c = m2(a, l.props ?? {});
    return l.type !== h.Fragment && (c.ref = r ? f : u), h.cloneElement(l, c);
  });
  return t.displayName = `${e}.Slot`, t;
}
var h2 = /* @__PURE__ */ f2("Slot"), d2 = Symbol.for("radix.slottable"), p2 = (e, t) => {
  if ("child" in e.props) {
    const n = e.props.child;
    return h.isValidElement(n) ? h.cloneElement(n, void 0, e.props.children(n.props.children)) : null;
  }
  return h.isValidElement(t) ? t : null;
};
function m2(e, t) {
  const n = { ...t };
  for (const r in t) {
    const i = e[r], a = t[r];
    /^on[A-Z]/.test(r) ? i && a ? n[r] = (...o) => {
      const s = a(...o);
      return i(...o), s;
    } : i && (n[r] = i) : r === "style" ? n[r] = { ...i, ...a } : r === "className" && (n[r] = [i, a].filter(Boolean).join(" "));
  }
  return { ...e, ...n };
}
function g2(e) {
  var r, i;
  let t = (r = Object.getOwnPropertyDescriptor(e.props, "ref")) == null ? void 0 : r.get, n = t && "isReactWarning" in t && t.isReactWarning;
  return n ? e.ref : (t = (i = Object.getOwnPropertyDescriptor(e, "ref")) == null ? void 0 : i.get, n = t && "isReactWarning" in t && t.isReactWarning, n ? e.props.ref : e.props.ref || e.ref);
}
function y2(e) {
  return h.isValidElement(e) && typeof e.type == "function" && "__radixId" in e.type && e.type.__radixId === d2;
}
var x2 = Symbol.for("react.lazy");
function si(e) {
  return e != null && typeof e == "object" && "$$typeof" in e && e.$$typeof === x2 && "_payload" in e && b2(e._payload);
}
function b2(e) {
  return typeof e == "object" && e !== null && "then" in e;
}
var k2 = (e) => `${e} failed to slot onto its children. Expected a single React element child or \`Slottable\`.`, w2 = (e) => `${e} failed to slot onto its \`Slottable\`. Expected \`Slottable\` to receive a single React element child.`, Ht = h[" use ".trim().toString()];
function Zl(e) {
  var t, n, r = "";
  if (typeof e == "string" || typeof e == "number") r += e;
  else if (typeof e == "object") if (Array.isArray(e)) {
    var i = e.length;
    for (t = 0; t < i; t++) e[t] && (n = Zl(e[t])) && (r && (r += " "), r += n);
  } else for (n in e) e[n] && (r && (r += " "), r += n);
  return r;
}
function Dl() {
  for (var e, t, n = 0, r = "", i = arguments.length; n < i; n++) (e = arguments[n]) && (t = Zl(e)) && (r && (r += " "), r += t);
  return r;
}
const ui = (e) => typeof e == "boolean" ? `${e}` : e === 0 ? "0" : e, ci = Dl, A2 = (e, t) => (n) => {
  var r;
  if ((t == null ? void 0 : t.variants) == null) return ci(e, n == null ? void 0 : n.class, n == null ? void 0 : n.className);
  const { variants: i, defaultVariants: a } = t, l = Object.keys(i).map((u) => {
    const f = n == null ? void 0 : n[u], c = a == null ? void 0 : a[u];
    if (f === null) return null;
    const p = ui(f) || ui(c);
    return i[u][p];
  }), o = n && Object.entries(n).reduce((u, f) => {
    let [c, p] = f;
    return p === void 0 || (u[c] = p), u;
  }, {}), s = t == null || (r = t.compoundVariants) === null || r === void 0 ? void 0 : r.reduce((u, f) => {
    let { class: c, className: p, ...d } = f;
    return Object.entries(d).every((m) => {
      let [w, k] = m;
      return Array.isArray(k) ? k.includes({
        ...a,
        ...o
      }[w]) : {
        ...a,
        ...o
      }[w] === k;
    }) ? [
      ...u,
      c,
      p
    ] : u;
  }, []);
  return ci(e, l, s, n == null ? void 0 : n.class, n == null ? void 0 : n.className);
}, ar = "-", v2 = (e) => {
  const t = C2(e), {
    conflictingClassGroups: n,
    conflictingClassGroupModifiers: r
  } = e;
  return {
    getClassGroupId: (l) => {
      const o = l.split(ar);
      return o[0] === "" && o.length !== 1 && o.shift(), Rl(o, t) || E2(l);
    },
    getConflictingClassGroupIds: (l, o) => {
      const s = n[l] || [];
      return o && r[l] ? [...s, ...r[l]] : s;
    }
  };
}, Rl = (e, t) => {
  var l;
  if (e.length === 0)
    return t.classGroupId;
  const n = e[0], r = t.nextPart.get(n), i = r ? Rl(e.slice(1), r) : void 0;
  if (i)
    return i;
  if (t.validators.length === 0)
    return;
  const a = e.join(ar);
  return (l = t.validators.find(({
    validator: o
  }) => o(a))) == null ? void 0 : l.classGroupId;
}, fi = /^\[(.+)\]$/, E2 = (e) => {
  if (fi.test(e)) {
    const t = fi.exec(e)[1], n = t == null ? void 0 : t.substring(0, t.indexOf(":"));
    if (n)
      return "arbitrary.." + n;
  }
}, C2 = (e) => {
  const {
    theme: t,
    prefix: n
  } = e, r = {
    nextPart: /* @__PURE__ */ new Map(),
    validators: []
  };
  return M2(Object.entries(e.classGroups), n).forEach(([a, l]) => {
    Nn(l, r, a, t);
  }), r;
}, Nn = (e, t, n, r) => {
  e.forEach((i) => {
    if (typeof i == "string") {
      const a = i === "" ? t : hi(t, i);
      a.classGroupId = n;
      return;
    }
    if (typeof i == "function") {
      if (S2(i)) {
        Nn(i(r), t, n, r);
        return;
      }
      t.validators.push({
        validator: i,
        classGroupId: n
      });
      return;
    }
    Object.entries(i).forEach(([a, l]) => {
      Nn(l, hi(t, a), n, r);
    });
  });
}, hi = (e, t) => {
  let n = e;
  return t.split(ar).forEach((r) => {
    n.nextPart.has(r) || n.nextPart.set(r, {
      nextPart: /* @__PURE__ */ new Map(),
      validators: []
    }), n = n.nextPart.get(r);
  }), n;
}, S2 = (e) => e.isThemeGetter, M2 = (e, t) => t ? e.map(([n, r]) => {
  const i = r.map((a) => typeof a == "string" ? t + a : typeof a == "object" ? Object.fromEntries(Object.entries(a).map(([l, o]) => [t + l, o])) : a);
  return [n, i];
}) : e, L2 = (e) => {
  if (e < 1)
    return {
      get: () => {
      },
      set: () => {
      }
    };
  let t = 0, n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
  const i = (a, l) => {
    n.set(a, l), t++, t > e && (t = 0, r = n, n = /* @__PURE__ */ new Map());
  };
  return {
    get(a) {
      let l = n.get(a);
      if (l !== void 0)
        return l;
      if ((l = r.get(a)) !== void 0)
        return i(a, l), l;
    },
    set(a, l) {
      n.has(a) ? n.set(a, l) : i(a, l);
    }
  };
}, _l = "!", N2 = (e) => {
  const {
    separator: t,
    experimentalParseClassName: n
  } = e, r = t.length === 1, i = t[0], a = t.length, l = (o) => {
    const s = [];
    let u = 0, f = 0, c;
    for (let k = 0; k < o.length; k++) {
      let x = o[k];
      if (u === 0) {
        if (x === i && (r || o.slice(k, k + a) === t)) {
          s.push(o.slice(f, k)), f = k + a;
          continue;
        }
        if (x === "/") {
          c = k;
          continue;
        }
      }
      x === "[" ? u++ : x === "]" && u--;
    }
    const p = s.length === 0 ? o : o.substring(f), d = p.startsWith(_l), m = d ? p.substring(1) : p, w = c && c > f ? c - f : void 0;
    return {
      modifiers: s,
      hasImportantModifier: d,
      baseClassName: m,
      maybePostfixModifierPosition: w
    };
  };
  return n ? (o) => n({
    className: o,
    parseClassName: l
  }) : l;
}, I2 = (e) => {
  if (e.length <= 1)
    return e;
  const t = [];
  let n = [];
  return e.forEach((r) => {
    r[0] === "[" ? (t.push(...n.sort(), r), n = []) : n.push(r);
  }), t.push(...n.sort()), t;
}, T2 = (e) => ({
  cache: L2(e.cacheSize),
  parseClassName: N2(e),
  ...v2(e)
}), F2 = /\s+/, z2 = (e, t) => {
  const {
    parseClassName: n,
    getClassGroupId: r,
    getConflictingClassGroupIds: i
  } = t, a = [], l = e.trim().split(F2);
  let o = "";
  for (let s = l.length - 1; s >= 0; s -= 1) {
    const u = l[s], {
      modifiers: f,
      hasImportantModifier: c,
      baseClassName: p,
      maybePostfixModifierPosition: d
    } = n(u);
    let m = !!d, w = r(m ? p.substring(0, d) : p);
    if (!w) {
      if (!m) {
        o = u + (o.length > 0 ? " " + o : o);
        continue;
      }
      if (w = r(p), !w) {
        o = u + (o.length > 0 ? " " + o : o);
        continue;
      }
      m = !1;
    }
    const k = I2(f).join(":"), x = c ? k + _l : k, S = x + w;
    if (a.includes(S))
      continue;
    a.push(S);
    const C = i(w, m);
    for (let H = 0; H < C.length; ++H) {
      const Z = C[H];
      a.push(x + Z);
    }
    o = u + (o.length > 0 ? " " + o : o);
  }
  return o;
};
function H2() {
  let e = 0, t, n, r = "";
  for (; e < arguments.length; )
    (t = arguments[e++]) && (n = Vl(t)) && (r && (r += " "), r += n);
  return r;
}
const Vl = (e) => {
  if (typeof e == "string")
    return e;
  let t, n = "";
  for (let r = 0; r < e.length; r++)
    e[r] && (t = Vl(e[r])) && (n && (n += " "), n += t);
  return n;
};
function P2(e, ...t) {
  let n, r, i, a = l;
  function l(s) {
    const u = t.reduce((f, c) => c(f), e());
    return n = T2(u), r = n.cache.get, i = n.cache.set, a = o, o(s);
  }
  function o(s) {
    const u = r(s);
    if (u)
      return u;
    const f = z2(s, n);
    return i(s, f), f;
  }
  return function() {
    return a(H2.apply(null, arguments));
  };
}
const J = (e) => {
  const t = (n) => n[e] || [];
  return t.isThemeGetter = !0, t;
}, Ol = /^\[(?:([a-z-]+):)?(.+)\]$/i, Z2 = /^\d+\/\d+$/, D2 = /* @__PURE__ */ new Set(["px", "full", "screen"]), R2 = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/, _2 = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/, V2 = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/, O2 = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/, B2 = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/, Me = (e) => nt(e) || D2.has(e) || Z2.test(e), ze = (e) => at(e, "length", X2), nt = (e) => !!e && !Number.isNaN(Number(e)), yn = (e) => at(e, "number", nt), pt = (e) => !!e && Number.isInteger(Number(e)), j2 = (e) => e.endsWith("%") && nt(e.slice(0, -1)), _ = (e) => Ol.test(e), He = (e) => R2.test(e), $2 = /* @__PURE__ */ new Set(["length", "size", "percentage"]), U2 = (e) => at(e, $2, Bl), W2 = (e) => at(e, "position", Bl), q2 = /* @__PURE__ */ new Set(["image", "url"]), G2 = (e) => at(e, q2, J2), Y2 = (e) => at(e, "", Q2), mt = () => !0, at = (e, t, n) => {
  const r = Ol.exec(e);
  return r ? r[1] ? typeof t == "string" ? r[1] === t : t.has(r[1]) : n(r[2]) : !1;
}, X2 = (e) => (
  // `colorFunctionRegex` check is necessary because color functions can have percentages in them which which would be incorrectly classified as lengths.
  // For example, `hsl(0 0% 0%)` would be classified as a length without this check.
  // I could also use lookbehind assertion in `lengthUnitRegex` but that isn't supported widely enough.
  _2.test(e) && !V2.test(e)
), Bl = () => !1, Q2 = (e) => O2.test(e), J2 = (e) => B2.test(e), K2 = () => {
  const e = J("colors"), t = J("spacing"), n = J("blur"), r = J("brightness"), i = J("borderColor"), a = J("borderRadius"), l = J("borderSpacing"), o = J("borderWidth"), s = J("contrast"), u = J("grayscale"), f = J("hueRotate"), c = J("invert"), p = J("gap"), d = J("gradientColorStops"), m = J("gradientColorStopPositions"), w = J("inset"), k = J("margin"), x = J("opacity"), S = J("padding"), C = J("saturate"), H = J("scale"), Z = J("sepia"), v = J("skew"), V = J("space"), $ = J("translate"), B = () => ["auto", "contain", "none"], A = () => ["auto", "hidden", "clip", "visible", "scroll"], F = () => ["auto", _, t], L = () => [_, t], q = () => ["", Me, ze], z = () => ["auto", nt, _], T = () => ["bottom", "center", "left", "left-bottom", "left-top", "right", "right-bottom", "right-top", "top"], W = () => ["solid", "dashed", "dotted", "double", "none"], K = () => ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"], oe = () => ["start", "end", "center", "between", "around", "evenly", "stretch"], se = () => ["", "0", _], g = () => ["auto", "avoid", "all", "avoid-page", "page", "left", "right", "column"], ee = () => [nt, _];
  return {
    cacheSize: 500,
    separator: ":",
    theme: {
      colors: [mt],
      spacing: [Me, ze],
      blur: ["none", "", He, _],
      brightness: ee(),
      borderColor: [e],
      borderRadius: ["none", "", "full", He, _],
      borderSpacing: L(),
      borderWidth: q(),
      contrast: ee(),
      grayscale: se(),
      hueRotate: ee(),
      invert: se(),
      gap: L(),
      gradientColorStops: [e],
      gradientColorStopPositions: [j2, ze],
      inset: F(),
      margin: F(),
      opacity: ee(),
      padding: L(),
      saturate: ee(),
      scale: ee(),
      sepia: se(),
      skew: ee(),
      space: L(),
      translate: L()
    },
    classGroups: {
      // Layout
      /**
       * Aspect Ratio
       * @see https://tailwindcss.com/docs/aspect-ratio
       */
      aspect: [{
        aspect: ["auto", "square", "video", _]
      }],
      /**
       * Container
       * @see https://tailwindcss.com/docs/container
       */
      container: ["container"],
      /**
       * Columns
       * @see https://tailwindcss.com/docs/columns
       */
      columns: [{
        columns: [He]
      }],
      /**
       * Break After
       * @see https://tailwindcss.com/docs/break-after
       */
      "break-after": [{
        "break-after": g()
      }],
      /**
       * Break Before
       * @see https://tailwindcss.com/docs/break-before
       */
      "break-before": [{
        "break-before": g()
      }],
      /**
       * Break Inside
       * @see https://tailwindcss.com/docs/break-inside
       */
      "break-inside": [{
        "break-inside": ["auto", "avoid", "avoid-page", "avoid-column"]
      }],
      /**
       * Box Decoration Break
       * @see https://tailwindcss.com/docs/box-decoration-break
       */
      "box-decoration": [{
        "box-decoration": ["slice", "clone"]
      }],
      /**
       * Box Sizing
       * @see https://tailwindcss.com/docs/box-sizing
       */
      box: [{
        box: ["border", "content"]
      }],
      /**
       * Display
       * @see https://tailwindcss.com/docs/display
       */
      display: ["block", "inline-block", "inline", "flex", "inline-flex", "table", "inline-table", "table-caption", "table-cell", "table-column", "table-column-group", "table-footer-group", "table-header-group", "table-row-group", "table-row", "flow-root", "grid", "inline-grid", "contents", "list-item", "hidden"],
      /**
       * Floats
       * @see https://tailwindcss.com/docs/float
       */
      float: [{
        float: ["right", "left", "none", "start", "end"]
      }],
      /**
       * Clear
       * @see https://tailwindcss.com/docs/clear
       */
      clear: [{
        clear: ["left", "right", "both", "none", "start", "end"]
      }],
      /**
       * Isolation
       * @see https://tailwindcss.com/docs/isolation
       */
      isolation: ["isolate", "isolation-auto"],
      /**
       * Object Fit
       * @see https://tailwindcss.com/docs/object-fit
       */
      "object-fit": [{
        object: ["contain", "cover", "fill", "none", "scale-down"]
      }],
      /**
       * Object Position
       * @see https://tailwindcss.com/docs/object-position
       */
      "object-position": [{
        object: [...T(), _]
      }],
      /**
       * Overflow
       * @see https://tailwindcss.com/docs/overflow
       */
      overflow: [{
        overflow: A()
      }],
      /**
       * Overflow X
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-x": [{
        "overflow-x": A()
      }],
      /**
       * Overflow Y
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-y": [{
        "overflow-y": A()
      }],
      /**
       * Overscroll Behavior
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      overscroll: [{
        overscroll: B()
      }],
      /**
       * Overscroll Behavior X
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-x": [{
        "overscroll-x": B()
      }],
      /**
       * Overscroll Behavior Y
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-y": [{
        "overscroll-y": B()
      }],
      /**
       * Position
       * @see https://tailwindcss.com/docs/position
       */
      position: ["static", "fixed", "absolute", "relative", "sticky"],
      /**
       * Top / Right / Bottom / Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      inset: [{
        inset: [w]
      }],
      /**
       * Right / Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-x": [{
        "inset-x": [w]
      }],
      /**
       * Top / Bottom
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-y": [{
        "inset-y": [w]
      }],
      /**
       * Start
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      start: [{
        start: [w]
      }],
      /**
       * End
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      end: [{
        end: [w]
      }],
      /**
       * Top
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      top: [{
        top: [w]
      }],
      /**
       * Right
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      right: [{
        right: [w]
      }],
      /**
       * Bottom
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      bottom: [{
        bottom: [w]
      }],
      /**
       * Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      left: [{
        left: [w]
      }],
      /**
       * Visibility
       * @see https://tailwindcss.com/docs/visibility
       */
      visibility: ["visible", "invisible", "collapse"],
      /**
       * Z-Index
       * @see https://tailwindcss.com/docs/z-index
       */
      z: [{
        z: ["auto", pt, _]
      }],
      // Flexbox and Grid
      /**
       * Flex Basis
       * @see https://tailwindcss.com/docs/flex-basis
       */
      basis: [{
        basis: F()
      }],
      /**
       * Flex Direction
       * @see https://tailwindcss.com/docs/flex-direction
       */
      "flex-direction": [{
        flex: ["row", "row-reverse", "col", "col-reverse"]
      }],
      /**
       * Flex Wrap
       * @see https://tailwindcss.com/docs/flex-wrap
       */
      "flex-wrap": [{
        flex: ["wrap", "wrap-reverse", "nowrap"]
      }],
      /**
       * Flex
       * @see https://tailwindcss.com/docs/flex
       */
      flex: [{
        flex: ["1", "auto", "initial", "none", _]
      }],
      /**
       * Flex Grow
       * @see https://tailwindcss.com/docs/flex-grow
       */
      grow: [{
        grow: se()
      }],
      /**
       * Flex Shrink
       * @see https://tailwindcss.com/docs/flex-shrink
       */
      shrink: [{
        shrink: se()
      }],
      /**
       * Order
       * @see https://tailwindcss.com/docs/order
       */
      order: [{
        order: ["first", "last", "none", pt, _]
      }],
      /**
       * Grid Template Columns
       * @see https://tailwindcss.com/docs/grid-template-columns
       */
      "grid-cols": [{
        "grid-cols": [mt]
      }],
      /**
       * Grid Column Start / End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start-end": [{
        col: ["auto", {
          span: ["full", pt, _]
        }, _]
      }],
      /**
       * Grid Column Start
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start": [{
        "col-start": z()
      }],
      /**
       * Grid Column End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-end": [{
        "col-end": z()
      }],
      /**
       * Grid Template Rows
       * @see https://tailwindcss.com/docs/grid-template-rows
       */
      "grid-rows": [{
        "grid-rows": [mt]
      }],
      /**
       * Grid Row Start / End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start-end": [{
        row: ["auto", {
          span: [pt, _]
        }, _]
      }],
      /**
       * Grid Row Start
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start": [{
        "row-start": z()
      }],
      /**
       * Grid Row End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-end": [{
        "row-end": z()
      }],
      /**
       * Grid Auto Flow
       * @see https://tailwindcss.com/docs/grid-auto-flow
       */
      "grid-flow": [{
        "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"]
      }],
      /**
       * Grid Auto Columns
       * @see https://tailwindcss.com/docs/grid-auto-columns
       */
      "auto-cols": [{
        "auto-cols": ["auto", "min", "max", "fr", _]
      }],
      /**
       * Grid Auto Rows
       * @see https://tailwindcss.com/docs/grid-auto-rows
       */
      "auto-rows": [{
        "auto-rows": ["auto", "min", "max", "fr", _]
      }],
      /**
       * Gap
       * @see https://tailwindcss.com/docs/gap
       */
      gap: [{
        gap: [p]
      }],
      /**
       * Gap X
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-x": [{
        "gap-x": [p]
      }],
      /**
       * Gap Y
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-y": [{
        "gap-y": [p]
      }],
      /**
       * Justify Content
       * @see https://tailwindcss.com/docs/justify-content
       */
      "justify-content": [{
        justify: ["normal", ...oe()]
      }],
      /**
       * Justify Items
       * @see https://tailwindcss.com/docs/justify-items
       */
      "justify-items": [{
        "justify-items": ["start", "end", "center", "stretch"]
      }],
      /**
       * Justify Self
       * @see https://tailwindcss.com/docs/justify-self
       */
      "justify-self": [{
        "justify-self": ["auto", "start", "end", "center", "stretch"]
      }],
      /**
       * Align Content
       * @see https://tailwindcss.com/docs/align-content
       */
      "align-content": [{
        content: ["normal", ...oe(), "baseline"]
      }],
      /**
       * Align Items
       * @see https://tailwindcss.com/docs/align-items
       */
      "align-items": [{
        items: ["start", "end", "center", "baseline", "stretch"]
      }],
      /**
       * Align Self
       * @see https://tailwindcss.com/docs/align-self
       */
      "align-self": [{
        self: ["auto", "start", "end", "center", "stretch", "baseline"]
      }],
      /**
       * Place Content
       * @see https://tailwindcss.com/docs/place-content
       */
      "place-content": [{
        "place-content": [...oe(), "baseline"]
      }],
      /**
       * Place Items
       * @see https://tailwindcss.com/docs/place-items
       */
      "place-items": [{
        "place-items": ["start", "end", "center", "baseline", "stretch"]
      }],
      /**
       * Place Self
       * @see https://tailwindcss.com/docs/place-self
       */
      "place-self": [{
        "place-self": ["auto", "start", "end", "center", "stretch"]
      }],
      // Spacing
      /**
       * Padding
       * @see https://tailwindcss.com/docs/padding
       */
      p: [{
        p: [S]
      }],
      /**
       * Padding X
       * @see https://tailwindcss.com/docs/padding
       */
      px: [{
        px: [S]
      }],
      /**
       * Padding Y
       * @see https://tailwindcss.com/docs/padding
       */
      py: [{
        py: [S]
      }],
      /**
       * Padding Start
       * @see https://tailwindcss.com/docs/padding
       */
      ps: [{
        ps: [S]
      }],
      /**
       * Padding End
       * @see https://tailwindcss.com/docs/padding
       */
      pe: [{
        pe: [S]
      }],
      /**
       * Padding Top
       * @see https://tailwindcss.com/docs/padding
       */
      pt: [{
        pt: [S]
      }],
      /**
       * Padding Right
       * @see https://tailwindcss.com/docs/padding
       */
      pr: [{
        pr: [S]
      }],
      /**
       * Padding Bottom
       * @see https://tailwindcss.com/docs/padding
       */
      pb: [{
        pb: [S]
      }],
      /**
       * Padding Left
       * @see https://tailwindcss.com/docs/padding
       */
      pl: [{
        pl: [S]
      }],
      /**
       * Margin
       * @see https://tailwindcss.com/docs/margin
       */
      m: [{
        m: [k]
      }],
      /**
       * Margin X
       * @see https://tailwindcss.com/docs/margin
       */
      mx: [{
        mx: [k]
      }],
      /**
       * Margin Y
       * @see https://tailwindcss.com/docs/margin
       */
      my: [{
        my: [k]
      }],
      /**
       * Margin Start
       * @see https://tailwindcss.com/docs/margin
       */
      ms: [{
        ms: [k]
      }],
      /**
       * Margin End
       * @see https://tailwindcss.com/docs/margin
       */
      me: [{
        me: [k]
      }],
      /**
       * Margin Top
       * @see https://tailwindcss.com/docs/margin
       */
      mt: [{
        mt: [k]
      }],
      /**
       * Margin Right
       * @see https://tailwindcss.com/docs/margin
       */
      mr: [{
        mr: [k]
      }],
      /**
       * Margin Bottom
       * @see https://tailwindcss.com/docs/margin
       */
      mb: [{
        mb: [k]
      }],
      /**
       * Margin Left
       * @see https://tailwindcss.com/docs/margin
       */
      ml: [{
        ml: [k]
      }],
      /**
       * Space Between X
       * @see https://tailwindcss.com/docs/space
       */
      "space-x": [{
        "space-x": [V]
      }],
      /**
       * Space Between X Reverse
       * @see https://tailwindcss.com/docs/space
       */
      "space-x-reverse": ["space-x-reverse"],
      /**
       * Space Between Y
       * @see https://tailwindcss.com/docs/space
       */
      "space-y": [{
        "space-y": [V]
      }],
      /**
       * Space Between Y Reverse
       * @see https://tailwindcss.com/docs/space
       */
      "space-y-reverse": ["space-y-reverse"],
      // Sizing
      /**
       * Width
       * @see https://tailwindcss.com/docs/width
       */
      w: [{
        w: ["auto", "min", "max", "fit", "svw", "lvw", "dvw", _, t]
      }],
      /**
       * Min-Width
       * @see https://tailwindcss.com/docs/min-width
       */
      "min-w": [{
        "min-w": [_, t, "min", "max", "fit"]
      }],
      /**
       * Max-Width
       * @see https://tailwindcss.com/docs/max-width
       */
      "max-w": [{
        "max-w": [_, t, "none", "full", "min", "max", "fit", "prose", {
          screen: [He]
        }, He]
      }],
      /**
       * Height
       * @see https://tailwindcss.com/docs/height
       */
      h: [{
        h: [_, t, "auto", "min", "max", "fit", "svh", "lvh", "dvh"]
      }],
      /**
       * Min-Height
       * @see https://tailwindcss.com/docs/min-height
       */
      "min-h": [{
        "min-h": [_, t, "min", "max", "fit", "svh", "lvh", "dvh"]
      }],
      /**
       * Max-Height
       * @see https://tailwindcss.com/docs/max-height
       */
      "max-h": [{
        "max-h": [_, t, "min", "max", "fit", "svh", "lvh", "dvh"]
      }],
      /**
       * Size
       * @see https://tailwindcss.com/docs/size
       */
      size: [{
        size: [_, t, "auto", "min", "max", "fit"]
      }],
      // Typography
      /**
       * Font Size
       * @see https://tailwindcss.com/docs/font-size
       */
      "font-size": [{
        text: ["base", He, ze]
      }],
      /**
       * Font Smoothing
       * @see https://tailwindcss.com/docs/font-smoothing
       */
      "font-smoothing": ["antialiased", "subpixel-antialiased"],
      /**
       * Font Style
       * @see https://tailwindcss.com/docs/font-style
       */
      "font-style": ["italic", "not-italic"],
      /**
       * Font Weight
       * @see https://tailwindcss.com/docs/font-weight
       */
      "font-weight": [{
        font: ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black", yn]
      }],
      /**
       * Font Family
       * @see https://tailwindcss.com/docs/font-family
       */
      "font-family": [{
        font: [mt]
      }],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-normal": ["normal-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-ordinal": ["ordinal"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-slashed-zero": ["slashed-zero"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-figure": ["lining-nums", "oldstyle-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-spacing": ["proportional-nums", "tabular-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
      /**
       * Letter Spacing
       * @see https://tailwindcss.com/docs/letter-spacing
       */
      tracking: [{
        tracking: ["tighter", "tight", "normal", "wide", "wider", "widest", _]
      }],
      /**
       * Line Clamp
       * @see https://tailwindcss.com/docs/line-clamp
       */
      "line-clamp": [{
        "line-clamp": ["none", nt, yn]
      }],
      /**
       * Line Height
       * @see https://tailwindcss.com/docs/line-height
       */
      leading: [{
        leading: ["none", "tight", "snug", "normal", "relaxed", "loose", Me, _]
      }],
      /**
       * List Style Image
       * @see https://tailwindcss.com/docs/list-style-image
       */
      "list-image": [{
        "list-image": ["none", _]
      }],
      /**
       * List Style Type
       * @see https://tailwindcss.com/docs/list-style-type
       */
      "list-style-type": [{
        list: ["none", "disc", "decimal", _]
      }],
      /**
       * List Style Position
       * @see https://tailwindcss.com/docs/list-style-position
       */
      "list-style-position": [{
        list: ["inside", "outside"]
      }],
      /**
       * Placeholder Color
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://tailwindcss.com/docs/placeholder-color
       */
      "placeholder-color": [{
        placeholder: [e]
      }],
      /**
       * Placeholder Opacity
       * @see https://tailwindcss.com/docs/placeholder-opacity
       */
      "placeholder-opacity": [{
        "placeholder-opacity": [x]
      }],
      /**
       * Text Alignment
       * @see https://tailwindcss.com/docs/text-align
       */
      "text-alignment": [{
        text: ["left", "center", "right", "justify", "start", "end"]
      }],
      /**
       * Text Color
       * @see https://tailwindcss.com/docs/text-color
       */
      "text-color": [{
        text: [e]
      }],
      /**
       * Text Opacity
       * @see https://tailwindcss.com/docs/text-opacity
       */
      "text-opacity": [{
        "text-opacity": [x]
      }],
      /**
       * Text Decoration
       * @see https://tailwindcss.com/docs/text-decoration
       */
      "text-decoration": ["underline", "overline", "line-through", "no-underline"],
      /**
       * Text Decoration Style
       * @see https://tailwindcss.com/docs/text-decoration-style
       */
      "text-decoration-style": [{
        decoration: [...W(), "wavy"]
      }],
      /**
       * Text Decoration Thickness
       * @see https://tailwindcss.com/docs/text-decoration-thickness
       */
      "text-decoration-thickness": [{
        decoration: ["auto", "from-font", Me, ze]
      }],
      /**
       * Text Underline Offset
       * @see https://tailwindcss.com/docs/text-underline-offset
       */
      "underline-offset": [{
        "underline-offset": ["auto", Me, _]
      }],
      /**
       * Text Decoration Color
       * @see https://tailwindcss.com/docs/text-decoration-color
       */
      "text-decoration-color": [{
        decoration: [e]
      }],
      /**
       * Text Transform
       * @see https://tailwindcss.com/docs/text-transform
       */
      "text-transform": ["uppercase", "lowercase", "capitalize", "normal-case"],
      /**
       * Text Overflow
       * @see https://tailwindcss.com/docs/text-overflow
       */
      "text-overflow": ["truncate", "text-ellipsis", "text-clip"],
      /**
       * Text Wrap
       * @see https://tailwindcss.com/docs/text-wrap
       */
      "text-wrap": [{
        text: ["wrap", "nowrap", "balance", "pretty"]
      }],
      /**
       * Text Indent
       * @see https://tailwindcss.com/docs/text-indent
       */
      indent: [{
        indent: L()
      }],
      /**
       * Vertical Alignment
       * @see https://tailwindcss.com/docs/vertical-align
       */
      "vertical-align": [{
        align: ["baseline", "top", "middle", "bottom", "text-top", "text-bottom", "sub", "super", _]
      }],
      /**
       * Whitespace
       * @see https://tailwindcss.com/docs/whitespace
       */
      whitespace: [{
        whitespace: ["normal", "nowrap", "pre", "pre-line", "pre-wrap", "break-spaces"]
      }],
      /**
       * Word Break
       * @see https://tailwindcss.com/docs/word-break
       */
      break: [{
        break: ["normal", "words", "all", "keep"]
      }],
      /**
       * Hyphens
       * @see https://tailwindcss.com/docs/hyphens
       */
      hyphens: [{
        hyphens: ["none", "manual", "auto"]
      }],
      /**
       * Content
       * @see https://tailwindcss.com/docs/content
       */
      content: [{
        content: ["none", _]
      }],
      // Backgrounds
      /**
       * Background Attachment
       * @see https://tailwindcss.com/docs/background-attachment
       */
      "bg-attachment": [{
        bg: ["fixed", "local", "scroll"]
      }],
      /**
       * Background Clip
       * @see https://tailwindcss.com/docs/background-clip
       */
      "bg-clip": [{
        "bg-clip": ["border", "padding", "content", "text"]
      }],
      /**
       * Background Opacity
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://tailwindcss.com/docs/background-opacity
       */
      "bg-opacity": [{
        "bg-opacity": [x]
      }],
      /**
       * Background Origin
       * @see https://tailwindcss.com/docs/background-origin
       */
      "bg-origin": [{
        "bg-origin": ["border", "padding", "content"]
      }],
      /**
       * Background Position
       * @see https://tailwindcss.com/docs/background-position
       */
      "bg-position": [{
        bg: [...T(), W2]
      }],
      /**
       * Background Repeat
       * @see https://tailwindcss.com/docs/background-repeat
       */
      "bg-repeat": [{
        bg: ["no-repeat", {
          repeat: ["", "x", "y", "round", "space"]
        }]
      }],
      /**
       * Background Size
       * @see https://tailwindcss.com/docs/background-size
       */
      "bg-size": [{
        bg: ["auto", "cover", "contain", U2]
      }],
      /**
       * Background Image
       * @see https://tailwindcss.com/docs/background-image
       */
      "bg-image": [{
        bg: ["none", {
          "gradient-to": ["t", "tr", "r", "br", "b", "bl", "l", "tl"]
        }, G2]
      }],
      /**
       * Background Color
       * @see https://tailwindcss.com/docs/background-color
       */
      "bg-color": [{
        bg: [e]
      }],
      /**
       * Gradient Color Stops From Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from-pos": [{
        from: [m]
      }],
      /**
       * Gradient Color Stops Via Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via-pos": [{
        via: [m]
      }],
      /**
       * Gradient Color Stops To Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to-pos": [{
        to: [m]
      }],
      /**
       * Gradient Color Stops From
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from": [{
        from: [d]
      }],
      /**
       * Gradient Color Stops Via
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via": [{
        via: [d]
      }],
      /**
       * Gradient Color Stops To
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to": [{
        to: [d]
      }],
      // Borders
      /**
       * Border Radius
       * @see https://tailwindcss.com/docs/border-radius
       */
      rounded: [{
        rounded: [a]
      }],
      /**
       * Border Radius Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-s": [{
        "rounded-s": [a]
      }],
      /**
       * Border Radius End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-e": [{
        "rounded-e": [a]
      }],
      /**
       * Border Radius Top
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-t": [{
        "rounded-t": [a]
      }],
      /**
       * Border Radius Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-r": [{
        "rounded-r": [a]
      }],
      /**
       * Border Radius Bottom
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-b": [{
        "rounded-b": [a]
      }],
      /**
       * Border Radius Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-l": [{
        "rounded-l": [a]
      }],
      /**
       * Border Radius Start Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ss": [{
        "rounded-ss": [a]
      }],
      /**
       * Border Radius Start End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-se": [{
        "rounded-se": [a]
      }],
      /**
       * Border Radius End End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ee": [{
        "rounded-ee": [a]
      }],
      /**
       * Border Radius End Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-es": [{
        "rounded-es": [a]
      }],
      /**
       * Border Radius Top Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tl": [{
        "rounded-tl": [a]
      }],
      /**
       * Border Radius Top Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tr": [{
        "rounded-tr": [a]
      }],
      /**
       * Border Radius Bottom Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-br": [{
        "rounded-br": [a]
      }],
      /**
       * Border Radius Bottom Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-bl": [{
        "rounded-bl": [a]
      }],
      /**
       * Border Width
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w": [{
        border: [o]
      }],
      /**
       * Border Width X
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-x": [{
        "border-x": [o]
      }],
      /**
       * Border Width Y
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-y": [{
        "border-y": [o]
      }],
      /**
       * Border Width Start
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-s": [{
        "border-s": [o]
      }],
      /**
       * Border Width End
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-e": [{
        "border-e": [o]
      }],
      /**
       * Border Width Top
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-t": [{
        "border-t": [o]
      }],
      /**
       * Border Width Right
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-r": [{
        "border-r": [o]
      }],
      /**
       * Border Width Bottom
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-b": [{
        "border-b": [o]
      }],
      /**
       * Border Width Left
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-l": [{
        "border-l": [o]
      }],
      /**
       * Border Opacity
       * @see https://tailwindcss.com/docs/border-opacity
       */
      "border-opacity": [{
        "border-opacity": [x]
      }],
      /**
       * Border Style
       * @see https://tailwindcss.com/docs/border-style
       */
      "border-style": [{
        border: [...W(), "hidden"]
      }],
      /**
       * Divide Width X
       * @see https://tailwindcss.com/docs/divide-width
       */
      "divide-x": [{
        "divide-x": [o]
      }],
      /**
       * Divide Width X Reverse
       * @see https://tailwindcss.com/docs/divide-width
       */
      "divide-x-reverse": ["divide-x-reverse"],
      /**
       * Divide Width Y
       * @see https://tailwindcss.com/docs/divide-width
       */
      "divide-y": [{
        "divide-y": [o]
      }],
      /**
       * Divide Width Y Reverse
       * @see https://tailwindcss.com/docs/divide-width
       */
      "divide-y-reverse": ["divide-y-reverse"],
      /**
       * Divide Opacity
       * @see https://tailwindcss.com/docs/divide-opacity
       */
      "divide-opacity": [{
        "divide-opacity": [x]
      }],
      /**
       * Divide Style
       * @see https://tailwindcss.com/docs/divide-style
       */
      "divide-style": [{
        divide: W()
      }],
      /**
       * Border Color
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color": [{
        border: [i]
      }],
      /**
       * Border Color X
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-x": [{
        "border-x": [i]
      }],
      /**
       * Border Color Y
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-y": [{
        "border-y": [i]
      }],
      /**
       * Border Color S
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-s": [{
        "border-s": [i]
      }],
      /**
       * Border Color E
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-e": [{
        "border-e": [i]
      }],
      /**
       * Border Color Top
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-t": [{
        "border-t": [i]
      }],
      /**
       * Border Color Right
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-r": [{
        "border-r": [i]
      }],
      /**
       * Border Color Bottom
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-b": [{
        "border-b": [i]
      }],
      /**
       * Border Color Left
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-l": [{
        "border-l": [i]
      }],
      /**
       * Divide Color
       * @see https://tailwindcss.com/docs/divide-color
       */
      "divide-color": [{
        divide: [i]
      }],
      /**
       * Outline Style
       * @see https://tailwindcss.com/docs/outline-style
       */
      "outline-style": [{
        outline: ["", ...W()]
      }],
      /**
       * Outline Offset
       * @see https://tailwindcss.com/docs/outline-offset
       */
      "outline-offset": [{
        "outline-offset": [Me, _]
      }],
      /**
       * Outline Width
       * @see https://tailwindcss.com/docs/outline-width
       */
      "outline-w": [{
        outline: [Me, ze]
      }],
      /**
       * Outline Color
       * @see https://tailwindcss.com/docs/outline-color
       */
      "outline-color": [{
        outline: [e]
      }],
      /**
       * Ring Width
       * @see https://tailwindcss.com/docs/ring-width
       */
      "ring-w": [{
        ring: q()
      }],
      /**
       * Ring Width Inset
       * @see https://tailwindcss.com/docs/ring-width
       */
      "ring-w-inset": ["ring-inset"],
      /**
       * Ring Color
       * @see https://tailwindcss.com/docs/ring-color
       */
      "ring-color": [{
        ring: [e]
      }],
      /**
       * Ring Opacity
       * @see https://tailwindcss.com/docs/ring-opacity
       */
      "ring-opacity": [{
        "ring-opacity": [x]
      }],
      /**
       * Ring Offset Width
       * @see https://tailwindcss.com/docs/ring-offset-width
       */
      "ring-offset-w": [{
        "ring-offset": [Me, ze]
      }],
      /**
       * Ring Offset Color
       * @see https://tailwindcss.com/docs/ring-offset-color
       */
      "ring-offset-color": [{
        "ring-offset": [e]
      }],
      // Effects
      /**
       * Box Shadow
       * @see https://tailwindcss.com/docs/box-shadow
       */
      shadow: [{
        shadow: ["", "inner", "none", He, Y2]
      }],
      /**
       * Box Shadow Color
       * @see https://tailwindcss.com/docs/box-shadow-color
       */
      "shadow-color": [{
        shadow: [mt]
      }],
      /**
       * Opacity
       * @see https://tailwindcss.com/docs/opacity
       */
      opacity: [{
        opacity: [x]
      }],
      /**
       * Mix Blend Mode
       * @see https://tailwindcss.com/docs/mix-blend-mode
       */
      "mix-blend": [{
        "mix-blend": [...K(), "plus-lighter", "plus-darker"]
      }],
      /**
       * Background Blend Mode
       * @see https://tailwindcss.com/docs/background-blend-mode
       */
      "bg-blend": [{
        "bg-blend": K()
      }],
      // Filters
      /**
       * Filter
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://tailwindcss.com/docs/filter
       */
      filter: [{
        filter: ["", "none"]
      }],
      /**
       * Blur
       * @see https://tailwindcss.com/docs/blur
       */
      blur: [{
        blur: [n]
      }],
      /**
       * Brightness
       * @see https://tailwindcss.com/docs/brightness
       */
      brightness: [{
        brightness: [r]
      }],
      /**
       * Contrast
       * @see https://tailwindcss.com/docs/contrast
       */
      contrast: [{
        contrast: [s]
      }],
      /**
       * Drop Shadow
       * @see https://tailwindcss.com/docs/drop-shadow
       */
      "drop-shadow": [{
        "drop-shadow": ["", "none", He, _]
      }],
      /**
       * Grayscale
       * @see https://tailwindcss.com/docs/grayscale
       */
      grayscale: [{
        grayscale: [u]
      }],
      /**
       * Hue Rotate
       * @see https://tailwindcss.com/docs/hue-rotate
       */
      "hue-rotate": [{
        "hue-rotate": [f]
      }],
      /**
       * Invert
       * @see https://tailwindcss.com/docs/invert
       */
      invert: [{
        invert: [c]
      }],
      /**
       * Saturate
       * @see https://tailwindcss.com/docs/saturate
       */
      saturate: [{
        saturate: [C]
      }],
      /**
       * Sepia
       * @see https://tailwindcss.com/docs/sepia
       */
      sepia: [{
        sepia: [Z]
      }],
      /**
       * Backdrop Filter
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://tailwindcss.com/docs/backdrop-filter
       */
      "backdrop-filter": [{
        "backdrop-filter": ["", "none"]
      }],
      /**
       * Backdrop Blur
       * @see https://tailwindcss.com/docs/backdrop-blur
       */
      "backdrop-blur": [{
        "backdrop-blur": [n]
      }],
      /**
       * Backdrop Brightness
       * @see https://tailwindcss.com/docs/backdrop-brightness
       */
      "backdrop-brightness": [{
        "backdrop-brightness": [r]
      }],
      /**
       * Backdrop Contrast
       * @see https://tailwindcss.com/docs/backdrop-contrast
       */
      "backdrop-contrast": [{
        "backdrop-contrast": [s]
      }],
      /**
       * Backdrop Grayscale
       * @see https://tailwindcss.com/docs/backdrop-grayscale
       */
      "backdrop-grayscale": [{
        "backdrop-grayscale": [u]
      }],
      /**
       * Backdrop Hue Rotate
       * @see https://tailwindcss.com/docs/backdrop-hue-rotate
       */
      "backdrop-hue-rotate": [{
        "backdrop-hue-rotate": [f]
      }],
      /**
       * Backdrop Invert
       * @see https://tailwindcss.com/docs/backdrop-invert
       */
      "backdrop-invert": [{
        "backdrop-invert": [c]
      }],
      /**
       * Backdrop Opacity
       * @see https://tailwindcss.com/docs/backdrop-opacity
       */
      "backdrop-opacity": [{
        "backdrop-opacity": [x]
      }],
      /**
       * Backdrop Saturate
       * @see https://tailwindcss.com/docs/backdrop-saturate
       */
      "backdrop-saturate": [{
        "backdrop-saturate": [C]
      }],
      /**
       * Backdrop Sepia
       * @see https://tailwindcss.com/docs/backdrop-sepia
       */
      "backdrop-sepia": [{
        "backdrop-sepia": [Z]
      }],
      // Tables
      /**
       * Border Collapse
       * @see https://tailwindcss.com/docs/border-collapse
       */
      "border-collapse": [{
        border: ["collapse", "separate"]
      }],
      /**
       * Border Spacing
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing": [{
        "border-spacing": [l]
      }],
      /**
       * Border Spacing X
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-x": [{
        "border-spacing-x": [l]
      }],
      /**
       * Border Spacing Y
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-y": [{
        "border-spacing-y": [l]
      }],
      /**
       * Table Layout
       * @see https://tailwindcss.com/docs/table-layout
       */
      "table-layout": [{
        table: ["auto", "fixed"]
      }],
      /**
       * Caption Side
       * @see https://tailwindcss.com/docs/caption-side
       */
      caption: [{
        caption: ["top", "bottom"]
      }],
      // Transitions and Animation
      /**
       * Tranisition Property
       * @see https://tailwindcss.com/docs/transition-property
       */
      transition: [{
        transition: ["none", "all", "", "colors", "opacity", "shadow", "transform", _]
      }],
      /**
       * Transition Duration
       * @see https://tailwindcss.com/docs/transition-duration
       */
      duration: [{
        duration: ee()
      }],
      /**
       * Transition Timing Function
       * @see https://tailwindcss.com/docs/transition-timing-function
       */
      ease: [{
        ease: ["linear", "in", "out", "in-out", _]
      }],
      /**
       * Transition Delay
       * @see https://tailwindcss.com/docs/transition-delay
       */
      delay: [{
        delay: ee()
      }],
      /**
       * Animation
       * @see https://tailwindcss.com/docs/animation
       */
      animate: [{
        animate: ["none", "spin", "ping", "pulse", "bounce", _]
      }],
      // Transforms
      /**
       * Transform
       * @see https://tailwindcss.com/docs/transform
       */
      transform: [{
        transform: ["", "gpu", "none"]
      }],
      /**
       * Scale
       * @see https://tailwindcss.com/docs/scale
       */
      scale: [{
        scale: [H]
      }],
      /**
       * Scale X
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-x": [{
        "scale-x": [H]
      }],
      /**
       * Scale Y
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-y": [{
        "scale-y": [H]
      }],
      /**
       * Rotate
       * @see https://tailwindcss.com/docs/rotate
       */
      rotate: [{
        rotate: [pt, _]
      }],
      /**
       * Translate X
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-x": [{
        "translate-x": [$]
      }],
      /**
       * Translate Y
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-y": [{
        "translate-y": [$]
      }],
      /**
       * Skew X
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-x": [{
        "skew-x": [v]
      }],
      /**
       * Skew Y
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-y": [{
        "skew-y": [v]
      }],
      /**
       * Transform Origin
       * @see https://tailwindcss.com/docs/transform-origin
       */
      "transform-origin": [{
        origin: ["center", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "top-left", _]
      }],
      // Interactivity
      /**
       * Accent Color
       * @see https://tailwindcss.com/docs/accent-color
       */
      accent: [{
        accent: ["auto", e]
      }],
      /**
       * Appearance
       * @see https://tailwindcss.com/docs/appearance
       */
      appearance: [{
        appearance: ["none", "auto"]
      }],
      /**
       * Cursor
       * @see https://tailwindcss.com/docs/cursor
       */
      cursor: [{
        cursor: ["auto", "default", "pointer", "wait", "text", "move", "help", "not-allowed", "none", "context-menu", "progress", "cell", "crosshair", "vertical-text", "alias", "copy", "no-drop", "grab", "grabbing", "all-scroll", "col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out", _]
      }],
      /**
       * Caret Color
       * @see https://tailwindcss.com/docs/just-in-time-mode#caret-color-utilities
       */
      "caret-color": [{
        caret: [e]
      }],
      /**
       * Pointer Events
       * @see https://tailwindcss.com/docs/pointer-events
       */
      "pointer-events": [{
        "pointer-events": ["none", "auto"]
      }],
      /**
       * Resize
       * @see https://tailwindcss.com/docs/resize
       */
      resize: [{
        resize: ["none", "y", "x", ""]
      }],
      /**
       * Scroll Behavior
       * @see https://tailwindcss.com/docs/scroll-behavior
       */
      "scroll-behavior": [{
        scroll: ["auto", "smooth"]
      }],
      /**
       * Scroll Margin
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-m": [{
        "scroll-m": L()
      }],
      /**
       * Scroll Margin X
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mx": [{
        "scroll-mx": L()
      }],
      /**
       * Scroll Margin Y
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-my": [{
        "scroll-my": L()
      }],
      /**
       * Scroll Margin Start
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ms": [{
        "scroll-ms": L()
      }],
      /**
       * Scroll Margin End
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-me": [{
        "scroll-me": L()
      }],
      /**
       * Scroll Margin Top
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mt": [{
        "scroll-mt": L()
      }],
      /**
       * Scroll Margin Right
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mr": [{
        "scroll-mr": L()
      }],
      /**
       * Scroll Margin Bottom
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mb": [{
        "scroll-mb": L()
      }],
      /**
       * Scroll Margin Left
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ml": [{
        "scroll-ml": L()
      }],
      /**
       * Scroll Padding
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-p": [{
        "scroll-p": L()
      }],
      /**
       * Scroll Padding X
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-px": [{
        "scroll-px": L()
      }],
      /**
       * Scroll Padding Y
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-py": [{
        "scroll-py": L()
      }],
      /**
       * Scroll Padding Start
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-ps": [{
        "scroll-ps": L()
      }],
      /**
       * Scroll Padding End
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pe": [{
        "scroll-pe": L()
      }],
      /**
       * Scroll Padding Top
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pt": [{
        "scroll-pt": L()
      }],
      /**
       * Scroll Padding Right
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pr": [{
        "scroll-pr": L()
      }],
      /**
       * Scroll Padding Bottom
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pb": [{
        "scroll-pb": L()
      }],
      /**
       * Scroll Padding Left
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pl": [{
        "scroll-pl": L()
      }],
      /**
       * Scroll Snap Align
       * @see https://tailwindcss.com/docs/scroll-snap-align
       */
      "snap-align": [{
        snap: ["start", "end", "center", "align-none"]
      }],
      /**
       * Scroll Snap Stop
       * @see https://tailwindcss.com/docs/scroll-snap-stop
       */
      "snap-stop": [{
        snap: ["normal", "always"]
      }],
      /**
       * Scroll Snap Type
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-type": [{
        snap: ["none", "x", "y", "both"]
      }],
      /**
       * Scroll Snap Type Strictness
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-strictness": [{
        snap: ["mandatory", "proximity"]
      }],
      /**
       * Touch Action
       * @see https://tailwindcss.com/docs/touch-action
       */
      touch: [{
        touch: ["auto", "none", "manipulation"]
      }],
      /**
       * Touch Action X
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-x": [{
        "touch-pan": ["x", "left", "right"]
      }],
      /**
       * Touch Action Y
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-y": [{
        "touch-pan": ["y", "up", "down"]
      }],
      /**
       * Touch Action Pinch Zoom
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-pz": ["touch-pinch-zoom"],
      /**
       * User Select
       * @see https://tailwindcss.com/docs/user-select
       */
      select: [{
        select: ["none", "text", "all", "auto"]
      }],
      /**
       * Will Change
       * @see https://tailwindcss.com/docs/will-change
       */
      "will-change": [{
        "will-change": ["auto", "scroll", "contents", "transform", _]
      }],
      // SVG
      /**
       * Fill
       * @see https://tailwindcss.com/docs/fill
       */
      fill: [{
        fill: [e, "none"]
      }],
      /**
       * Stroke Width
       * @see https://tailwindcss.com/docs/stroke-width
       */
      "stroke-w": [{
        stroke: [Me, ze, yn]
      }],
      /**
       * Stroke
       * @see https://tailwindcss.com/docs/stroke
       */
      stroke: [{
        stroke: [e, "none"]
      }],
      // Accessibility
      /**
       * Screen Readers
       * @see https://tailwindcss.com/docs/screen-readers
       */
      sr: ["sr-only", "not-sr-only"],
      /**
       * Forced Color Adjust
       * @see https://tailwindcss.com/docs/forced-color-adjust
       */
      "forced-color-adjust": [{
        "forced-color-adjust": ["auto", "none"]
      }]
    },
    conflictingClassGroups: {
      overflow: ["overflow-x", "overflow-y"],
      overscroll: ["overscroll-x", "overscroll-y"],
      inset: ["inset-x", "inset-y", "start", "end", "top", "right", "bottom", "left"],
      "inset-x": ["right", "left"],
      "inset-y": ["top", "bottom"],
      flex: ["basis", "grow", "shrink"],
      gap: ["gap-x", "gap-y"],
      p: ["px", "py", "ps", "pe", "pt", "pr", "pb", "pl"],
      px: ["pr", "pl"],
      py: ["pt", "pb"],
      m: ["mx", "my", "ms", "me", "mt", "mr", "mb", "ml"],
      mx: ["mr", "ml"],
      my: ["mt", "mb"],
      size: ["w", "h"],
      "font-size": ["leading"],
      "fvn-normal": ["fvn-ordinal", "fvn-slashed-zero", "fvn-figure", "fvn-spacing", "fvn-fraction"],
      "fvn-ordinal": ["fvn-normal"],
      "fvn-slashed-zero": ["fvn-normal"],
      "fvn-figure": ["fvn-normal"],
      "fvn-spacing": ["fvn-normal"],
      "fvn-fraction": ["fvn-normal"],
      "line-clamp": ["display", "overflow"],
      rounded: ["rounded-s", "rounded-e", "rounded-t", "rounded-r", "rounded-b", "rounded-l", "rounded-ss", "rounded-se", "rounded-ee", "rounded-es", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
      "rounded-s": ["rounded-ss", "rounded-es"],
      "rounded-e": ["rounded-se", "rounded-ee"],
      "rounded-t": ["rounded-tl", "rounded-tr"],
      "rounded-r": ["rounded-tr", "rounded-br"],
      "rounded-b": ["rounded-br", "rounded-bl"],
      "rounded-l": ["rounded-tl", "rounded-bl"],
      "border-spacing": ["border-spacing-x", "border-spacing-y"],
      "border-w": ["border-w-s", "border-w-e", "border-w-t", "border-w-r", "border-w-b", "border-w-l"],
      "border-w-x": ["border-w-r", "border-w-l"],
      "border-w-y": ["border-w-t", "border-w-b"],
      "border-color": ["border-color-s", "border-color-e", "border-color-t", "border-color-r", "border-color-b", "border-color-l"],
      "border-color-x": ["border-color-r", "border-color-l"],
      "border-color-y": ["border-color-t", "border-color-b"],
      "scroll-m": ["scroll-mx", "scroll-my", "scroll-ms", "scroll-me", "scroll-mt", "scroll-mr", "scroll-mb", "scroll-ml"],
      "scroll-mx": ["scroll-mr", "scroll-ml"],
      "scroll-my": ["scroll-mt", "scroll-mb"],
      "scroll-p": ["scroll-px", "scroll-py", "scroll-ps", "scroll-pe", "scroll-pt", "scroll-pr", "scroll-pb", "scroll-pl"],
      "scroll-px": ["scroll-pr", "scroll-pl"],
      "scroll-py": ["scroll-pt", "scroll-pb"],
      touch: ["touch-x", "touch-y", "touch-pz"],
      "touch-x": ["touch"],
      "touch-y": ["touch"],
      "touch-pz": ["touch"]
    },
    conflictingClassGroupModifiers: {
      "font-size": ["leading"]
    }
  };
}, ef = /* @__PURE__ */ P2(K2);
function Ue(...e) {
  return ef(Dl(e));
}
const tf = A2(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
), Et = h.forwardRef(
  ({ className: e, variant: t, size: n, asChild: r = !1, ...i }, a) => /* @__PURE__ */ b(
    r ? h2 : "button",
    {
      className: Ue(tf({ variant: t, size: n, className: e })),
      ref: a,
      ...i
    }
  )
);
Et.displayName = "Button";
const nf = "journal_entries", ie = {
  title: "Name",
  date: "Date",
  morningMood: "Morning Mood",
  morningMoodWord: "Morning Mood Word",
  morningFeeling: "Morning Feeling",
  energy: "Energy",
  motivation: "Motivation",
  gratitude1: "Gratitude 1",
  gratitude2: "Gratitude 2",
  gratitude3: "Gratitude 3",
  intention: "Intention",
  affirmation: "Affirmation",
  dayMood: "Day Mood",
  dayMoodWord: "Day Mood Word",
  highlight: "Highlight",
  lesson: "Lesson"
}, or = [
  { value: 1, label: "Very unpleasant", color: "#8b5cf6", soft: "rgba(139,92,246,0.15)" },
  { value: 2, label: "Unpleasant", color: "#6366f1", soft: "rgba(99,102,241,0.15)" },
  { value: 3, label: "Slightly unpleasant", color: "#3b82f6", soft: "rgba(59,130,246,0.15)" },
  { value: 4, label: "Neutral", color: "#0ea5e9", soft: "rgba(14,165,233,0.15)" },
  { value: 5, label: "Slightly pleasant", color: "#14b8a6", soft: "rgba(20,184,166,0.15)" },
  { value: 6, label: "Pleasant", color: "#10b981", soft: "rgba(16,185,129,0.15)" },
  { value: 7, label: "Very pleasant", color: "#f59e0b", soft: "rgba(245,158,11,0.17)" }
];
function Ne(e) {
  if (e == null) return null;
  const t = Math.round(e);
  return or.find((n) => n.value === t) ?? null;
}
const In = "#f59e0b", Tn = "#3b82f6", Fn = "#f59e0b", zn = "#6366f1";
function pe(e) {
  return typeof e == "string" && e.trim().length > 0 ? e.trim() : null;
}
function Pt(e) {
  return typeof e == "number" && Number.isFinite(e) ? e : null;
}
function rf(e) {
  const t = e.properties;
  return {
    id: e.id,
    title: pe(t[ie.title]) ?? pe(e.title) ?? "Untitled entry",
    date: pe(t[ie.date]),
    morningMood: Pt(t[ie.morningMood]),
    morningMoodWord: pe(t[ie.morningMoodWord]),
    morningFeeling: pe(t[ie.morningFeeling]),
    energy: Pt(t[ie.energy]),
    motivation: Pt(t[ie.motivation]),
    gratitudes: [
      pe(t[ie.gratitude1]),
      pe(t[ie.gratitude2]),
      pe(t[ie.gratitude3])
    ],
    intention: pe(t[ie.intention]),
    affirmation: pe(t[ie.affirmation]),
    dayMood: Pt(t[ie.dayMood]),
    dayMoodWord: pe(t[ie.dayMoodWord]),
    highlight: pe(t[ie.highlight]),
    lesson: pe(t[ie.lesson]),
    freeEntry: e.contentMarkdown ?? e.plainText ?? null,
    createdAt: e.createdAt ?? null,
    lastEditedTime: e.lastEditedTime ?? null
  };
}
function lf(e) {
  return [...e].sort((t, n) => {
    const r = t.date ?? t.createdAt ?? "", i = n.date ?? n.createdAt ?? "";
    return r < i ? 1 : r > i ? -1 : 0;
  });
}
function sr(e) {
  return e.gratitudes.filter(Boolean).length;
}
function jl(e) {
  return e.morningMood != null || e.morningMoodWord != null || e.morningFeeling != null || e.energy != null || e.motivation != null || sr(e) > 0 || e.intention != null || e.affirmation != null;
}
function $l(e) {
  return e.morningMood != null && e.morningMoodWord != null && e.energy != null && e.motivation != null && sr(e) === 3 && e.intention != null && e.affirmation != null;
}
function Ul(e) {
  return e.dayMood != null || e.dayMoodWord != null || e.highlight != null || e.lesson != null;
}
function Wl(e) {
  return e.dayMood != null && e.dayMoodWord != null && e.highlight != null && e.lesson != null;
}
function Qt(e) {
  if (!e) return null;
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e);
  if (t) {
    const [, r, i, a] = t, l = new Date(Number(r), Number(i) - 1, Number(a));
    return Number.isNaN(l.getTime()) ? null : l;
  }
  const n = new Date(e);
  return Number.isNaN(n.getTime()) ? null : n;
}
function ye(e) {
  const t = Qt(e);
  if (!t) return null;
  const n = t.getFullYear(), r = String(t.getMonth() + 1).padStart(2, "0"), i = String(t.getDate()).padStart(2, "0");
  return `${n}-${r}-${i}`;
}
function ur() {
  return ye((/* @__PURE__ */ new Date()).toISOString()) ?? "";
}
function cr(e, t = {}) {
  const n = Qt(e);
  return n ? n.toLocaleDateString(void 0, {
    weekday: t.weekday ? "short" : void 0,
    month: "short",
    day: "numeric",
    year: n.getFullYear() === (/* @__PURE__ */ new Date()).getFullYear() ? void 0 : "numeric"
  }) : "No date";
}
function di(e) {
  const t = Qt(e);
  return t ? t.toLocaleDateString(void 0, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: t.getFullYear() === (/* @__PURE__ */ new Date()).getFullYear() ? void 0 : "numeric"
  }) : "No date";
}
function ql(e) {
  const t = ye(e);
  if (!t) return null;
  const n = ur();
  if (t === n) return "Today";
  const r = ye(new Date(Date.now() - 864e5).toISOString());
  return t === r ? "Yesterday" : null;
}
function af(e) {
  const t = Qt(e);
  return t ? {
    weekday: t.toLocaleDateString(void 0, { weekday: "short" }),
    day: String(t.getDate())
  } : { weekday: "—", day: "·" };
}
function Gl(e) {
  return Math.round(e * 10) / 10;
}
function Zt(e) {
  const t = e.filter((n) => typeof n == "number" && Number.isFinite(n));
  return t.length ? Gl(t.reduce((n, r) => n + r, 0) / t.length) : null;
}
function Yl(e) {
  const t = new Set(e.map((i) => ye(i.date)).filter(Boolean));
  if (!t.size) return 0;
  let n = 0;
  const r = /* @__PURE__ */ new Date();
  for (t.has(ye(r.toISOString()) ?? "") || r.setDate(r.getDate() - 1); t.has(ye(r.toISOString()) ?? ""); )
    n += 1, r.setDate(r.getDate() - 1);
  return n;
}
function of(e) {
  const t = ye(e);
  if (!t) return "Undated";
  const [n, r] = t.split("-").map(Number);
  return new Date(n, r - 1, 1).toLocaleDateString(void 0, {
    month: "long",
    year: "numeric"
  });
}
function sf(e, t = 12) {
  const n = /* @__PURE__ */ new Map();
  for (const r of e)
    for (const i of [r.morningMoodWord, r.dayMoodWord]) {
      if (!i) continue;
      const a = i.trim().toLowerCase();
      a && n.set(a, (n.get(a) ?? 0) + 1);
    }
  return [...n.entries()].map(([r, i]) => ({ word: r, count: i })).sort((r, i) => i.count - r.count || r.word.localeCompare(i.word)).slice(0, t);
}
function uf(e, t = 12) {
  const n = [];
  for (const r of e) {
    for (const i of r.gratitudes)
      i && n.push({ text: i, date: r.date });
    if (n.length >= t) break;
  }
  return n.slice(0, t);
}
function Xl() {
  const { documents: e, loading: t, error: n, refetch: r } = ma(nf, {
    // A one-year window keeps the embedded app fast while preserving enough
    // history for useful trends. Older entries remain available in Notis.
    pageSize: 365,
    fetchAll: !1
  });
  return { entries: ue(
    () => lf(e.map(rf)),
    [e]
  ), loading: t, error: (n == null ? void 0 : n.message) ?? null, refresh: r };
}
function pi({
  value: e,
  word: t,
  size: n = "md"
}) {
  const r = Ne(e), i = n === "sm" ? 7 : 9, a = n === "sm" ? 13 : 18;
  return /* @__PURE__ */ I("div", { className: "flex items-center gap-3", children: [
    /* @__PURE__ */ b("div", { className: "flex items-center gap-1.5", role: "img", "aria-label": r ? `${r.label} (${r.value} of 7)` : "No mood recorded", children: or.map((l) => {
      const o = (r == null ? void 0 : r.value) === l.value;
      return /* @__PURE__ */ b(
        "span",
        {
          className: "rounded-full transition-all",
          title: l.label,
          style: {
            width: o ? a : i,
            height: o ? a : i,
            backgroundColor: o ? l.color : "transparent",
            boxShadow: o ? `0 0 0 3px ${l.soft}` : `inset 0 0 0 1.5px ${l.color}55`
          }
        },
        l.value
      );
    }) }),
    r ? /* @__PURE__ */ I("span", { className: Ue("font-medium leading-tight", n === "sm" ? "text-xs" : "text-sm"), children: [
      t ? /* @__PURE__ */ b("span", { className: "capitalize", children: t }) : r.label,
      t ? /* @__PURE__ */ b("span", { className: "ml-1.5 font-normal text-muted-foreground", children: r.label.toLowerCase() }) : null
    ] }) : /* @__PURE__ */ b("span", { className: "text-xs text-muted-foreground", children: "Not recorded" })
  ] });
}
function mi({ value: e, size: t = 8 }) {
  const n = Ne(e);
  return /* @__PURE__ */ b(
    "span",
    {
      "aria-hidden": !0,
      className: "inline-block shrink-0 rounded-full",
      style: {
        width: t,
        height: t,
        backgroundColor: (n == null ? void 0 : n.color) ?? "transparent",
        boxShadow: n ? void 0 : "inset 0 0 0 1px hsl(var(--muted-foreground) / 0.4)"
      }
    }
  );
}
function gi({
  label: e,
  value: t,
  color: n,
  icon: r
}) {
  return /* @__PURE__ */ I("div", { className: "flex items-center gap-3", children: [
    /* @__PURE__ */ I("span", { className: "flex w-28 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground", children: [
      /* @__PURE__ */ b(r, { size: 14, weight: "bold", style: { color: n } }),
      e
    ] }),
    /* @__PURE__ */ b("div", { className: "flex flex-1 items-center gap-1", role: "img", "aria-label": `${e}: ${t ?? "not recorded"} out of 10`, children: Array.from({ length: 10 }, (i, a) => {
      const l = t != null && a < t;
      return /* @__PURE__ */ b(
        "span",
        {
          className: "h-3.5 flex-1 rounded-sm transition-all",
          style: {
            maxWidth: 18,
            backgroundColor: l ? n : "hsl(var(--muted))",
            opacity: l ? 0.4 + 0.6 * ((a + 1) / 10) : 1
          }
        },
        a
      );
    }) }),
    /* @__PURE__ */ b("span", { className: "w-9 shrink-0 text-right text-sm font-semibold tabular-nums", children: t ?? "—" })
  ] });
}
function Hn({
  icon: e,
  title: t,
  accent: n,
  aside: r,
  children: i
}) {
  return /* @__PURE__ */ I("section", { className: "rounded-2xl border border-border bg-card text-card-foreground shadow-sm", children: [
    /* @__PURE__ */ I("header", { className: "flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5 sm:px-6", children: [
      /* @__PURE__ */ I("div", { className: "flex items-center gap-2.5", children: [
        /* @__PURE__ */ b(
          "span",
          {
            className: "flex h-7 w-7 items-center justify-center rounded-full",
            style: { backgroundColor: `${n}1f`, color: n },
            children: /* @__PURE__ */ b(e, { size: 15, weight: "fill" })
          }
        ),
        /* @__PURE__ */ b("h2", { className: "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground", children: t })
      ] }),
      r
    ] }),
    /* @__PURE__ */ b("div", { className: "space-y-5 px-5 py-5 sm:px-6", children: i })
  ] });
}
function Pe({
  prompt: e,
  children: t,
  missingHint: n
}) {
  return /* @__PURE__ */ I("div", { children: [
    /* @__PURE__ */ b("p", { className: "text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground", children: e }),
    t ? /* @__PURE__ */ b("div", { className: "mt-1.5 text-sm leading-relaxed", children: t }) : /* @__PURE__ */ b("p", { className: "mt-1.5 text-sm italic text-muted-foreground/70", children: n ?? "Not captured." })
  ] });
}
function yi({
  icon: e,
  label: t,
  state: n,
  accent: r
}) {
  return /* @__PURE__ */ I(
    "span",
    {
      className: Ue(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        n === "missing" ? "border-dashed border-border text-muted-foreground" : "border-transparent"
      ),
      style: n === "missing" ? void 0 : { backgroundColor: `${r}1a`, color: r },
      children: [
        /* @__PURE__ */ b(e, { size: 12, weight: n === "missing" ? "regular" : "fill" }),
        t,
        n === "partial" ? /* @__PURE__ */ b("span", { className: "opacity-70", children: "· partial" }) : null
      ]
    }
  );
}
function Qe({
  label: e,
  value: t,
  suffix: n,
  hint: r,
  icon: i,
  accent: a
}) {
  return /* @__PURE__ */ I("div", { className: "rounded-xl border border-border bg-card p-4", children: [
    /* @__PURE__ */ I("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ b("span", { className: "text-xs font-medium text-muted-foreground", children: e }),
      i ? /* @__PURE__ */ b(i, { size: 15, weight: "bold", style: { color: a ?? "hsl(var(--muted-foreground))" } }) : null
    ] }),
    /* @__PURE__ */ I("div", { className: "mt-2 flex items-baseline gap-1", children: [
      /* @__PURE__ */ b("span", { className: "text-2xl font-semibold tracking-tight tabular-nums", children: t }),
      n ? /* @__PURE__ */ b("span", { className: "text-sm text-muted-foreground", children: n }) : null
    ] }),
    r ? /* @__PURE__ */ b("p", { className: "mt-1 text-[11px] text-muted-foreground", children: r }) : null
  ] });
}
function Ve({
  title: e,
  description: t,
  action: n,
  icon: r,
  children: i,
  className: a
}) {
  return /* @__PURE__ */ I(
    "section",
    {
      className: Ue(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-sm",
        a
      ),
      children: [
        /* @__PURE__ */ I("header", { className: "flex items-start justify-between gap-3 px-5 pt-4 pb-3", children: [
          /* @__PURE__ */ I("div", { className: "flex items-start gap-2.5", children: [
            r ? /* @__PURE__ */ b("span", { className: "mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground", children: /* @__PURE__ */ b(r, { size: 16, weight: "bold" }) }) : null,
            /* @__PURE__ */ I("div", { children: [
              /* @__PURE__ */ b("h2", { className: "text-sm font-semibold tracking-tight", children: e }),
              t ? /* @__PURE__ */ b("p", { className: "mt-0.5 text-xs text-muted-foreground", children: t }) : null
            ] })
          ] }),
          n
        ] }),
        /* @__PURE__ */ b("div", { className: "px-5 pb-5", children: i })
      ]
    }
  );
}
function Ql({ label: e = "Loading…" }) {
  return /* @__PURE__ */ I("div", { className: "flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground", children: [
    /* @__PURE__ */ b(Tl, { size: 16, className: "animate-spin" }),
    e
  ] });
}
function Pn({
  icon: e,
  title: t,
  description: n,
  action: r
}) {
  return /* @__PURE__ */ I("div", { className: "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center", children: [
    /* @__PURE__ */ b("span", { className: "flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground", children: /* @__PURE__ */ b(e, { size: 20, weight: "bold" }) }),
    /* @__PURE__ */ b("h3", { className: "mt-3 text-sm font-semibold", children: t }),
    n ? /* @__PURE__ */ b("p", { className: "mt-1 max-w-sm text-xs text-muted-foreground", children: n }) : null,
    r ? /* @__PURE__ */ b("div", { className: "mt-4", children: r }) : null
  ] });
}
const gt = "#f59e0b", Zn = "#6366f1";
function wf() {
  const { entries: e, loading: t, error: n } = Xl(), [r, i] = Ke(null), [a, l] = Ke(""), { setLoading: o } = ya({
    value: a,
    onChange: l,
    placeholder: "Search your journal…"
  });
  wt(() => {
    o(t);
  }, [t, o]);
  const s = ue(() => {
    const k = a.trim().toLowerCase();
    return k ? e.filter((x) => df(x).includes(k)) : e;
  }, [e, a]);
  wt(() => {
    !t && s.length && !s.some((k) => k.id === r) && i(s[0].id);
  }, [t, s, r]);
  const u = ue(
    () => s.find((k) => k.id === r) ?? null,
    [s, r]
  ), f = ue(() => Yl(e), [e]), c = ue(
    () => e.find((k) => ye(k.date) === ur()) ?? null,
    [e]
  ), p = ue(() => {
    const k = [];
    for (const x of s) {
      const S = of(x.date ?? x.createdAt), C = k[k.length - 1];
      C && C.label === S ? C.items.push(x) : k.push({ label: S, items: [x] });
    }
    return k;
  }, [s]), d = ue(
    () => s.findIndex((k) => k.id === r),
    [s, r]
  ), m = d > 0 ? s[d - 1] : null, w = d >= 0 && d < s.length - 1 ? s[d + 1] : null;
  return t && !e.length ? /* @__PURE__ */ b("div", { "data-store-screenshot": "journal", className: "mx-auto w-full max-w-6xl px-5 py-6 sm:px-8", children: /* @__PURE__ */ b(Ql, { label: "Opening your journal…" }) }) : /* @__PURE__ */ I("div", { "data-store-screenshot": "journal", className: "mx-auto w-full max-w-6xl px-5 py-6 sm:px-8", children: [
    /* @__PURE__ */ I("header", { className: "flex flex-wrap items-end justify-between gap-4", children: [
      /* @__PURE__ */ I("div", { children: [
        /* @__PURE__ */ I("div", { className: "flex items-center gap-2 text-xs font-medium text-muted-foreground", children: [
          /* @__PURE__ */ b(tt, { size: 14, weight: "bold" }),
          "5 Minutes Journal"
        ] }),
        /* @__PURE__ */ b("h1", { className: "mt-1 text-2xl font-semibold tracking-tight", children: "Your daily pages" }),
        /* @__PURE__ */ b("p", { className: "mt-1 text-sm text-muted-foreground", children: "Written with Notis, one morning and one evening at a time." })
      ] }),
      /* @__PURE__ */ I("div", { className: "flex items-center gap-2", children: [
        f > 0 ? /* @__PURE__ */ I("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium", children: [
          /* @__PURE__ */ b(jt, { size: 14, weight: "fill", style: { color: "#f59e0b" } }),
          f,
          "-day streak"
        ] }) : null,
        c ? /* @__PURE__ */ I(Dn, { children: [
          /* @__PURE__ */ b(
            yi,
            {
              icon: Be,
              label: "Morning",
              accent: gt,
              state: $l(c) ? "complete" : jl(c) ? "partial" : "missing"
            }
          ),
          /* @__PURE__ */ b(
            yi,
            {
              icon: et,
              label: "Evening",
              accent: Zn,
              state: Wl(c) ? "complete" : Ul(c) ? "partial" : "missing"
            }
          )
        ] }) : /* @__PURE__ */ I("span", { className: "inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground", children: [
          /* @__PURE__ */ b(Il, { size: 13 }),
          "Today starts with your morning check-in"
        ] })
      ] })
    ] }),
    n ? /* @__PURE__ */ b("p", { className: "mt-6 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive", children: n }) : null,
    e.length === 0 ? /* @__PURE__ */ b("div", { className: "mt-8", children: /* @__PURE__ */ b(
      Pn,
      {
        icon: rr,
        title: "Your journal is waiting for its first page",
        description: "Notis writes this journal with you — a short check-in in the morning, a gentle recap at night. Ask Notis to set up your Journal reminders to begin."
      }
    ) }) : s.length === 0 ? /* @__PURE__ */ b("div", { className: "mt-8", children: /* @__PURE__ */ b(
      Pn,
      {
        icon: tt,
        title: "Nothing matches your search",
        description: "Try a different word — moods, gratitudes, highlights, and free entries are all searchable."
      }
    ) }) : /* @__PURE__ */ I("div", { className: "mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[248px_minmax(0,1fr)]", children: [
      /* @__PURE__ */ b("nav", { "aria-label": "Journal timeline", className: "min-w-0 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1", children: /* @__PURE__ */ b("div", { className: "space-y-5", children: p.map((k) => /* @__PURE__ */ I("div", { children: [
        /* @__PURE__ */ b("p", { className: "px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground", children: k.label }),
        /* @__PURE__ */ b("div", { className: "mt-1.5 space-y-0.5", children: k.items.map((x) => /* @__PURE__ */ b(
          cf,
          {
            entry: x,
            selected: x.id === r,
            onSelect: () => i(x.id)
          },
          x.id
        )) })
      ] }, k.label)) }) }),
      u ? /* @__PURE__ */ b(
        ff,
        {
          entry: u,
          onNewer: m ? () => i(m.id) : void 0,
          onOlder: w ? () => i(w.id) : void 0
        }
      ) : null
    ] })
  ] });
}
function cf({
  entry: e,
  selected: t,
  onSelect: n
}) {
  const { weekday: r, day: i } = af(e.date ?? e.createdAt), a = e.dayMoodWord ?? e.morningMoodWord;
  return /* @__PURE__ */ I(
    "button",
    {
      type: "button",
      onClick: n,
      "aria-current": t ? "date" : void 0,
      "data-rail-row": ye(e.date) ?? e.id,
      className: Ue(
        "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors",
        t ? "bg-muted" : "hover:bg-muted/50"
      ),
      children: [
        /* @__PURE__ */ I("span", { className: "flex w-9 shrink-0 flex-col items-center rounded-md py-0.5", children: [
          /* @__PURE__ */ b("span", { className: "text-[9px] font-semibold uppercase tracking-wide text-muted-foreground", children: r }),
          /* @__PURE__ */ b("span", { className: "text-sm font-semibold tabular-nums leading-tight", children: i })
        ] }),
        /* @__PURE__ */ b("span", { className: "min-w-0 flex-1", children: /* @__PURE__ */ b("span", { className: Ue("block truncate text-xs capitalize", a ? "font-medium" : "text-muted-foreground"), children: a ?? ql(e.date) ?? "Entry" }) }),
        /* @__PURE__ */ I("span", { className: "flex shrink-0 items-center gap-1", "aria-hidden": !0, children: [
          /* @__PURE__ */ b(mi, { value: e.morningMood }),
          /* @__PURE__ */ b(mi, { value: e.dayMood })
        ] })
      ]
    }
  );
}
function ff({
  entry: e,
  onNewer: t,
  onOlder: n
}) {
  const r = ye(e.date) === ur(), i = ql(e.date), a = r ? "Not captured yet — Notis will pick it up with you." : "Not captured that day.", l = r ? "Tonight’s check-in will ask about this." : "Not captured that day.";
  return /* @__PURE__ */ I("article", { className: "min-w-0", children: [
    /* @__PURE__ */ I("header", { className: "flex items-start justify-between gap-3", children: [
      /* @__PURE__ */ I("div", { children: [
        /* @__PURE__ */ b("h2", { className: "text-xl font-semibold tracking-tight", children: di(e.date ?? e.createdAt) }),
        i ? /* @__PURE__ */ b("p", { className: "mt-0.5 text-xs font-medium text-muted-foreground", children: i }) : null
      ] }),
      /* @__PURE__ */ I("div", { className: "flex shrink-0 items-center gap-1", children: [
        /* @__PURE__ */ b(Et, { variant: "ghost", size: "icon", onClick: t, disabled: !t, "aria-label": "Newer entry", children: /* @__PURE__ */ b(Nl, { size: 16, weight: "bold" }) }),
        /* @__PURE__ */ b(Et, { variant: "ghost", size: "icon", onClick: n, disabled: !n, "aria-label": "Older entry", children: /* @__PURE__ */ b(Ll, { size: 16, weight: "bold" }) })
      ] })
    ] }),
    /* @__PURE__ */ I("div", { className: "mt-4 space-y-4", children: [
      /* @__PURE__ */ I(
        Hn,
        {
          icon: Be,
          title: "Morning",
          accent: gt,
          aside: e.morningMood == null && !jl(e) ? /* @__PURE__ */ b("span", { className: "text-[11px] italic text-muted-foreground/80", children: a }) : void 0,
          children: [
            /* @__PURE__ */ b(Pe, { prompt: "Waking up, I felt", missingHint: a, children: e.morningMood != null || e.morningMoodWord ? /* @__PURE__ */ b(pi, { value: e.morningMood, word: e.morningMoodWord }) : null }),
            e.morningFeeling ? /* @__PURE__ */ b(Pe, { prompt: "How I was feeling", children: /* @__PURE__ */ b("p", { className: "text-sm leading-relaxed", children: e.morningFeeling }) }) : null,
            /* @__PURE__ */ I("div", { className: "space-y-2.5 rounded-xl bg-muted/40 px-4 py-3.5", children: [
              /* @__PURE__ */ b(gi, { label: "Energy", value: e.energy, color: "#f59e0b", icon: $t }),
              /* @__PURE__ */ b(gi, { label: "Motivation", value: e.motivation, color: "#3b82f6", icon: ir })
            ] }),
            /* @__PURE__ */ b(
              Pe,
              {
                prompt: "Three things I’m grateful for",
                missingHint: a,
                children: sr(e) > 0 ? /* @__PURE__ */ b("ol", { className: "space-y-1.5", children: e.gratitudes.map(
                  (o, s) => o ? /* @__PURE__ */ I("li", { className: "flex items-start gap-2.5", children: [
                    /* @__PURE__ */ b(
                      lr,
                      {
                        size: 14,
                        weight: "fill",
                        className: "mt-0.5 shrink-0",
                        style: { color: gt }
                      }
                    ),
                    /* @__PURE__ */ b("span", { className: "text-sm leading-relaxed", children: o })
                  ] }, s) : null
                ) }) : null
              }
            ),
            /* @__PURE__ */ b(Pe, { prompt: "What will make today great", missingHint: a, children: e.intention ? /* @__PURE__ */ I("p", { className: "flex items-start gap-2.5 text-sm leading-relaxed", children: [
              /* @__PURE__ */ b(Pl, { size: 14, weight: "bold", className: "mt-0.5 shrink-0 text-muted-foreground" }),
              /* @__PURE__ */ b("span", { children: e.intention })
            ] }) : null }),
            e.affirmation ? /* @__PURE__ */ I("figure", { className: "rounded-xl px-4 py-4 text-center", style: { backgroundColor: `${gt}14` }, children: [
              /* @__PURE__ */ b(zl, { size: 16, weight: "fill", className: "mx-auto", style: { color: gt } }),
              /* @__PURE__ */ b("blockquote", { className: "mt-1.5 font-serif text-base italic leading-relaxed", children: e.affirmation }),
              /* @__PURE__ */ b("figcaption", { className: "mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground", children: "Daily affirmation" })
            ] }) : /* @__PURE__ */ b(Pe, { prompt: "Daily affirmation", missingHint: a })
          ]
        }
      ),
      /* @__PURE__ */ I(
        Hn,
        {
          icon: et,
          title: "Evening",
          accent: Zn,
          aside: Ul(e) ? void 0 : /* @__PURE__ */ b("span", { className: "text-[11px] italic text-muted-foreground/80", children: l }),
          children: [
            /* @__PURE__ */ b(Pe, { prompt: "The day felt", missingHint: l, children: e.dayMood != null || e.dayMoodWord ? /* @__PURE__ */ b(pi, { value: e.dayMood, word: e.dayMoodWord }) : null }),
            /* @__PURE__ */ b(Pe, { prompt: "Highlight of the day", missingHint: l, children: e.highlight ? /* @__PURE__ */ I("p", { className: "flex items-start gap-2.5 text-sm leading-relaxed", children: [
              /* @__PURE__ */ b(Hl, { size: 14, weight: "fill", className: "mt-0.5 shrink-0", style: { color: Zn } }),
              /* @__PURE__ */ b("span", { children: e.highlight })
            ] }) : null }),
            /* @__PURE__ */ b(Pe, { prompt: "What today taught me", missingHint: l, children: e.lesson ? /* @__PURE__ */ I("p", { className: "flex items-start gap-2.5 text-sm leading-relaxed", children: [
              /* @__PURE__ */ b(Fl, { size: 14, weight: "bold", className: "mt-0.5 shrink-0 text-muted-foreground" }),
              /* @__PURE__ */ b("span", { children: e.lesson })
            ] }) : null })
          ]
        }
      ),
      /* @__PURE__ */ b(hf, { entry: e, isToday: r }),
      /* @__PURE__ */ I("p", { className: "px-1 pb-2 text-center text-[11px] text-muted-foreground/70", children: [
        "Want to add or fix something? Just tell Notis — “add to my journal for",
        " ",
        (i == null ? void 0 : i.toLowerCase()) ?? di(e.date),
        "…”"
      ] })
    ] })
  ] });
}
function hf({ entry: e, isToday: t }) {
  return /* @__PURE__ */ b(
    Hn,
    {
      icon: rr,
      title: "In my own words",
      accent: "#64748b",
      aside: /* @__PURE__ */ b("span", { className: "text-[11px] italic text-muted-foreground/80", children: "Captured in conversation with Notis." }),
      children: e.freeEntry ? /* @__PURE__ */ b("div", { className: "prose prose-sm max-w-none text-sm leading-relaxed [&_p]:my-2", children: /* @__PURE__ */ b($0, { value: e.freeEntry, size: "sm" }) }) : /* @__PURE__ */ b("p", { className: "text-sm italic text-muted-foreground/70", children: t ? "Nothing written yet — dictate a few lines to Notis tonight." : "No free entry that day." })
    }
  );
}
function df(e) {
  var t, n;
  return [
    e.title,
    e.morningMoodWord,
    e.dayMoodWord,
    e.morningFeeling,
    ...e.gratitudes,
    e.intention,
    e.affirmation,
    e.highlight,
    e.lesson,
    e.freeEntry,
    (t = Ne(e.morningMood)) == null ? void 0 : t.label,
    (n = Ne(e.dayMood)) == null ? void 0 : n.label
  ].filter(Boolean).join(" ").toLowerCase();
}
function Af() {
  var p, d;
  const { entries: e, loading: t, error: n } = Xl(), r = ga(), i = ue(() => [...e].reverse(), [e]), a = ue(() => i.slice(-21), [i]), l = ue(() => Yl(e), [e]), o = ue(
    () => ({
      morningMood: Zt(e.map((m) => m.morningMood)),
      dayMood: Zt(e.map((m) => m.dayMood)),
      energy: Zt(e.map((m) => m.energy)),
      motivation: Zt(e.map((m) => m.motivation))
    }),
    [e]
  ), s = ue(() => gf(e), [e]), u = ue(() => yf(e, 30), [e]), f = ue(() => sf(e), [e]), c = ue(() => uf(e, 12), [e]);
  return t && !e.length ? /* @__PURE__ */ b("div", { "data-store-screenshot": "stats", className: "mx-auto w-full max-w-6xl px-5 py-6 sm:px-8", children: /* @__PURE__ */ b(Ql, { label: "Reading back through your days…" }) }) : /* @__PURE__ */ I("div", { "data-store-screenshot": "stats", className: "mx-auto w-full max-w-6xl px-5 py-6 sm:px-8", children: [
    /* @__PURE__ */ I("header", { className: "flex flex-wrap items-end justify-between gap-4", children: [
      /* @__PURE__ */ I("div", { children: [
        /* @__PURE__ */ I("div", { className: "flex items-center gap-2 text-xs font-medium text-muted-foreground", children: [
          /* @__PURE__ */ b(Rt, { size: 14, weight: "bold" }),
          "5 Minutes Journal"
        ] }),
        /* @__PURE__ */ b("h1", { className: "mt-1 text-2xl font-semibold tracking-tight", children: "Stats" }),
        /* @__PURE__ */ I("p", { className: "mt-1 text-sm text-muted-foreground", children: [
          "What ",
          e.length,
          " ",
          e.length === 1 ? "day" : "days",
          " of checking in with yourself add up to."
        ] })
      ] }),
      /* @__PURE__ */ I(Et, { variant: "outline", onClick: () => r.toRoute("/"), className: "gap-1.5", children: [
        /* @__PURE__ */ b(tt, { size: 16, weight: "bold" }),
        "Back to journal"
      ] })
    ] }),
    n ? /* @__PURE__ */ b("p", { className: "mt-6 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive", children: n }) : null,
    e.length === 0 ? /* @__PURE__ */ b("div", { className: "mt-8", children: /* @__PURE__ */ b(
      Pn,
      {
        icon: Rt,
        title: "No patterns to show yet",
        description: "After a few mornings and evenings with Notis, your moods, energy, and gratitude will start telling a story here.",
        action: /* @__PURE__ */ I(Et, { onClick: () => r.toRoute("/"), className: "gap-1.5", children: [
          /* @__PURE__ */ b(tt, { size: 16, weight: "bold" }),
          "Open journal"
        ] })
      }
    ) }) : /* @__PURE__ */ I(Dn, { children: [
      /* @__PURE__ */ I("div", { className: "mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6", children: [
        /* @__PURE__ */ b(
          Qe,
          {
            label: "Streak",
            value: l,
            suffix: l === 1 ? "day" : "days",
            icon: jt,
            accent: "#f59e0b"
          }
        ),
        /* @__PURE__ */ b(Qe, { label: "Days journaled", value: e.length, icon: tt }),
        /* @__PURE__ */ b(
          Qe,
          {
            label: "Waking mood",
            value: o.morningMood ?? "—",
            suffix: o.morningMood != null ? "/ 7" : void 0,
            icon: Be,
            accent: Fn,
            hint: (p = Ne(o.morningMood)) == null ? void 0 : p.label
          }
        ),
        /* @__PURE__ */ b(
          Qe,
          {
            label: "Day mood",
            value: o.dayMood ?? "—",
            suffix: o.dayMood != null ? "/ 7" : void 0,
            icon: et,
            accent: zn,
            hint: (d = Ne(o.dayMood)) == null ? void 0 : d.label
          }
        ),
        /* @__PURE__ */ b(
          Qe,
          {
            label: "Energy",
            value: o.energy ?? "—",
            suffix: o.energy != null ? "/ 10" : void 0,
            icon: $t,
            accent: In
          }
        ),
        /* @__PURE__ */ b(
          Qe,
          {
            label: "Motivation",
            value: o.motivation ?? "—",
            suffix: o.motivation != null ? "/ 10" : void 0,
            icon: ir,
            accent: Tn
          }
        )
      ] }),
      /* @__PURE__ */ I("div", { className: "mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2", children: [
        /* @__PURE__ */ I(
          Ve,
          {
            title: "Mood, morning to evening",
            description: "How you woke up next to how the day ended, on the pleasant scale",
            icon: Be,
            className: "lg:col-span-2",
            children: [
              /* @__PURE__ */ b(pf, { entries: a }),
              /* @__PURE__ */ I("div", { className: "mt-3 flex items-center gap-4 text-[11px] text-muted-foreground", children: [
                /* @__PURE__ */ I("span", { className: "inline-flex items-center gap-1.5", children: [
                  /* @__PURE__ */ b("span", { className: "h-2 w-2 rounded-sm bg-foreground/70" }),
                  "Waking mood"
                ] }),
                /* @__PURE__ */ I("span", { className: "inline-flex items-center gap-1.5", children: [
                  /* @__PURE__ */ b("span", { className: "h-2 w-2 rounded-sm border-[1.5px] border-foreground/70 bg-foreground/20" }),
                  "Whole-day mood"
                ] }),
                /* @__PURE__ */ b("span", { children: "Bars take the color of the mood itself." }),
                s != null ? /* @__PURE__ */ b("span", { className: "ml-auto", children: s > 0 ? `Your days tend to end ${s} above where they start.` : s < 0 ? `Your days tend to end ${Math.abs(s)} below where they start.` : "Your days tend to end where they start." }) : /* @__PURE__ */ b("span", { className: "ml-auto", children: "Scale 1–7" })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ I(
          Ve,
          {
            title: "Energy & motivation",
            description: "Morning levels day by day",
            icon: $t,
            className: "lg:col-span-2",
            children: [
              /* @__PURE__ */ b(mf, { entries: a }),
              /* @__PURE__ */ I("div", { className: "mt-3 flex items-center gap-4 text-[11px] text-muted-foreground", children: [
                /* @__PURE__ */ b(ki, { color: In, label: "Energy" }),
                /* @__PURE__ */ b(ki, { color: Tn, label: "Motivation" }),
                /* @__PURE__ */ b("span", { className: "ml-auto", children: "Scale 1–10" })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ b(
          Ve,
          {
            title: "How your days feel",
            description: "Where the whole-day mood lands on the scale",
            icon: et,
            children: /* @__PURE__ */ b(xi, { entries: e, pick: (m) => m.dayMood })
          }
        ),
        /* @__PURE__ */ b(
          Ve,
          {
            title: "How you wake up",
            description: "Where the waking mood lands on the scale",
            icon: Be,
            children: /* @__PURE__ */ b(xi, { entries: e, pick: (m) => m.morningMood })
          }
        ),
        /* @__PURE__ */ b(
          Ve,
          {
            title: "The ritual",
            description: "Check-ins completed over the last 30 days",
            icon: jt,
            children: /* @__PURE__ */ I("div", { className: "space-y-4 pt-1", children: [
              /* @__PURE__ */ b(
                bi,
                {
                  icon: Be,
                  label: "Mornings",
                  fraction: u.morning,
                  color: Fn
                }
              ),
              /* @__PURE__ */ b(
                bi,
                {
                  icon: et,
                  label: "Evenings",
                  fraction: u.evening,
                  color: zn
                }
              )
            ] })
          }
        ),
        /* @__PURE__ */ b(
          Ve,
          {
            title: "Words you reach for",
            description: "The adjectives you use most for your moods",
            icon: Rt,
            children: f.length ? /* @__PURE__ */ b("div", { className: "flex flex-wrap gap-2", children: f.map(({ word: m, count: w }) => /* @__PURE__ */ I(
              "span",
              {
                className: "inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize",
                children: [
                  m,
                  /* @__PURE__ */ b("span", { className: "text-[10px] tabular-nums text-muted-foreground", children: w })
                ]
              },
              m
            )) }) : /* @__PURE__ */ b(Ct, { label: "No mood words yet" })
          }
        ),
        /* @__PURE__ */ b(
          Ve,
          {
            title: "Gratitude wall",
            description: "The latest things you said thank you for",
            icon: lr,
            className: "lg:col-span-2",
            children: c.length ? /* @__PURE__ */ b("div", { className: "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3", children: c.map((m, w) => /* @__PURE__ */ I(
              "div",
              {
                className: "rounded-xl border border-border/70 bg-muted/30 px-3.5 py-3",
                children: [
                  /* @__PURE__ */ b("p", { className: "text-sm leading-snug", children: m.text }),
                  /* @__PURE__ */ b("p", { className: "mt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground", children: cr(m.date) })
                ]
              },
              `${m.text}-${w}`
            )) }) : /* @__PURE__ */ b(Ct, { label: "Your gratitudes will collect here" })
          }
        )
      ] })
    ] })
  ] });
}
function pf({ entries: e }) {
  if (!e.length) return /* @__PURE__ */ b(Ct, {});
  const t = e.map(
    (n) => `${cr(n.date)}: waking ${n.morningMood ?? "not logged"}, day ${n.dayMood ?? "not logged"}`
  ).join("; ");
  return /* @__PURE__ */ b(
    "div",
    {
      className: "flex items-end gap-1.5 overflow-x-auto pb-1",
      style: { height: 168 },
      role: "img",
      "aria-label": `Waking and whole-day mood by day, on a 1 to 7 scale. ${t}`,
      children: e.map((n) => {
        var r, i;
        return /* @__PURE__ */ I("div", { className: "flex min-w-[26px] flex-1 flex-col items-center gap-1.5", children: [
          /* @__PURE__ */ I("div", { className: "flex h-[128px] w-full items-end justify-center gap-1", children: [
            /* @__PURE__ */ b(
              Ut,
              {
                fraction: (n.morningMood ?? 0) / 7,
                color: ((r = Ne(n.morningMood)) == null ? void 0 : r.color) ?? Fn,
                title: `Waking ${n.morningMood ?? "—"}`
              }
            ),
            /* @__PURE__ */ b(
              Ut,
              {
                fraction: (n.dayMood ?? 0) / 7,
                color: ((i = Ne(n.dayMood)) == null ? void 0 : i.color) ?? zn,
                title: `Day ${n.dayMood ?? "—"}`,
                hollow: !0
              }
            )
          ] }),
          /* @__PURE__ */ b("span", { className: "text-[9px] text-muted-foreground", children: Jl(n.date) })
        ] }, n.id);
      })
    }
  );
}
function mf({ entries: e }) {
  if (!e.length) return /* @__PURE__ */ b(Ct, {});
  const t = e.map(
    (n) => `${cr(n.date)}: energy ${n.energy ?? "not logged"}, motivation ${n.motivation ?? "not logged"}`
  ).join("; ");
  return /* @__PURE__ */ b(
    "div",
    {
      className: "flex items-end gap-1.5 overflow-x-auto pb-1",
      style: { height: 168 },
      role: "img",
      "aria-label": `Energy and motivation by day. ${t}`,
      children: e.map((n) => /* @__PURE__ */ I("div", { className: "flex min-w-[26px] flex-1 flex-col items-center gap-1.5", children: [
        /* @__PURE__ */ I("div", { className: "flex h-[128px] w-full items-end justify-center gap-1", children: [
          /* @__PURE__ */ b(Ut, { fraction: (n.energy ?? 0) / 10, color: In, title: `Energy ${n.energy ?? "—"}` }),
          /* @__PURE__ */ b(
            Ut,
            {
              fraction: (n.motivation ?? 0) / 10,
              color: Tn,
              title: `Motivation ${n.motivation ?? "—"}`
            }
          )
        ] }),
        /* @__PURE__ */ b("span", { className: "text-[9px] text-muted-foreground", children: Jl(n.date) })
      ] }, n.id))
    }
  );
}
function Ut({
  fraction: e,
  color: t,
  title: n,
  hollow: r
}) {
  const i = Math.max(0, Math.min(1, e)) * 100;
  return /* @__PURE__ */ b("div", { className: "flex h-full w-2.5 items-end", title: n, children: /* @__PURE__ */ b(
    "div",
    {
      className: "w-full rounded-t-sm transition-all",
      style: {
        height: `${Math.max(i, e > 0 ? 4 : 0)}%`,
        backgroundColor: r ? `${t}55` : t,
        boxShadow: r ? `inset 0 0 0 1.5px ${t}` : void 0
      }
    }
  ) });
}
function xi({
  entries: e,
  pick: t
}) {
  const n = /* @__PURE__ */ new Map();
  let r = 0;
  for (const l of e) {
    const o = t(l), s = Ne(o);
    s && (n.set(s.value, (n.get(s.value) ?? 0) + 1), r += 1);
  }
  if (!r) return /* @__PURE__ */ b(Ct, {});
  const i = Math.max(1, ...n.values()), a = [...or].reverse();
  return /* @__PURE__ */ b("div", { className: "space-y-2.5", children: a.map((l) => {
    const o = n.get(l.value) ?? 0, s = Math.round(o / r * 100);
    return /* @__PURE__ */ I(
      "div",
      {
        className: "flex items-center gap-3",
        "aria-label": `${l.label}: ${o} days, ${s} percent`,
        children: [
          /* @__PURE__ */ b("span", { className: "w-32 shrink-0 truncate text-xs font-medium", children: l.label }),
          /* @__PURE__ */ b("div", { className: "h-2.5 flex-1 overflow-hidden rounded-full bg-muted", children: /* @__PURE__ */ b(
            "div",
            {
              className: "h-full rounded-full transition-all",
              style: { width: `${o / i * 100}%`, backgroundColor: l.color }
            }
          ) }),
          /* @__PURE__ */ I("span", { className: "w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground", children: [
            o,
            " · ",
            s,
            "%"
          ] })
        ]
      },
      l.value
    );
  }) });
}
function bi({
  icon: e,
  label: t,
  fraction: n,
  color: r
}) {
  const i = Math.round(Math.max(0, Math.min(1, n)) * 100);
  return /* @__PURE__ */ I("div", { className: "flex items-center gap-3", children: [
    /* @__PURE__ */ I("span", { className: "flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground", children: [
      /* @__PURE__ */ b(e, { size: 14, weight: "bold", style: { color: r } }),
      t
    ] }),
    /* @__PURE__ */ b("div", { className: "h-2.5 flex-1 overflow-hidden rounded-full bg-muted", children: /* @__PURE__ */ b(
      "div",
      {
        className: "h-full rounded-full transition-all",
        style: { width: `${i}%`, backgroundColor: r }
      }
    ) }),
    /* @__PURE__ */ I("span", { className: "w-10 shrink-0 text-right text-xs font-semibold tabular-nums", children: [
      i,
      "%"
    ] })
  ] });
}
function ki({ color: e, label: t }) {
  return /* @__PURE__ */ I("span", { className: "inline-flex items-center gap-1.5", children: [
    /* @__PURE__ */ b("span", { className: "h-2 w-2 rounded-sm", style: { backgroundColor: e } }),
    t
  ] });
}
function Ct({ label: e = "Not enough data yet" }) {
  return /* @__PURE__ */ b("div", { className: Ue("flex items-center justify-center py-10 text-xs text-muted-foreground"), children: e });
}
function gf(e) {
  const t = e.filter((n) => n.morningMood != null && n.dayMood != null).map((n) => n.dayMood - n.morningMood);
  return t.length ? Gl(t.reduce((n, r) => n + r, 0) / t.length) : null;
}
function yf(e, t) {
  const n = /* @__PURE__ */ new Date();
  n.setDate(n.getDate() - t);
  const r = ye(n.toISOString()) ?? "", i = e.filter((a) => (ye(a.date) ?? "") >= r);
  return i.length ? {
    morning: Math.min(1, i.filter($l).length / t),
    evening: Math.min(1, i.filter(Wl).length / t)
  } : { morning: 0, evening: 0 };
}
function Jl(e) {
  const t = ye(e);
  if (!t) return "";
  const [, n, r] = t.split("-");
  return `${Number(n)}/${Number(r)}`;
}
export {
  kf as __AppShell,
  wf as index,
  Af as insights
};
