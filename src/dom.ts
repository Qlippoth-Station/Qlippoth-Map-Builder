type Attributes = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Small element factory: h("button", { class: "x", onclick: fn }, "Label"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2), value);
    else if (name in element && typeof value !== "string") (element as unknown as Record<string, unknown>)[name] = value;
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

export function clear(element: Element, ...children: Child[]): void {
  element.replaceChildren(...children.filter((child): child is Node | string => !!child));
}
