declare module "*.css";

import type { HTMLAttributes, Key, Ref } from "react";

type WebAwesomeAttributes = HTMLAttributes<HTMLElement> & {
  key?: Key;
  ref?: Ref<HTMLElement>;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "wa-select": WebAwesomeAttributes & {
        value?: string;
        size?: "xs" | "s" | "m" | "l" | "xl" | "small" | "medium" | "large";
        placeholder?: string;
        appearance?: "filled" | "outlined" | "filled-outlined";
        disabled?: boolean;
      };
      "wa-option": WebAwesomeAttributes & {
        value?: string;
        disabled?: boolean;
      };
      "wa-color-picker": WebAwesomeAttributes & {
        value?: string;
        label?: string;
        format?: "hex" | "rgb" | "hsl" | "hsv";
        size?: "xs" | "s" | "m" | "l" | "xl" | "small" | "medium" | "large";
        swatches?: string[];
        disabled?: boolean;
      };
      "wa-tooltip": WebAwesomeAttributes & {
        for?: string;
        placement?:
          | "top"
          | "top-start"
          | "top-end"
          | "bottom"
          | "bottom-start"
          | "bottom-end"
          | "left"
          | "left-start"
          | "left-end"
          | "right"
          | "right-start"
          | "right-end";
        trigger?: string;
      };
    }
  }
}
