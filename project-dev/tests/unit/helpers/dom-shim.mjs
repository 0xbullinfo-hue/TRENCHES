// Minimal DOM shim for mounting React 18 components via react-dom/client in Node.js tests.

export function installDomShim() {
  class MiniEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
      this.defaultPrevented = false;
      this.propagationStopped = false;
      this.immediatePropagationStopped = false;
      this.target = null;
      this.currentTarget = null;
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
    stopPropagation() {
      this.propagationStopped = true;
    }
    stopImmediatePropagation() {
      this.immediatePropagationStopped = true;
      this.propagationStopped = true;
    }
  }

  class MiniNode {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.parentNode = null;
      this.childNodes = [];
      this._listeners = new Map();
      this.ownerDocument = null;
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] || null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentNode.childNodes.length
        ? this.parentNode.childNodes[idx + 1]
        : null;
    }
    get previousSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx > 0 ? this.parentNode.childNodes[idx - 1] : null;
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    appendChild(child) {
      return this.insertBefore(child, null);
    }
    insertBefore(newChild, refChild) {
      if (newChild.nodeType === 11) {
        // DocumentFragment
        const children = [...newChild.childNodes];
        for (const c of children) {
          this.insertBefore(c, refChild);
        }
        return newChild;
      }
      if (newChild.parentNode) {
        newChild.parentNode.removeChild(newChild);
      }
      newChild.parentNode = this;
      if (this.ownerDocument) newChild.ownerDocument = this.ownerDocument;
      if (!refChild) {
        this.childNodes.push(newChild);
      } else {
        const idx = this.childNodes.indexOf(refChild);
        if (idx === -1) {
          this.childNodes.push(newChild);
        } else {
          this.childNodes.splice(idx, 0, newChild);
        }
      }
      return newChild;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    replaceChild(newChild, oldChild) {
      this.insertBefore(newChild, oldChild);
      return this.removeChild(oldChild);
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      const set = this._listeners.get(type);
      if (set) set.delete(fn);
    }
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      let cur = this;
      while (cur) {
        event.currentTarget = cur;
        const set = cur._listeners.get(event.type);
        if (set) {
          for (const fn of [...set]) {
            fn.call(cur, event);
            if (event.immediatePropagationStopped) break;
          }
        }
        if (event.propagationStopped || !event.bubbles) break;
        cur = cur.parentNode;
      }
      return !event.defaultPrevented;
    }
    get textContent() {
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(val) {
      for (const c of [...this.childNodes]) {
        c.parentNode = null;
      }
      this.childNodes = [];
      if (val !== null && val !== undefined && String(val) !== '') {
        this.appendChild(new MiniText(String(val), this.ownerDocument));
      }
    }
  }

  class MiniText extends MiniNode {
    constructor(data, ownerDocument) {
      super(3, '#text');
      this.data = data;
      this.ownerDocument = ownerDocument;
    }
    get nodeValue() {
      return this.data;
    }
    set nodeValue(v) {
      this.data = String(v);
    }
    get textContent() {
      return this.data;
    }
    set textContent(v) {
      this.data = String(v);
    }
  }

  class MiniComment extends MiniNode {
    constructor(data, ownerDocument) {
      super(8, '#comment');
      this.data = data;
      this.ownerDocument = ownerDocument;
    }
    get textContent() {
      return '';
    }
  }

  class MiniDocumentFragment extends MiniNode {
    constructor(ownerDocument) {
      super(11, '#document-fragment');
      this.ownerDocument = ownerDocument;
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName, ownerDocument) {
      const upper = tagName.toUpperCase();
      super(1, upper);
      this.tagName = upper;
      this.localName = tagName.toLowerCase();
      this.ownerDocument = ownerDocument;
      this.attributes = new Map();
      this.style = {};
      this.dataset = {};
      this.disabled = false;
      this.type = '';
      this.id = '';
      this.className = '';
      this.tabIndex = 0;
      this.href = '';
      this.target = '';
      this.rel = '';
      this.title = '';
      this.htmlFor = '';
    }
    setAttribute(name, value) {
      const str = String(value);
      this.attributes.set(name, str);
      if (name === 'id') this.id = str;
      else if (name === 'class') this.className = str;
      else if (name === 'disabled') this.disabled = true;
      else if (name === 'type') this.type = str;
      else if (name === 'href') this.href = str;
      else if (name === 'for') this.htmlFor = str;
      else if (name === 'value') this._value = str;
    }
    getAttribute(name) {
      if (name === 'id' && this.id) return this.id;
      if (name === 'class' && this.className) return this.className;
      if (name === 'disabled') return this.disabled ? '' : null;
      if (name === 'type' && this.type) return this.type;
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === 'disabled') this.disabled = false;
      else if (name === 'id') this.id = '';
      else if (name === 'class') this.className = '';
    }
    hasAttribute(name) {
      if (name === 'disabled') return Boolean(this.disabled);
      return this.attributes.has(name);
    }
    get children() {
      return this.childNodes.filter((c) => c.nodeType === 1);
    }
    querySelectorAll(selector) {
      const results = [];
      const parts = selector.split(',').map((s) => s.trim());
      const matches = (el, sel) => {
        if (sel.startsWith('#')) return el.id === sel.slice(1);
        const attrMatch = sel.match(/^([a-zA-Z0-9_-]*)\[([a-zA-Z0-9_-]+)=["']?([^"'\]]+)["']?\]$/);
        if (attrMatch) {
          const [, tag, attr, val] = attrMatch;
          if (tag && el.localName !== tag.toLowerCase()) return false;
          return el.getAttribute(attr) === val || el[attr] === val;
        }
        return el.localName === sel.toLowerCase();
      };
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (parts.some((p) => matches(child, p))) results.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return results;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    click() {
      if (this.disabled) return;
      this.dispatchEvent(new MiniEvent('click', { bubbles: true, cancelable: true }));
    }
    focus() {}
    blur() {}
  }

  class MiniHTMLInputElement extends MiniElement {
    constructor(ownerDocument) {
      super('input', ownerDocument);
      this.type = 'text';
      this._value = '';
      this.checked = false;
    }
    get value() {
      return this._value;
    }
    set value(v) {
      this._value = v === null || v === undefined ? '' : String(v);
    }
  }

  class MiniHTMLButtonElement extends MiniElement {
    constructor(ownerDocument) {
      super('button', ownerDocument);
      this.type = 'submit';
    }
  }

  class MiniHTMLFormElement extends MiniElement {
    constructor(ownerDocument) {
      super('form', ownerDocument);
    }
  }

  class MiniHTMLIFrameElement extends MiniElement {
    constructor(ownerDocument) {
      super('iframe', ownerDocument);
    }
  }

  class MiniHTMLTextAreaElement extends MiniElement {
    constructor(ownerDocument) {
      super('textarea', ownerDocument);
      this._value = '';
    }
    get value() {
      return this._value;
    }
    set value(v) {
      this._value = v === null || v === undefined ? '' : String(v);
    }
  }

  class MiniHTMLSelectElement extends MiniElement {
    constructor(ownerDocument) {
      super('select', ownerDocument);
      this._value = '';
    }
    get value() {
      return this._value;
    }
    set value(v) {
      this._value = v === null || v === undefined ? '' : String(v);
    }
  }

  class MiniDocument extends MiniNode {
    constructor() {
      super(9, '#document');
      this.ownerDocument = this;
      this.visibilityState = 'visible';
      this.oninput = null;
      this.onchange = null;
      this.onsubmit = null;
      this.onclick = null;
      this.documentElement = new MiniElement('html', this);
      this.head = new MiniElement('head', this);
      this.body = new MiniElement('body', this);
      this.documentElement.appendChild(this.head);
      this.documentElement.appendChild(this.body);
      this.appendChild(this.documentElement);
      this.activeElement = this.body;
    }
    createElement(tag) {
      const lower = tag.toLowerCase();
      if (lower === 'input') return new MiniHTMLInputElement(this);
      if (lower === 'button') return new MiniHTMLButtonElement(this);
      if (lower === 'form') return new MiniHTMLFormElement(this);
      return new MiniElement(lower, this);
    }
    createElementNS(_ns, tag) {
      return this.createElement(tag);
    }
    createTextNode(text) {
      return new MiniText(String(text), this);
    }
    createComment(text) {
      return new MiniComment(String(text), this);
    }
    createDocumentFragment() {
      return new MiniDocumentFragment(this);
    }
  }

  const document = new MiniDocument();
  const windowObj = {
    document,
    navigator: {
      clipboard: {
        writeText: async () => undefined,
      },
    },
    location: {
      hostname: 'localhost',
      href: 'http://localhost:3008/dashboard',
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    Event: MiniEvent,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLInputElement: MiniHTMLInputElement,
    HTMLButtonElement: MiniHTMLButtonElement,
    HTMLFormElement: MiniHTMLFormElement,
    HTMLIFrameElement: MiniHTMLIFrameElement,
    HTMLTextAreaElement: MiniHTMLTextAreaElement,
    HTMLSelectElement: MiniHTMLSelectElement,
  };

  globalThis.window = windowObj;
  globalThis.document = document;
  globalThis.Event = MiniEvent;
  globalThis.Node = MiniNode;
  globalThis.Element = MiniElement;
  globalThis.HTMLElement = MiniElement;
  globalThis.HTMLInputElement = MiniHTMLInputElement;
  globalThis.HTMLButtonElement = MiniHTMLButtonElement;
  globalThis.HTMLFormElement = MiniHTMLFormElement;
  globalThis.HTMLIFrameElement = MiniHTMLIFrameElement;
  globalThis.HTMLTextAreaElement = MiniHTMLTextAreaElement;
  globalThis.HTMLSelectElement = MiniHTMLSelectElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', {
      value: windowObj.navigator,
      configurable: true,
    });
  } else {
    try {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: windowObj.navigator.clipboard,
        configurable: true,
      });
    } catch {
      // ignore if read-only
    }
  }

  return {
    document,
    window: windowObj,
    Event: MiniEvent,
    setInputValue(inputEl, nextVal) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        MiniHTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(inputEl, nextVal);
      } else {
        inputEl.value = nextVal;
      }
      inputEl.dispatchEvent(new MiniEvent('input', { bubbles: true, cancelable: true }));
      inputEl.dispatchEvent(new MiniEvent('change', { bubbles: true, cancelable: true }));
    },
    submitForm(formEl) {
      formEl.dispatchEvent(new MiniEvent('submit', { bubbles: true, cancelable: true }));
    },
  };
}
