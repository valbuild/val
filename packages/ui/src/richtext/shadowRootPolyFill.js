// POLYFILL
// getSelection on shawdowRoot polyfill for safari and firefox
// https://github.com/GoogleChromeLabs/shadow-selection-polyfill/issues/11
// https://github.com/GoogleChromeLabs/shadow-selection-polyfill/issues/11#issue-834214496
// Alternative:
// https://github.com/codemirror/view/blob/5dfda8ed7929915f63bc82251f2b6229c789c4a4/src/domobserver.ts#L447

const SUPPORTS_SHADOW_SELECTION =
  typeof window.ShadowRoot.prototype.getSelection === "function";
const SUPPORTS_BEFORE_INPUT =
  typeof window.InputEvent.prototype.getTargetRanges === "function";
const IS_FIREFOX =
  window.navigator.userAgent.toLowerCase().indexOf("firefox") > -1;

class ShadowSelection {
  constructor() {
    this._ranges = [];
  }

  getRangeAt(index) {
    return this._ranges[index];
  }

  addRange(range) {
    this._ranges.push(range);
  }

  removeAllRanges() {
    this._ranges = [];
  }

  // todo: implement remaining `Selection` methods and properties.
}

function getActiveElement() {
  let active = document.activeElement;

  while (true) {
    if (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    } else {
      break;
    }
  }

  return active;
}

if (IS_FIREFOX && !SUPPORTS_SHADOW_SELECTION) {
  window.ShadowRoot.prototype.getSelection = function () {
    return document.getSelection();
  };
}

if (!IS_FIREFOX && !SUPPORTS_SHADOW_SELECTION && SUPPORTS_BEFORE_INPUT) {
  let processing = false;
  let selection = new ShadowSelection();

  window.ShadowRoot.prototype.getSelection = function () {
    return selection;
  };

  window.addEventListener(
    "selectionchange",
    () => {
      if (!processing) {
        processing = true;

        const active = getActiveElement();

        if (active && active.getAttribute("contenteditable") === "true") {
          //https://stackoverflow.com/questions/60581285/execcommand-is-now-obsolete-whats-the-alternative
          //TLDR: its deprecated but there is not alternative (as of 2023-10-26)
          document.execCommand("indent");
        } else {
          selection.removeAllRanges();
        }

        processing = false;
      }
    },
    true
  );

  window.addEventListener(
    "beforeinput",
    (event) => {
      if (processing) {
        const ranges = event.getTargetRanges();
        const range = ranges[0];

        const newRange = new Range();

        newRange.setStart(range.startContainer, range.startOffset);
        newRange.setEnd(range.endContainer, range.endOffset);

        selection.removeAllRanges();
        selection.addRange(newRange);

        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  window.addEventListener(
    "selectstart",
    () => {
      selection.removeAllRanges();
    },
    true
  );
}
